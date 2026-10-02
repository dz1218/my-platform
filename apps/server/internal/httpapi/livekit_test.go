package httpapi

import (
	"net/http/httptest"
	"strings"
	"testing"

	"companion/server/internal/behavior"
	"companion/server/internal/config"
	"companion/server/internal/livekit"
)

func TestLiveKitRoutesAndCORS(t *testing.T) {
	router := New(config.Config{WebOrigin: "http://localhost:3011", LiveKit: livekit.Config{URL: "ws://localhost:7880", APIKey: "key", APISecret: "secret"}}, nil, nil, behavior.Catalog{})
	for _, prefix := range []string{"", "/api/v1"} {
		req := httptest.NewRequest("OPTIONS", prefix+"/rooms/room-test", nil)
		req.Header.Set("Origin", "http://localhost:3011")
		req.Header.Set("Access-Control-Request-Method", "DELETE")
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		if res.Code != 204 || !strings.Contains(res.Header().Get("Access-Control-Allow-Methods"), "DELETE") {
			t.Fatalf("DELETE preflight failed: %d", res.Code)
		}
		req = httptest.NewRequest("DELETE", prefix+"/rooms/room-test", nil)
		res = httptest.NewRecorder()
		router.ServeHTTP(res, req)
		if res.Code != 401 {
			t.Fatalf("room management %s must require login: %d", prefix, res.Code)
		}
	}
	req := httptest.NewRequest("POST", "/rooms/room-test/join", strings.NewReader(`{"identity":"test-user"}`))
	req.Header.Set("Origin", "http://evil.example")
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)
	if res.Code != 403 {
		t.Fatal("foreign origin allowed")
	}
}
