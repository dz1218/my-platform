package livekit

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"unicode"

	"github.com/redis/go-redis/v9"
)

var errRoomReserved = errors.New("room name or ID is reserved")

type roomReservation struct {
	ownerRoom
	Owner string `json:"owner"`
}

var localResources = struct {
	sync.Mutex
	ids   map[string]roomReservation
	names map[string]map[string]bool
}{ids: map[string]roomReservation{}, names: map[string]map[string]bool{}}

// EqualFold uses Unicode simple folding, which is not equivalent to ToLower
// (e.g. S and the long s). Choose one representative of each fold cycle.
func foldRoomTitle(title string) string {
	return strings.Map(func(r rune) rune {
		best := r
		for next := unicode.SimpleFold(r); next != r; next = unicode.SimpleFold(next) {
			if next < best {
				best = next
			}
		}
		return best
	}, strings.TrimSpace(title))
}
func (h Handler) idReservationKey(id string) string { return h.ownerRoomKey("") + ":reserved-id:" + id }
func (h Handler) nameReservationKey(title string) string {
	sum := sha256.Sum256([]byte(foldRoomTitle(title)))
	return fmt.Sprintf("%s:reserved-title:%x", h.ownerRoomKey(""), sum[:16])
}

var reserveResourcesScript = redis.NewScript(`
local id=redis.call('GET',KEYS[2])
if id and cjson.decode(id).owner~=ARGV[1] then return 0 end
local members=redis.call('SMEMBERS',KEYS[3])
if ARGV[5]=='reserve' then
 for _,member in ipairs(members) do if member~=ARGV[2] then return 0 end end
end
if KEYS[4]~=KEYS[2] then
 local old=redis.call('GET',KEYS[4])
 if old and cjson.decode(old).owner==ARGV[1] then
  redis.call('DEL',KEYS[4]);redis.call('SREM',KEYS[5],cjson.decode(old).id)
 end
end
redis.call('SET',KEYS[2],ARGV[4]);redis.call('SADD',KEYS[3],ARGV[2])
if ARGV[5]~='backfill' then redis.call('SET',KEYS[1],ARGV[3]) end
return 1`)
var releaseResourcesScript = redis.NewScript(`
local id=redis.call('GET',KEYS[2])
if id and cjson.decode(id).owner==ARGV[1] then redis.call('DEL',KEYS[2]);redis.call('SREM',KEYS[3],ARGV[2]) end
local owner=redis.call('GET',KEYS[1])
if owner and cjson.decode(owner).id==ARGV[2] then redis.call('DEL',KEYS[1]) end
return 1`)

func (h Handler) reserveResources(ctx context.Context, owner string, room ownerRoom, backfill bool) error {
	old, err := h.loadOwnerRoom(ctx, owner)
	if err != nil {
		return err
	}
	if backfill {
		old = room
	}
	resource := roomReservation{ownerRoom: room, Owner: owner}
	if h.RoomCache != nil {
		data, _ := json.Marshal(room)
		resourceData, _ := json.Marshal(resource)
		mode := "reserve"
		if !room.Pending {
			mode = "adopt"
		}
		if backfill {
			mode = "backfill"
		}
		n, err := reserveResourcesScript.Run(ctx, h.RoomCache, []string{h.ownerRoomKey(owner), h.idReservationKey(room.ID), h.nameReservationKey(room.Title), h.idReservationKey(old.ID), h.nameReservationKey(old.Title)}, owner, room.ID, string(data), string(resourceData), mode).Int()
		if err != nil {
			return err
		}
		if n != 1 {
			return errRoomReserved
		}
		return nil
	}
	localResources.Lock()
	defer localResources.Unlock()
	idKey, nameKey := h.idReservationKey(room.ID), h.nameReservationKey(room.Title)
	if existing, ok := localResources.ids[idKey]; ok && existing.Owner != owner {
		return errRoomReserved
	}
	if !backfill && room.Pending {
		for id := range localResources.names[nameKey] {
			if id != room.ID {
				return errRoomReserved
			}
		}
	}
	if old.ID != room.ID {
		if existing, ok := localResources.ids[h.idReservationKey(old.ID)]; ok && existing.Owner == owner {
			delete(localResources.ids, h.idReservationKey(old.ID))
			delete(localResources.names[h.nameReservationKey(old.Title)], old.ID)
		}
	}
	localResources.ids[idKey] = resource
	if localResources.names[nameKey] == nil {
		localResources.names[nameKey] = map[string]bool{}
	}
	localResources.names[nameKey][room.ID] = true
	if !backfill {
		localOwnerRooms.Lock()
		localOwnerRooms.items[h.ownerRoomKey(owner)] = room
		localOwnerRooms.Unlock()
	}
	return nil
}

func (h Handler) releaseResources(ctx context.Context, owner string, room ownerRoom) error {
	if h.RoomCache != nil {
		return releaseResourcesScript.Run(ctx, h.RoomCache, []string{h.ownerRoomKey(owner), h.idReservationKey(room.ID), h.nameReservationKey(room.Title)}, owner, room.ID).Err()
	}
	localResources.Lock()
	defer localResources.Unlock()
	if current, ok := localResources.ids[h.idReservationKey(room.ID)]; ok && current.Owner == owner {
		delete(localResources.ids, h.idReservationKey(room.ID))
		delete(localResources.names[h.nameReservationKey(room.Title)], room.ID)
	}
	localOwnerRooms.Lock()
	defer localOwnerRooms.Unlock()
	if localOwnerRooms.items[h.ownerRoomKey(owner)].ID == room.ID {
		delete(localOwnerRooms.items, h.ownerRoomKey(owner))
	}
	return nil
}

// Backfill pending account reservations as well as existing rooms; multiple
// legacy IDs may intentionally occupy one name. New creates then fail closed.
func (h Handler) backfillResources(ctx context.Context) error {
	owners := map[string]ownerRoom{}
	if h.RoomCache != nil {
		var cursor uint64
		for {
			keys, next, err := h.RoomCache.Scan(ctx, cursor, h.ownerRoomKey("")+"*", 100).Result()
			if err != nil {
				return err
			}
			for _, key := range keys {
				owner := strings.TrimPrefix(key, h.ownerRoomKey(""))
				if owner == "" || strings.Contains(owner, ":") {
					continue
				}
				room, err := h.loadOwnerRoom(ctx, owner)
				if err != nil {
					return err
				}
				if room.ID != "" {
					owners[owner] = room
				}
			}
			cursor = next
			if cursor == 0 {
				break
			}
		}
	} else {
		localOwnerRooms.Lock()
		for key, room := range localOwnerRooms.items {
			if strings.HasPrefix(key, h.ownerRoomKey("")) {
				owners[strings.TrimPrefix(key, h.ownerRoomKey(""))] = room
			}
		}
		localOwnerRooms.Unlock()
	}
	for owner, room := range owners {
		if err := h.reserveResources(ctx, owner, room, true); err != nil {
			return err
		}
	}
	rooms, err := h.Client.ListRooms(ctx)
	if err != nil {
		return err
	}
	for _, room := range rooms {
		if room.OwnerID == "" {
			continue
		}
		if err := h.reserveResources(ctx, room.OwnerID, ownerRoom{ID: room.ID, Title: room.Title}, true); err != nil {
			return err
		}
	}
	return nil
}
