package livekit

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"companion/server/internal/auth"
	"github.com/gin-gonic/gin"
	"golang.org/x/net/websocket"
)

type snapshotFixture struct {
	sync.Mutex
	items  []RoomItem
	detail *RoomSnapshot
	subs   map[chan string]bool
	reads  int
	closed chan struct{}
	err    error
}

func (f *snapshotFixture) CachedRooms(context.Context) ([]RoomItem, error) {
	f.Lock()
	defer f.Unlock()
	f.reads++
	if f.err != nil {
		return nil, f.err
	}
	if len(f.subs) == 0 {
		return nil, fmt.Errorf("snapshot before subscription")
	}
	return f.items, nil
}
func (f *snapshotFixture) CachedRoom(context.Context, string) (*RoomSnapshot, error) {
	f.Lock()
	defer f.Unlock()
	f.reads++
	return f.detail, f.err
}
func (f *snapshotFixture) SubscribeRoomUpdates(ctx context.Context) (<-chan string, error) {
	f.Lock()
	ch := make(chan string, 4)
	f.subs[ch] = true
	f.Unlock()
	go func() {
		<-ctx.Done()
		f.Lock()
		delete(f.subs, ch)
		close(ch)
		f.Unlock()
		f.closed <- struct{}{}
	}()
	return ch, nil
}
func (f *snapshotFixture) publish(room string) {
	f.Lock()
	defer f.Unlock()
	for ch := range f.subs {
		ch <- room
	}
}

func roomSocketFixture(t *testing.T) (*snapshotFixture, *httptest.Server) {
	t.Helper()
	f := &snapshotFixture{
		items: []RoomItem{{ID: "room-owner", SID: "RM_private", OwnerID: "owner", Title: "房间", Status: "准备中"}},
		subs:  make(map[chan string]bool), closed: make(chan struct{}, 10),
	}
	h := Handler{Client: NewClient(Config{URL: "ws://unused", APIKey: "key", APISecret: "secret"}), Auth: auth.Handler{Service: auth.Service{Secret: "socket-test-secret"}}}
	r := gin.New()
	r.GET(RoomSocketPath, h.roomSocket(f, "http://web"))
	server := httptest.NewServer(r)
	t.Cleanup(server.Close)
	return f, server
}

func dialRoomSocket(t *testing.T, server *httptest.Server, user, query, origin string) (*websocket.Conn, error) {
	t.Helper()
	cfg, err := websocket.NewConfig("ws"+strings.TrimPrefix(server.URL, "http")+RoomSocketPath+query, origin)
	if err != nil {
		t.Fatal(err)
	}
	if user != "" {
		token, err := (auth.Service{Secret: "socket-test-secret"}).Token(user)
		if err != nil {
			t.Fatal(err)
		}
		cfg.Header.Set("Cookie", auth.CookieName+"="+token)
	}
	return websocket.DialConfig(cfg)
}

func socketEvent(t *testing.T, ws *websocket.Conn) map[string]json.RawMessage {
	t.Helper()
	_ = ws.SetReadDeadline(time.Now().Add(3 * time.Second))
	var event map[string]json.RawMessage
	if err := websocket.JSON.Receive(ws, &event); err != nil {
		t.Fatal(err)
	}
	return event
}

func TestRoomSocketGuestAndAccountSnapshots(t *testing.T) {
	f, server := roomSocketFixture(t)
	for _, user := range []string{"", "owner", "someone-else"} {
		ws, err := dialRoomSocket(t, server, user, "?userId=owner", "http://web")
		if err != nil {
			t.Fatal(err)
		}
		event := socketEvent(t, ws)
		var items []map[string]any
		if err := json.Unmarshal(event["items"], &items); err != nil {
			t.Fatal(err)
		}
		if string(event["type"]) != `"rooms.updated"` || len(items) != 1 || items[0]["canManage"] != (user == "owner") {
			t.Fatalf("user %q: %s", user, event["items"])
		}
		for _, private := range []string{"ownerId", "sid", "host", "token"} {
			if _, exists := items[0][private]; exists {
				t.Fatalf("private field %q leaked", private)
			}
		}
		if err := websocket.JSON.Send(ws, map[string]string{"type": "pong"}); err != nil {
			t.Fatal(err)
		}
		ws.Close()
		select {
		case <-f.closed:
		case <-time.After(time.Second):
			t.Fatal("subscription leaked")
		}
	}
	f.Lock()
	defer f.Unlock()
	if f.items[0].CanManage || f.reads != 3 {
		t.Fatalf("shared snapshot mutated or polled: %+v, reads=%d", f.items, f.reads)
	}
}

func TestRoomSocketPushesChangesAndReconnectsWithFullSnapshot(t *testing.T) {
	f, server := roomSocketFixture(t)
	ws, err := dialRoomSocket(t, server, "", "", "http://web")
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()
	_ = socketEvent(t, ws)
	f.Lock()
	f.items = []RoomItem{}
	f.Unlock()
	f.publish("room-owner")
	event := socketEvent(t, ws)
	if string(event["items"]) != "[]" {
		t.Fatal("closed room still listed", string(event["items"]))
	}
	ws.Close()
	select {
	case <-f.closed:
	case <-time.After(time.Second):
		t.Fatal("subscription leaked")
	}
	ws, err = dialRoomSocket(t, server, "", "", "http://web")
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()
	if event = socketEvent(t, ws); string(event["items"]) != "[]" {
		t.Fatal("reconnect lost current state")
	}
}

func TestRoomSocketDetailClosedAndMissing(t *testing.T) {
	f, server := roomSocketFixture(t)
	f.detail = &RoomSnapshot{Item: f.items[0], State: "open"}
	ws, err := dialRoomSocket(t, server, "owner", "?roomId=room-owner", "http://web")
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()
	event := socketEvent(t, ws)
	var detail RoomSnapshot
	if err := json.Unmarshal(event["detail"], &detail); err != nil {
		t.Fatal(err)
	}
	if !detail.Item.CanManage || detail.State != "open" {
		t.Fatal(detail)
	}
	f.Lock()
	f.detail = &RoomSnapshot{Item: f.items[0], State: "closed", Reason: "host_left"}
	f.Unlock()
	f.publish("room-owner")
	event = socketEvent(t, ws)
	if err := json.Unmarshal(event["detail"], &detail); err != nil || detail.State != "closed" {
		t.Fatal(err, detail)
	}
	f.Lock()
	f.detail = nil
	f.Unlock()
	f.publish("") // Redis reconnection also forces a current snapshot.
	event = socketEvent(t, ws)
	if string(event["type"]) != `"room.missing"` || string(event["roomId"]) != `"room-owner"` {
		t.Fatal(event)
	}
}

func TestRoomSocketRejectsForeignOriginAndInvalidRoom(t *testing.T) {
	_, server := roomSocketFixture(t)
	for _, tc := range []struct{ query, origin string }{
		{"", "http://evil"}, {"?roomId=..%2Fprivate", "http://web"},
	} {
		if ws, err := dialRoomSocket(t, server, "owner", tc.query, tc.origin); err == nil {
			ws.Close()
			t.Fatal("invalid connection accepted", tc)
		}
	}
}

func TestRoomSocketCacheFailureDoesNotReportRoomDeparture(t *testing.T) {
	for _, query := range []string{"", "?roomId=room-owner"} {
		t.Run(query, func(t *testing.T) {
			f, server := roomSocketFixture(t)
			f.detail = &RoomSnapshot{Item: f.items[0], State: "open"}
			ws, err := dialRoomSocket(t, server, "owner", query, "http://web")
			if err != nil {
				t.Fatal(err)
			}
			defer ws.Close()
			_ = socketEvent(t, ws)
			f.Lock()
			f.err = errors.New("snapshot store unavailable")
			f.Unlock()
			f.publish("room-owner")
			_ = ws.SetReadDeadline(time.Now().Add(time.Second))
			var event map[string]json.RawMessage
			if err := websocket.JSON.Receive(ws, &event); err == nil {
				t.Fatalf("failed read emitted a room snapshot: %v", event)
			}
			select {
			case <-f.closed:
			case <-time.After(time.Second):
				t.Fatal("failed snapshot did not close its subscription")
			}
		})
	}
}
