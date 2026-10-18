package livekit

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestPendingRoomIDAndNameAreReservedAcrossOwners(t *testing.T) {
	for _, scoped := range []bool{false, true} {
		f := newOwnerRoomFixture(t)
		f.config.ScopedLocks = scoped
		f.failCreate = 1
		r := f.router()
		request(t, r, "POST", "/rooms", `{"id":"room-reserved","title":"First title"}`, 502)
		request(t, r, "POST", "/rooms", `{"id":"room-reserved","title":"Different title"}`, 409, "other-user")
		request(t, r, "POST", "/rooms", `{"id":"different-room","title":"FIRST TITLE"}`, 409, "other-user")
		result := request(t, r, "POST", "/rooms", `{"id":"room-ignored","title":"Ignored title"}`, 201)
		if result["item"].(map[string]any)["id"] != "room-reserved" {
			t.Fatal(result)
		}
		request(t, r, "DELETE", "/rooms/room-reserved", "", 200)
		request(t, r, "POST", "/rooms", `{"id":"room-next","title":"first title"}`, 201, "other-user")
	}
}

func TestScopedLocksSeparateRoomsButSerializeOwnersAndFoldedNames(t *testing.T) {
	f := newOwnerRoomFixture(t)
	f.config.ScopedLocks = true
	h := Handler{Client: NewClient(f.config)}
	ctx := context.Background()
	release, _, _, err := h.lockMutation(ctx, "owner-a", "room-a", "S", true)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	other, _, _, err := h.lockMutation(ctx, "owner-b", "room-b", "Other", true)
	if err != nil {
		t.Fatal(err)
	}
	other()
	for _, item := range []struct{ owner, id, title string }{{"owner-a", "room-c", "third"}, {"owner-c", "room-c", "ſ"}} {
		limited, cancel := context.WithTimeout(ctx, 30*time.Millisecond)
		unlock, _, _, err := h.lockMutation(limited, item.owner, item.id, item.title, true)
		cancel()
		if unlock != nil {
			unlock()
		}
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatal("conflicting mutation was not serialized", err)
		}
	}
}

func TestBackfillIncludesUncertainOwnersAndLegacyDuplicateNames(t *testing.T) {
	f := newOwnerRoomFixture(t)
	h := Handler{Client: NewClient(f.config)}
	ctx := context.Background()
	// Simulate pre-migration account records, before resource reservations exist.
	localOwnerRooms.Lock()
	localOwnerRooms.items[h.ownerRoomKey("owner-a")] = ownerRoom{ID: "pending-id", Title: "Pending", Pending: true}
	localOwnerRooms.Unlock()
	f.rooms["room-old-a"] = room{Name: "room-old-a", Metadata: `{"ownerId":"owner-a","title":"Legacy"}`}
	f.rooms["room-old-b"] = room{Name: "room-old-b", Metadata: `{"ownerId":"owner-b","title":"LEGACY"}`}
	f.globalStale = false
	if err := h.prepareRoomWrites(ctx); err != nil {
		t.Fatal(err)
	}
	if err := h.saveOwnerRoom(ctx, "owner-c", ownerRoom{ID: "pending-id", Title: "Other", Pending: true}); !errors.Is(err, errRoomReserved) {
		t.Fatal(err)
	}
	if err := h.saveOwnerRoom(ctx, "owner-c", ownerRoom{ID: "room-new", Title: "legacy", Pending: true}); !errors.Is(err, errRoomReserved) {
		t.Fatal(err)
	}
	if len(f.rooms) != 2 {
		t.Fatal("migration destroyed a legacy room")
	}
}
