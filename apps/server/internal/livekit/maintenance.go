package livekit

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"time"

	"companion/server/internal/auth"
	"github.com/redis/go-redis/v9"
)

var errCloseRequired = errors.New("room close queued")

func (h Handler) closeRetryKey() string { return h.ownerRoomKey("") + ":close-retries" }

func (h Handler) queueRoomClose(ctx context.Context, r *roomLifecycle, reason string) error {
	if r.Reason == "" {
		r.Reason = reason
	}
	if r.State != "closing" {
		r.State = "closing"
		r.RetryAt = h.clock().UnixMilli()
		r.Retries = 0
	}
	if r.RetryAt == 0 {
		r.RetryAt = h.clock().UnixMilli()
	}
	if err := h.saveLifecycle(ctx, r); err != nil {
		return err
	}
	return errCloseRequired
}

func closeBackoff(attempt int) time.Duration {
	delays := []time.Duration{time.Second, 2 * time.Second, 5 * time.Second, 10 * time.Second, 30 * time.Second, time.Minute}
	if attempt < 1 {
		attempt = 1
	}
	if attempt > len(delays) {
		attempt = len(delays)
	}
	return delays[attempt-1]
}

// Only explicitly closing records enter this path. It never enumerates normal
// rooms and never clears another room incarnation using a stale room SID.
func (h Handler) retryRoomClose(ctx context.Context, id string) error {
	unlock, err := h.lockClosing(ctx, id)
	if err != nil {
		return err
	}
	defer unlock()
	r, err := h.loadLifecycle(ctx, id)
	if err != nil {
		return err
	}
	if r == nil || r.State != "closing" {
		if h.RoomCache != nil {
			return h.RoomCache.ZRem(ctx, h.closeRetryKey(), id).Err()
		}
		return nil
	}
	if r.RetryAt > h.clock().UnixMilli() {
		return nil
	}
	slog.Info("room close retry started", "room", id, "attempt", r.Retries+1)
	return h.attemptCloseLocked(ctx, r)
}

func (h Handler) attemptCloseLocked(ctx context.Context, r *roomLifecycle) error {
	current, err := h.exactRoom(ctx, r.ID)
	if err == nil && current != nil {
		// A separately provisioned owned room is not the old session. Implicit
		// recreation from an old join token has no owner metadata and is removed.
		if r.SID == "" || current.SID == r.SID || current.OwnerID == "" {
			err = h.Client.DeleteRoom(ctx, r.ID)
			if err != nil {
				actual, verifyErr := h.exactRoom(ctx, r.ID)
				if verifyErr == nil && actual == nil {
					err = nil
				}
			}
		}
	}
	if err == nil {
		err = h.finishClosedRoom(ctx, r, r.Reason)
	}
	if err != nil {
		r.State = "closing"
		r.Retries++
		r.RetryAt = h.clock().Add(closeBackoff(r.Retries)).UnixMilli()
		if saveErr := h.saveLifecycle(ctx, r); saveErr != nil {
			return errors.Join(err, saveErr)
		}
	}
	return err
}

func (h Handler) nextRoomRetry(ctx context.Context) (string, time.Time, error) {
	if h.RoomCache != nil {
		jobs, err := h.RoomCache.ZRangeWithScores(ctx, h.closeRetryKey(), 0, 0).Result()
		if err != nil || len(jobs) == 0 {
			return "", time.Time{}, err
		}
		return jobs[0].Member.(string), time.UnixMilli(int64(jobs[0].Score)), nil
	}
	localRoomLifecycles.Lock()
	defer localRoomLifecycles.Unlock()
	var id string
	var due int64
	for key, r := range localRoomLifecycles.items {
		if strings.HasPrefix(key, h.lifecycleKey("")) && r.State == "closing" && r.RetryAt > 0 && (id == "" || r.RetryAt < due) {
			id, due = r.ID, r.RetryAt
		}
	}
	return id, time.UnixMilli(due), nil
}

// RunRoomRetries waits on known close deadlines and cache-change notifications.
// With no pending failure there is no timer and no repeated Cloud request.
func (h Handler) RunRoomRetries(ctx context.Context) {
	for ctx.Err() == nil {
		updates, err := h.SubscribeRoomUpdates(ctx)
		if err != nil {
			if !waitRoomRetry(ctx, 5*time.Second) {
				return
			}
			continue
		}
		for ctx.Err() == nil {
			id, at, err := h.nextRoomRetry(ctx)
			if err != nil {
				slog.Warn("room retry queue unavailable", "error", err)
				if !waitRoomRetry(ctx, 5*time.Second) {
					return
				}
				continue
			}
			if id == "" {
				select {
				case <-ctx.Done():
					return
				case _, ok := <-updates:
					if !ok {
						return
					}
				}
				continue
			}
			delay := at.Sub(h.clock())
			if delay > 0 {
				timer := time.NewTimer(delay)
				select {
				case <-ctx.Done():
					timer.Stop()
					return
				case <-updates:
					timer.Stop()
					continue
				case <-timer.C:
				}
			}
			jobCtx, cancel := context.WithTimeout(ctx, 25*time.Second)
			err = h.retryRoomClose(jobCtx, id)
			cancel()
			if err != nil && ctx.Err() == nil {
				slog.Warn("room close retry failed", "room", id, "error", err)
				// Redis/lock failures may prevent persisting a new deadline. Avoid
				// spinning against an unchanged due entry while storage is down.
				if !waitRoomRetry(ctx, time.Second) {
					return
				}
			}
		}
	}
}

func waitRoomRetry(ctx context.Context, d time.Duration) bool {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

// RunRoomMaintenance repairs startup failures and consumes durable close and
// observation deadlines, with at most two observation workers per process.
func RunRoomMaintenance(ctx context.Context, cfg Config, authentication auth.Handler, cache ...*redis.Client) {
	if !cfg.Enabled() {
		return
	}
	h := Handler{Client: NewClient(cfg), Auth: authentication}
	if len(cache) > 0 {
		h.RoomCache = cache[0]
	}
	var workers sync.WaitGroup
	workers.Add(3)
	go func() { defer workers.Done(); h.RunRoomRetries(ctx) }()
	for i := 0; i < 2; i++ {
		go func() { defer workers.Done(); h.runRoomChecks(ctx) }()
	}
	for attempt := 1; ctx.Err() == nil; attempt++ {
		// Do not use the manual-refresh cooldown: a skipped attempt is not a
		// successful startup synchronization.
		if err := h.syncAndPrepare(ctx); err == nil {
			break
		} else {
			slog.Warn("initial room synchronization failed", "error", err)
		}
		if !waitRoomRetry(ctx, closeBackoff(min(attempt, 5))) {
			break
		}
	}
	workers.Wait()
}
