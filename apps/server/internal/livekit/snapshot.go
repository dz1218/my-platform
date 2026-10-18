package livekit

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

type RoomSnapshot struct {
	Item              RoomItem `json:"item"`
	State             string   `json:"state"`
	Reason            string   `json:"reason,omitempty"`
	HostConnection    string   `json:"hostConnection,omitempty"`
	ReconnectDeadline int64    `json:"reconnectDeadline,omitempty"`
}

var ErrRoomSnapshotsNotReady = errors.New("room snapshots have not been initialized")
var localSnapshotReadiness sync.Map

func (h Handler) snapshotReadyKey() string { return h.ownerRoomKey("") + ":snapshots-ready" }
func (h Handler) snapshotsReady(ctx context.Context) (bool, error) {
	if h.RoomCache == nil {
		_, ok := localSnapshotReadiness.Load(h.snapshotReadyKey())
		return ok, nil
	}
	n, err := h.RoomCache.Exists(ctx, h.snapshotReadyKey()).Result()
	return n > 0, err
}
func (h Handler) markSnapshotsReady(ctx context.Context) error {
	if h.RoomCache == nil {
		localSnapshotReadiness.Store(h.snapshotReadyKey(), true)
		h.publishLocalRoomUpdate("")
		return nil
	}
	_, err := h.RoomCache.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
		pipe.Set(ctx, h.snapshotReadyKey(), "1", 0)
		pipe.Publish(ctx, h.RoomUpdatesChannel(), "")
		return nil
	})
	return err
}
func cachedRoomsFailed(c *gin.Context, err error) bool {
	if errors.Is(err, ErrRoomSnapshotsNotReady) {
		failRoom(c, http.StatusServiceUnavailable, "room_state_unavailable", "直播间状态正在同步，请稍后重试")
		return true
	}
	return upstreamFailed(c, err)
}

// Cached reads do not contact LiveKit or take room/creation locks. Permissions
// are calculated by the HTTP/WS caller, never stored in the shared snapshot.
func (h Handler) CachedRoom(ctx context.Context, id string) (*RoomSnapshot, error) {
	r, err := h.loadLifecycle(ctx, id)
	if err != nil {
		return nil, err
	}
	if r == nil {
		ready, err := h.snapshotsReady(ctx)
		if err != nil {
			return nil, err
		}
		if !ready {
			return nil, ErrRoomSnapshotsNotReady
		}
		return nil, nil
	}
	connection := r.HostConnection
	if connection == "" {
		connection = "waiting"
		if r.HadHost {
			connection = "connected"
		}
	}
	return &RoomSnapshot{Item: r.item(), State: r.State, Reason: r.Reason, HostConnection: connection, ReconnectDeadline: r.ReconnectDeadline}, nil
}

func (h Handler) CachedRooms(ctx context.Context) ([]RoomItem, error) {
	ids, err := h.lifecycleRoomIDs(ctx)
	if err != nil {
		return nil, err
	}
	items := make([]RoomItem, 0, len(ids))
	if len(ids) == 0 {
		ready, err := h.snapshotsReady(ctx)
		if err != nil {
			return nil, err
		}
		if !ready {
			return nil, ErrRoomSnapshotsNotReady
		}
	}
	for _, id := range ids {
		r, err := h.loadLifecycle(ctx, id)
		if err != nil {
			return nil, err
		}
		if r != nil && r.State == "open" {
			items = append(items, r.item())
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].ID < items[j].ID })
	return items, nil
}

func (h Handler) RoomUpdatesChannel() string { return h.ownerRoomKey("") + ":updates" }

type roomUpdateHub struct {
	sync.Mutex
	subscribers map[chan string]struct{}
	pubsub      *redis.PubSub
	ready       chan struct{}
	err         error
	cancel      context.CancelFunc
}

// Each process owns at most one Redis subscription per LiveKit scope. Local
// fixtures use the same fanout and receive identical invalidation semantics.
var roomUpdateHubs = struct {
	sync.Mutex
	items map[string]*roomUpdateHub
}{items: make(map[string]*roomUpdateHub)}

func (hub *roomUpdateHub) broadcast(id string) {
	hub.Lock()
	defer hub.Unlock()
	for ch := range hub.subscribers {
		select {
		case ch <- id:
		default:
			// Slow consumers must re-read a complete snapshot, not silently miss
			// a removal. Coalesce a saturated queue to a full resync marker.
			draining := true
			for draining {
				select {
				case <-ch:
				default:
					draining = false
				}
			}
			ch <- ""
		}
	}
}

func (h Handler) publishLocalRoomUpdate(id string) {
	roomUpdateHubs.Lock()
	hub := roomUpdateHubs.items[h.RoomUpdatesChannel()]
	roomUpdateHubs.Unlock()
	if hub != nil {
		hub.broadcast(id)
	}
}

func (h Handler) SubscribeRoomUpdates(ctx context.Context) (<-chan string, error) {
	key := h.RoomUpdatesChannel()
	roomUpdateHubs.Lock()
	hub := roomUpdateHubs.items[key]
	if hub == nil {
		hub = &roomUpdateHub{subscribers: make(map[chan string]struct{}), ready: make(chan struct{})}
		roomUpdateHubs.items[key] = hub
		if h.RoomCache == nil {
			close(hub.ready)
		} else {
			lifetime, cancel := context.WithCancel(context.Background())
			hub.cancel = cancel
			hub.pubsub = h.RoomCache.Subscribe(lifetime, key)
			go hub.receive(lifetime)
		}
	}
	ch := make(chan string, 16)
	hub.Lock()
	hub.subscribers[ch] = struct{}{}
	hub.Unlock()
	roomUpdateHubs.Unlock()
	remove := func() {
		roomUpdateHubs.Lock()
		defer roomUpdateHubs.Unlock()
		hub.Lock()
		delete(hub.subscribers, ch)
		close(ch)
		empty := len(hub.subscribers) == 0
		hub.Unlock()
		if empty && roomUpdateHubs.items[key] == hub {
			delete(roomUpdateHubs.items, key)
			if hub.cancel != nil {
				hub.cancel()
			}
			if hub.pubsub != nil {
				_ = hub.pubsub.Close()
			}
		}
	}
	select {
	case <-ctx.Done():
		remove()
		return nil, ctx.Err()
	case <-hub.ready:
		if hub.err != nil {
			remove()
			return nil, hub.err
		}
	}
	go func() { <-ctx.Done(); remove() }()
	return ch, nil
}

func (hub *roomUpdateHub) receive(ctx context.Context) {
	// Receive the SUBSCRIBE acknowledgement before allowing an initial cache
	// snapshot, so updates cannot fall into the subscribe/snapshot gap.
	_, err := hub.pubsub.Receive(ctx)
	hub.err = err
	close(hub.ready)
	if err != nil {
		return
	}
	// Keep one healthy Redis transport per process. This heartbeat never calls
	// LiveKit; reconnect subscription acknowledgements request a cache resync.
	messages := hub.pubsub.ChannelWithSubscriptions(redis.WithChannelHealthCheckInterval(30 * time.Second))
	for {
		select {
		case <-ctx.Done():
			return
		case message, ok := <-messages:
			if !ok {
				return
			}
			switch value := message.(type) {
			case *redis.Message:
				hub.broadcast(value.Payload)
			case *redis.Subscription:
				hub.broadcast("")
			}
		}
	}
}

// SyncRooms is an explicit one-shot reconciliation (startup/manual refresh).
// It is never scheduled periodically and never called by ordinary GET/WS reads.
func (h Handler) SyncRooms(ctx context.Context) error {
	rooms, err := h.Client.ListRooms(ctx)
	if err != nil {
		return err
	}
	ids, err := h.lifecycleRoomIDs(ctx)
	if err != nil {
		return err
	}
	seen := make(map[string]bool, len(ids)+len(rooms))
	for _, r := range rooms {
		seen[r.ID] = true
	}
	for _, id := range ids {
		seen[id] = true
	}
	var failures []error
	for id := range seen {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err := h.ReconcileRoom(ctx, id); err != nil {
			failures = append(failures, err)
		}
	}
	if err := errors.Join(failures...); err != nil {
		return err
	}
	return h.markSnapshotsReady(ctx)
}

type refreshFlight struct {
	done chan struct{}
	err  error
}

var localRoomRefreshes = struct {
	sync.Mutex
	flights map[string]*refreshFlight
	expires map[string]time.Time
}{flights: make(map[string]*refreshFlight), expires: make(map[string]time.Time)}

// Coalesce callers in this process and throttle attempts across all replicas.
// A second replica returns its existing snapshot instead of re-querying Cloud.
func (h Handler) refreshOnce(ctx context.Context, id string, run func(context.Context) error) error {
	key := h.ownerRoomKey("") + ":refresh:" + id
	localRoomRefreshes.Lock()
	if flight := localRoomRefreshes.flights[key]; flight != nil {
		localRoomRefreshes.Unlock()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-flight.done:
			return flight.err
		}
	}
	if h.RoomCache == nil && time.Now().Before(localRoomRefreshes.expires[key]) {
		localRoomRefreshes.Unlock()
		return nil
	}
	flight := &refreshFlight{done: make(chan struct{})}
	localRoomRefreshes.flights[key] = flight
	localRoomRefreshes.Unlock()
	defer func() {
		localRoomRefreshes.Lock()
		delete(localRoomRefreshes.flights, key)
		close(flight.done)
		localRoomRefreshes.Unlock()
	}()
	cooldown := 10 * time.Second
	if id == "all" {
		cooldown = 30 * time.Second
	}
	if h.RoomCache != nil {
		ok, err := h.RoomCache.SetNX(ctx, key, "1", cooldown).Result()
		if err != nil {
			flight.err = err
			return err
		}
		if !ok {
			return nil
		}
	} else {
		localRoomRefreshes.Lock()
		localRoomRefreshes.expires[key] = time.Now().Add(cooldown)
		localRoomRefreshes.Unlock()
	}
	flight.err = run(ctx)
	return flight.err
}

func (h Handler) refreshRooms(c *gin.Context) {
	if upstreamFailed(c, h.refreshOnce(c.Request.Context(), "all", h.SyncRooms)) {
		return
	}
	h.list(c)
}

func (h Handler) refreshRoom(c *gin.Context) {
	id := c.Param("roomId")
	if upstreamFailed(c, h.refreshOnce(c.Request.Context(), "room:"+id, func(ctx context.Context) error { return h.ReconcileRoom(ctx, id) })) {
		return
	}
	h.roomDetail(c)
}
