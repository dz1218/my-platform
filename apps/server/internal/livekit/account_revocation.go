package livekit

import (
	"context"
	"errors"
)

// Version is recorded in both trusted room metadata and the cached lifecycle.
// Re-reading under the ordinary closing lock fences late jobs to the old room
// incarnation. Existing close retries remain responsible for upstream failures.
func (h Handler) CloseRevokedRooms(ctx context.Context, userID string, version int64) error {
	rooms, err := h.Client.ListRooms(ctx)
	if err != nil {
		return err
	}
	candidates := map[string]bool{}
	// The global upstream list can lag. The owner's reservation also supplies
	// a name for an exact lookup when creation succeeded before cache adoption.
	reserved, err := h.loadOwnerRoom(ctx, userID)
	if err != nil {
		return err
	}
	if reserved.ID != "" {
		candidates[reserved.ID] = true
	}
	for _, r := range rooms {
		if r.OwnerID == userID && r.SessionVersion < version {
			candidates[r.ID] = true
		}
	}
	ids, err := h.lifecycleRoomIDs(ctx)
	if err != nil {
		return err
	}
	for _, id := range ids {
		r, err := h.loadLifecycle(ctx, id)
		if err != nil {
			return err
		}
		if r != nil && r.OwnerID == userID && r.SessionVersion < version {
			candidates[id] = true
		}
	}
	for id := range candidates {
		if err := h.closeRevokedRoom(ctx, id, userID, version); err != nil {
			return err
		}
	}
	return nil
}

func (h Handler) closeRevokedRoom(ctx context.Context, id, userID string, version int64) error {
	unlock, err := h.lockClosing(ctx, id)
	if err != nil {
		return err
	}
	defer unlock()
	current, err := h.exactRoom(ctx, id)
	if err != nil {
		return err
	}
	record, err := h.loadLifecycle(ctx, id)
	if err != nil {
		return err
	}
	if current != nil {
		if current.OwnerID != userID || current.SessionVersion >= version {
			return nil
		}
		if record != nil && record.SID != "" && record.SID != current.SID {
			return nil
		}
		if record == nil {
			record = lifecycleForRoom(*current)
		}
	}
	if record == nil || record.OwnerID != userID || record.SessionVersion >= version || record.State == "closed" {
		return nil
	}
	if err = h.queueRoomClose(ctx, record, "password_changed"); !errors.Is(err, errCloseRequired) {
		return err
	}
	return h.attemptCloseLocked(ctx, record)
}
