package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"companion/server/internal/auth"
	"companion/server/internal/behavior"
	"companion/server/internal/config"
	"companion/server/internal/matching"
	"github.com/gin-gonic/gin"
	"golang.org/x/net/websocket"
)

type fakeMatchSource struct {
	mu         sync.Mutex
	items      []matching.Match
	users      []string
	changes    chan struct{}
	subscribed string
	closed     chan struct{}
	err        error
}

func (s *fakeMatchSource) Subscribe(userID string) (<-chan struct{}, func()) {
	s.mu.Lock()
	s.subscribed = userID
	s.mu.Unlock()
	s.changes <- struct{}{}
	return s.changes, func() { close(s.closed) }
}

func (s *fakeMatchSource) List(_ context.Context, userID string) ([]matching.Match, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.subscribed != userID {
		return nil, errors.New("snapshot queried before subscription")
	}
	s.users = append(s.users, userID)
	return append([]matching.Match{}, s.items...), s.err
}

func matchSocketServer(backend matchListBackend, updates matchSubscriptions) *httptest.Server {
	router := gin.New()
	router.Use(auth.Handler{Service: auth.Service{VersionLookup: func(context.Context, string) (int64, error) { return 0, nil }, Secret: strings.Repeat("socket-secret", 4)}}.Require)
	router.GET("/matches/socket", matchesSocket(backend, updates, "http://web"))
	return httptest.NewServer(router)
}

func dialMatchSocket(t *testing.T, server *httptest.Server, user, origin string) (*websocket.Conn, error) {
	t.Helper()
	cfg, err := websocket.NewConfig("ws"+strings.TrimPrefix(server.URL, "http")+"/matches/socket?userId=intruder", origin)
	if err != nil {
		t.Fatal(err)
	}
	if user != "" {
		token, err := (auth.Service{VersionLookup: func(context.Context, string) (int64, error) { return 0, nil }, Secret: strings.Repeat("socket-secret", 4)}).Token(user)
		if err != nil {
			t.Fatal(err)
		}
		cfg.Header.Set("Cookie", auth.CookieName+"="+token)
	}
	return websocket.DialConfig(cfg)
}

func readMatches(t *testing.T, ws *websocket.Conn) []matching.Match {
	t.Helper()
	_ = ws.SetReadDeadline(time.Now().Add(5 * time.Second))
	var event struct {
		Type  string           `json:"type"`
		Items []matching.Match `json:"items"`
	}
	if err := websocket.JSON.Receive(ws, &event); err != nil {
		t.Fatal(err)
	}
	if event.Type != "matches.updated" || event.Items == nil {
		t.Fatalf("invalid snapshot: %+v", event)
	}
	return event.Items
}

func TestMatchesSocketAuthSnapshotsAndCleanup(t *testing.T) {
	gin.SetMode(gin.TestMode)
	backend := &fakeMatchSource{items: []matching.Match{{ID: "old"}}, changes: make(chan struct{}, 1), closed: make(chan struct{})}
	server := matchSocketServer(backend, backend)
	defer server.Close()
	for _, credentials := range [][2]string{{"", "http://web"}, {"owner", "http://evil"}} {
		if ws, err := dialMatchSocket(t, server, credentials[0], credentials[1]); err == nil {
			ws.Close()
			t.Fatal("unauthenticated or cross-origin socket accepted")
		}
	}
	ws, err := dialMatchSocket(t, server, "owner", "http://web")
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()
	if items := readMatches(t, ws); len(items) != 1 || items[0].ID != "old" {
		t.Fatalf("initial snapshot: %+v", items)
	}
	backend.mu.Lock()
	backend.items = []matching.Match{{ID: "new"}, {ID: "old"}}
	backend.mu.Unlock()
	backend.changes <- struct{}{}
	if items := readMatches(t, ws); len(items) != 2 || items[0].ID != "new" {
		t.Fatalf("changed snapshot: %+v", items)
	}
	if err := websocket.JSON.Send(ws, map[string]string{"type": "pong"}); err != nil {
		t.Fatal(err)
	}
	// No notification means no list query, including after client heartbeats.
	time.Sleep(100 * time.Millisecond)
	backend.mu.Lock()
	if len(backend.users) != 2 || backend.users[0] != "owner" || backend.users[1] != "owner" {
		t.Errorf("unexpected account reads: %+v", backend.users)
	}
	backend.mu.Unlock()
	ws.Close()
	select {
	case <-backend.closed:
	case <-time.After(time.Second):
		t.Fatal("socket did not unsubscribe on disconnect")
	}
}

func TestMatchesSocketRouteRequiresAuthentication(t *testing.T) {
	router := New(config.Config{JWTSecret: strings.Repeat("test-secret", 4), WebOrigin: "http://web"}, nil, nil, behavior.Catalog{}, nil)
	request := httptest.NewRequest("GET", "/api/v1/matches/socket", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != 401 {
		t.Fatalf("account socket requires authentication, got %d", response.Code)
	}
}

func TestMatchesSocketTicketWithoutCookie(t *testing.T) {
	h := auth.Handler{Service: auth.Service{VersionLookup: func(context.Context, string) (int64, error) { return 0, nil }, Secret: strings.Repeat("ticket-secret", 4)}}
	router := gin.New()
	backend := &fakeMatchSource{items: []matching.Match{{ID: "private-match"}}, changes: make(chan struct{}, 1), closed: make(chan struct{})}
	router.POST("/api/v1/matches/socket-ticket", h.Require, h.SocketTicket("http://web"))
	router.GET("/api/v1/matches/socket", h.RequireSocket("http://web"), matchesSocket(backend, backend, "http://web"))
	token, _ := h.Service.Token("ticket-owner")
	request := httptest.NewRequest("POST", "/api/v1/matches/socket-ticket", nil)
	request.Header.Set("Cookie", auth.CookieName+"="+token)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	var data struct {
		Ticket string `json:"ticket"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &data); err != nil || data.Ticket == "" {
		t.Fatalf("ticket issuance failed: %s", response.Body)
	}
	server := httptest.NewServer(router)
	defer server.Close()
	// No login Cookie is sent to the socket host.
	ws, err := websocket.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/api/v1/matches/socket?ticket="+url.QueryEscape(data.Ticket), "", "http://web")
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()
	if got := readMatches(t, ws); len(got) != 1 || got[0].ID != "private-match" {
		t.Fatalf("wrong snapshot: %+v", got)
	}
	backend.mu.Lock()
	defer backend.mu.Unlock()
	if backend.subscribed != "ticket-owner" {
		t.Fatalf("wrong account: %s", backend.subscribed)
	}
}
