package httpapi

import (
	"context"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"companion/server/internal/auth"
	"github.com/gin-gonic/gin"
	"golang.org/x/net/websocket"
)

func TestRevokedChatConnectionCannotSendOrReadHistory(t *testing.T) {
	var version atomic.Int64
	s := auth.Service{Secret: "test-session-secret", VersionLookup: func(context.Context, string) (int64, error) { return version.Load(), nil }}
	backend := &fakeSocketBackend{}
	router := gin.New()
	router.Use(func(c *gin.Context) { s.BindSession(c, auth.Session{UserID: "owner", Version: 0}) })
	router.GET("/:id", socketHandler(backend, "http://web", func(context.Context, string) error { return nil }))
	server := httptest.NewServer(router)
	defer server.Close()
	ws, err := websocket.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/owned", "", "http://web")
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()
	var event map[string]any
	_ = ws.SetDeadline(time.Now().Add(5 * time.Second))
	if err = websocket.JSON.Receive(ws, &event); err != nil || event["type"] != "history" {
		t.Fatal(event, err)
	}
	version.Store(1)
	_ = websocket.JSON.Send(ws, map[string]any{"type": "send", "content": "must not persist", "requestId": "revoked-request"})
	if err = websocket.JSON.Receive(ws, &event); err != nil || event["type"] != "session.invalidated" {
		t.Fatal(event, err)
	}
	backend.mu.Lock()
	n := len(backend.messages)
	backend.mu.Unlock()
	if n != 0 {
		t.Fatal("revoked connection wrote a message")
	}
}

func TestRevokedMatchesConnectionStopsAccountUpdates(t *testing.T) {
	var version atomic.Int64
	s := auth.Service{Secret: "test-session-secret", VersionLookup: func(context.Context, string) (int64, error) { return version.Load(), nil }}
	source := &fakeMatchSource{changes: make(chan struct{}, 4), closed: make(chan struct{})}
	router := gin.New()
	router.Use(func(c *gin.Context) { s.BindSession(c, auth.Session{UserID: "owner", Version: 0}) })
	router.GET("/matches", matchesSocket(source, source, "http://web"))
	server := httptest.NewServer(router)
	defer server.Close()
	ws, err := websocket.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/matches", "", "http://web")
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()
	_ = ws.SetDeadline(time.Now().Add(5 * time.Second))
	var event map[string]any
	if err = websocket.JSON.Receive(ws, &event); err != nil || event["type"] != "matches.updated" {
		t.Fatal(event, err)
	}
	version.Store(1)
	source.changes <- struct{}{}
	if err = websocket.JSON.Receive(ws, &event); err != nil || event["type"] != "session.invalidated" {
		t.Fatal(event, err)
	}
}
