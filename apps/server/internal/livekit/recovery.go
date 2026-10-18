package livekit

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"
)

func (h Handler) checkQueueKey() string { return h.ownerRoomKey("") + ":checks" }

func (h Handler) nextRoomCheck(ctx context.Context) (string, time.Time, error) {
	if h.RoomCache != nil {
		jobs, err := h.RoomCache.ZRangeWithScores(ctx, h.checkQueueKey(), 0, 0).Result()
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
		if strings.HasPrefix(key, h.lifecycleKey("")) && r.State == "open" && r.CheckAt > 0 && (id == "" || r.CheckAt < due) {
			id, due = r.ID, r.CheckAt
		}
	}
	return id, time.UnixMilli(due), nil
}

// Re-read under the shared room lock. Another replica, webhook or recovered
// host may have completed/rescheduled this job while we waited for the lock.
func (h Handler) checkRoomDue(ctx context.Context, id string) error {
	unlock, err := h.lockVoice(ctx, id)
	if err != nil {
		return err
	}
	r, err := h.loadLifecycle(ctx, id)
	if err != nil {
		unlock()
		return err
	}
	if r == nil || r.State != "open" {
		if h.RoomCache != nil {
			err = h.RoomCache.ZRem(ctx, h.checkQueueKey(), id).Err()
		}
		unlock()
		return err
	}
	if r.CheckAt > h.clock().UnixMilli() {
		unlock()
		return nil
	}
	err = h.reconcileRoomLocked(ctx, RoomLifecycleEvent{RoomID: id})
	if err != nil && !errors.Is(err, errCloseRequired) {
		// Reconciliation can persist an intermediate observation. Never write
		// the pre-RPC copy back over that newer lifecycle.
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
		latest, readErr := h.loadLifecycle(cleanup, id)
		if readErr == nil && latest != nil && latest.State == "open" {
			latest.CheckRetries++
			latest.CheckAt = h.clock().Add(closeBackoff(latest.CheckRetries)).UnixMilli()
			readErr = h.saveLifecycle(cleanup, latest)
		}
		cancel()
		err = errors.Join(err, readErr)
	} else if err == nil {
		latest, readErr := h.loadLifecycle(ctx, id)
		if readErr == nil && latest != nil && latest.State == "open" {
			latest.CheckRetries = 0
			if latest.CheckAt <= h.clock().UnixMilli() {
				latest.CheckAt = h.clock().Add(time.Minute).UnixMilli()
			}
			readErr = h.saveLifecycle(ctx, latest)
		}
		err = readErr
	}
	unlock()
	if errors.Is(err, errCloseRequired) {
		return h.retryRoomClose(ctx, id)
	}
	return err
}

func (h Handler) runRoomChecks(ctx context.Context) {
	// Queue reads are cheap Redis operations; ordinary GET/WS reads never query
	// LiveKit. A bounded wakeup also repairs missed PubSub notifications.
	for ctx.Err() == nil {
		id, at, err := h.nextRoomCheck(ctx)
		if err != nil || id == "" {
			if !waitRoomRetry(ctx, time.Second) {
				return
			}
			continue
		}
		if delay := at.Sub(h.clock()); delay > 0 {
			if !waitRoomRetry(ctx, min(delay, time.Second)) {
				return
			}
			continue
		}
		job, cancel := context.WithTimeout(ctx, 25*time.Second)
		err = h.checkRoomDue(job, id)
		cancel()
		if err != nil {
			slog.Warn("room observation retry failed", "room", id, "error", err)
			if !waitRoomRetry(ctx, time.Second) {
				return
			}
		}
	}
}
