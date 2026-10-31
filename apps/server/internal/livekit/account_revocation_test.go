package livekit

import (
	"companion/server/internal/auth"
	"companion/server/pkg/database"
	"context"
	"github.com/gin-gonic/gin"
	"golang.org/x/net/websocket"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"
	"time"
)

func TestPasswordRevocationClosesOldRoomAndRetriesWithoutClosingNewRoom(t *testing.T) {
	f := newLifecycleFixture(t)
	ctx := context.Background()
	f.connect(t, "password-revoke-attempt")
	f.Lock()
	f.failDelete = true
	f.Unlock()
	if err := f.h.CloseRevokedRooms(ctx, "test-user", 1); err == nil {
		t.Fatal("failed upstream delete accepted as complete")
	}
	r, err := f.h.loadLifecycle(ctx, "room-host")
	if err != nil || r.State != "closing" || r.Reason != "password_changed" {
		t.Fatal(r, err)
	}
	f.Lock()
	f.failDelete = false
	f.Unlock()
	if err = f.h.CloseRevokedRooms(ctx, "test-user", 1); err != nil {
		t.Fatal(err)
	}
	f.Lock()
	_, old := f.rooms["room-host"]
	_, other := f.rooms["room-other"]
	f.Unlock()
	if old || !other {
		t.Fatal("incorrect room cleanup", old, other)
	}
	item, err := f.h.Client.CreateRoom(ctx, "room-new", "新直播", "test-user", 1)
	if err != nil || item.SessionVersion != 1 {
		t.Fatal(item, err)
	}
	if err = f.h.initLifecycle(ctx, item); err != nil {
		t.Fatal(err)
	}
	if err = f.h.CloseRevokedRooms(ctx, "test-user", 1); err != nil {
		t.Fatal(err)
	}
	f.Lock()
	_, fresh := f.rooms["room-new"]
	f.Unlock()
	if !fresh {
		t.Fatal("late revocation closed the new session's room")
	}
}

func TestPasswordRevocationLiveKitIntegration(t *testing.T) {
	if os.Getenv("LIVEKIT_INTEGRATION") != "1" {
		t.Skip("set LIVEKIT_INTEGRATION=1 to test local LiveKit cleanup")
	}
	cfg := Config{URL: "http://127.0.0.1:7880", APIKey: "devkey", APISecret: "devsecretdevsecretdevsecretdevsec"}
	h := Handler{Client: NewClient(cfg)}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	owner := "password-integration-" + database.ID()
	ids := []string{owner + "-old", owner + "-new"}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		for _, id := range ids {
			rooms, err := h.Client.ListRooms(cleanup, id)
			if err != nil {
				t.Error(err)
				continue
			}
			if len(rooms) > 0 {
				if err = h.Client.DeleteRoom(cleanup, id); err != nil {
					t.Error(err)
				}
			}
		}
	})
	for i, id := range ids {
		item, err := h.Client.CreateRoom(ctx, id, "密码撤销集成测试", owner, int64(i))
		if err != nil {
			t.Fatal(err)
		}
		if item.SessionVersion != int64(i) {
			t.Fatal("room version lost", item)
		}
		if err = h.initLifecycle(ctx, item); err != nil {
			t.Fatal(err)
		}
	}
	if err := h.CloseRevokedRooms(ctx, owner, 1); err != nil {
		t.Fatal(err)
	}
	for i, id := range ids {
		rooms, err := h.Client.ListRooms(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		if len(rooms) != i {
			t.Fatalf("room %s count %d, want %d", id, len(rooms), i)
		}
	}
}

func TestRoomSocketTicketsAreBoundToSessionVersion(t *testing.T) {
	h := socketTicketHandler()
	version := int64(0)
	h.Auth.Service.VersionLookup = func(context.Context, string) (int64, error) { return version, nil }
	old, err := h.signRoomSocketTicket("owner", "room-owner", "http://web", 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = h.verifyRoomSocketTicket(old, "room-owner", "http://web"); err != nil {
		t.Fatal(err)
	}
	version = 1
	if _, err = h.verifyRoomSocketTicket(old, "room-owner", "http://web"); err != auth.ErrInvalidSession {
		t.Fatal("old ticket survived", err)
	}
	fresh, _ := h.signRoomSocketTicket("owner", "room-owner", "http://web", 1)
	if _, err = h.verifyRoomSocketTicket(fresh, "room-owner", "http://web"); err != nil {
		t.Fatal(err)
	}
	guest, _ := h.signRoomSocketTicket("", "room-owner", "http://web")
	if _, err = h.verifyRoomSocketTicket(guest, "room-owner", "http://web"); err != nil {
		t.Fatal("guest affected by account change", err)
	}
}

func TestRevokedRoomConnectionStopsSnapshots(t *testing.T) {
	var version atomic.Int64
	f := &snapshotFixture{items: []RoomItem{{ID: "room-owner", OwnerID: "owner"}}, subs: make(map[chan string]bool), closed: make(chan struct{}, 2)}
	h := Handler{Client: NewClient(Config{URL: "ws://unused", APIKey: "key", APISecret: "secret"}), Auth: auth.Handler{Service: auth.Service{Secret: "socket-test-secret", VersionLookup: func(context.Context, string) (int64, error) { return version.Load(), nil }}}}
	r := gin.New()
	r.GET(RoomSocketPath, h.roomSocket(f, "http://web"))
	server := httptest.NewServer(r)
	defer server.Close()
	ws, err := dialRoomSocket(t, server, "owner", "", "http://web")
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()
	_ = ws.SetDeadline(time.Now().Add(5 * time.Second))
	var event map[string]any
	if err = websocket.JSON.Receive(ws, &event); err != nil || event["type"] != "rooms.updated" {
		t.Fatal(event, err)
	}
	version.Store(1)
	f.publish("room-owner")
	if err = websocket.JSON.Receive(ws, &event); err != nil || event["type"] != "session.invalidated" {
		t.Fatal(event, err)
	}
}
