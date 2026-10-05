package livekit

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// Reserve before calling LiveKit: its global list can lag behind creation, and
// an upstream timeout does not prove that creation failed. Redis keeps the
// reservation across API replicas/restarts; local fixtures share a process map.
type ownerRoom struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Pending bool   `json:"pending"`
}

var localOwnerRooms = struct {
	sync.Mutex
	items map[string]ownerRoom
}{items: make(map[string]ownerRoom)}

func (h Handler) ownerRoomKey(owner string) string {
	scope := sha256.Sum256([]byte(h.Client.config.URL + "\x00" + h.Client.config.APIKey))
	return fmt.Sprintf("livekit:owner-room:%x:%s", scope[:16], owner)
}

func (h Handler) loadOwnerRoom(ctx context.Context, owner string) (ownerRoom, error) {
	key := h.ownerRoomKey(owner)
	if h.RoomCache == nil {
		localOwnerRooms.Lock()
		defer localOwnerRooms.Unlock()
		return localOwnerRooms.items[key], nil
	}
	data, err := h.RoomCache.Get(ctx, key).Bytes()
	if errors.Is(err, redis.Nil) {
		return ownerRoom{}, nil
	}
	if err != nil {
		return ownerRoom{}, err
	}
	var result ownerRoom
	err = json.Unmarshal(data, &result)
	return result, err
}

func (h Handler) saveOwnerRoom(ctx context.Context, owner string, room ownerRoom) error {
	key := h.ownerRoomKey(owner)
	if h.RoomCache == nil {
		localOwnerRooms.Lock()
		defer localOwnerRooms.Unlock()
		if room.ID == "" {
			delete(localOwnerRooms.items, key)
		} else {
			localOwnerRooms.items[key] = room
		}
		return nil
	}
	if room.ID == "" {
		return h.RoomCache.Del(ctx, key).Err()
	}
	data, err := json.Marshal(room)
	if err != nil {
		return err
	}
	return h.RoomCache.Set(ctx, key, data, 0).Err()
}

func (h Handler) lockRoomCreation(ctx context.Context, closingRoom ...string) (func(), error) {
	if db := h.Auth.Service.Repo.DB; db != nil {
		tx, err := db.Begin(ctx)
		if err != nil {
			return nil, err
		}
		unlock := func() {
			cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = tx.Rollback(cleanup)
		}
		if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(716482901)"); err != nil {
			unlock()
			return nil, err
		}
		// Closing takes both locks on one database connection. Acquiring a
		// second connection here can exhaust the pool under concurrent closes.
		if len(closingRoom) > 0 {
			if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", int64(voiceLockKey(closingRoom[0]))); err != nil {
				unlock()
				return nil, err
			}
		}
		return unlock, nil
	}
	roomCreationMu.Lock()
	if len(closingRoom) > 0 {
		unlockVoice, err := h.lockVoice(ctx, closingRoom[0])
		if err != nil {
			roomCreationMu.Unlock()
			return nil, err
		}
		return func() { unlockVoice(); roomCreationMu.Unlock() }, nil
	}
	return roomCreationMu.Unlock, nil
}

func (h Handler) exactRoom(ctx context.Context, id string) (*RoomItem, error) {
	items, err := h.Client.ListRooms(ctx, id)
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		if item.ID == id {
			return &item, nil
		}
	}
	return nil, nil
}

// Include the caller's newly created room even before the global listing catches
// up. Reads never clear reservations: a create may still be in flight.
func (h Handler) includeOwnerRoom(ctx context.Context, owner string, items []RoomItem) ([]RoomItem, error) {
	if owner == "" {
		return items, nil
	}
	reserved, err := h.loadOwnerRoom(ctx, owner)
	if err != nil || reserved.ID == "" {
		return items, err
	}
	current, err := h.exactRoom(ctx, reserved.ID)
	if err != nil {
		return nil, err
	}
	filtered := make([]RoomItem, 0, len(items)+1)
	for _, item := range items {
		if item.ID != reserved.ID {
			filtered = append(filtered, item)
		}
	}
	if current != nil {
		filtered = append(filtered, *current)
	}
	return filtered, nil
}
