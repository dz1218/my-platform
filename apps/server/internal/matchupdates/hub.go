// Package matchupdates fans committed PostgreSQL changes out to account sockets.
package matchupdates

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
)

const channel = "companion_matches_changed"

// Hub uses one dedicated session per API process, independently of the number
// of accounts or tabs. PostgreSQL LISTEN requires direct or session pooling.
type Hub struct {
	mu          sync.Mutex
	subscribers map[string]map[chan struct{}]struct{}
	connected   bool
	closed      bool
	listenIdle  time.Duration
	pingTimeout time.Duration
}

func New() *Hub {
	return &Hub{subscribers: make(map[string]map[chan struct{}]struct{}), listenIdle: 30 * time.Second, pingTimeout: 5 * time.Second}
}

// Subscribe registers before the caller reads its first snapshot. A signal is
// delivered only after LISTEN is active, closing the snapshot/subscribe race.
// Invalidations coalesce: a slow client needs the latest snapshot, not a queue
// containing every intermediate change. Cancel must be called on disconnect.
func (h *Hub) Subscribe(userID string) (<-chan struct{}, func()) {
	h.mu.Lock()
	defer h.mu.Unlock()
	changes := make(chan struct{}, 1)
	if h.closed {
		close(changes)
		return changes, func() {}
	}
	if h.subscribers[userID] == nil {
		h.subscribers[userID] = make(map[chan struct{}]struct{})
	}
	h.subscribers[userID][changes] = struct{}{}
	if h.connected {
		changes <- struct{}{}
	}
	var once sync.Once
	return changes, func() {
		once.Do(func() {
			h.mu.Lock()
			defer h.mu.Unlock()
			if _, exists := h.subscribers[userID][changes]; exists {
				delete(h.subscribers[userID], changes)
				if len(h.subscribers[userID]) == 0 {
					delete(h.subscribers, userID)
				}
				close(changes)
			}
		})
	}
}

func signal(changes chan struct{}) {
	select {
	case changes <- struct{}{}:
	default:
	}
}

func (h *Hub) changed(userID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for changes := range h.subscribers[userID] {
		signal(changes)
	}
}

func (h *Hub) ready() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.connected = true
	// Notifications are not durable during a dropped LISTEN session. Refresh
	// everyone after re-LISTEN so missed changes are recovered from PostgreSQL.
	for _, subscribers := range h.subscribers {
		for changes := range subscribers {
			signal(changes)
		}
	}
}

func (h *Hub) disconnected() {
	h.mu.Lock()
	h.connected = false
	h.mu.Unlock()
}

func (h *Hub) close() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.closed = true
	h.connected = false
	for _, subscribers := range h.subscribers {
		for changes := range subscribers {
			close(changes)
		}
	}
	clear(h.subscribers)
}

// Run owns the listener until ctx is canceled, then closes all subscriptions.
// Invoke once per Hub. It never holds a query-pool connection while waiting.
func (h *Hub) Run(ctx context.Context, config *pgx.ConnConfig) {
	defer h.close()
	config = config.Copy()
	if config.RuntimeParams["application_name"] == "" {
		config.RuntimeParams["application_name"] = "companion_matches_listener"
	}
	delay := time.Second
	for ctx.Err() == nil {
		connected, err := h.listen(ctx, config)
		h.disconnected()
		if ctx.Err() != nil {
			return
		}
		slog.Warn("account notifications disconnected; reconnecting", "error", err)
		if connected {
			delay = time.Second
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
		if delay < 30*time.Second {
			delay *= 2
			if delay > 30*time.Second {
				delay = 30 * time.Second
			}
		}
	}
}

func (h *Hub) listen(ctx context.Context, config *pgx.ConnConfig) (bool, error) {
	startup, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	conn, err := pgx.ConnectConfig(startup, config)
	if err != nil {
		return false, err
	}
	defer func() {
		closeCtx, stop := context.WithTimeout(context.Background(), time.Second)
		defer stop()
		_ = conn.Close(closeCtx)
	}()
	var schema string
	if err = conn.QueryRow(startup, `SELECT current_schema()`).Scan(&schema); err != nil {
		return false, err
	}
	if _, err = conn.Exec(startup, `LISTEN `+channel); err != nil {
		return false, err
	}
	h.ready()
	for {
		waitCtx, stop := context.WithTimeout(ctx, h.listenIdle)
		notification, err := conn.WaitForNotification(waitCtx)
		stop()
		if errors.Is(err, context.DeadlineExceeded) && ctx.Err() == nil {
			// Detect half-open DB sessions even when no accounts are changing.
			// This is one connection heartbeat, never a query of account lists.
			pingCtx, stop := context.WithTimeout(ctx, h.pingTimeout)
			err = conn.Ping(pingCtx)
			stop()
			if err == nil {
				continue
			}
		}
		if err != nil {
			return true, err
		}
		var change struct {
			Schema string `json:"schema"`
			UserID string `json:"userId"`
		}
		if json.Unmarshal([]byte(notification.Payload), &change) == nil && change.Schema == schema && change.UserID != "" {
			h.changed(change.UserID)
		}
	}
}
