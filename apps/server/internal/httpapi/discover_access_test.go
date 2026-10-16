package httpapi

import (
	"net/http/httptest"
	"strings"
	"testing"

	"companion/server/internal/behavior"
	"companion/server/internal/config"
)

func TestPublicDiscoveryKeepsChatPrivate(t *testing.T) {
	router := New(config.Config{JWTSecret: strings.Repeat("test-secret", 4), WebOrigin: "http://localhost:3011"}, nil, nil, behavior.Catalog{}, nil)
	for _, token := range []string{"", "invalid-session"} {
		for _, request := range []struct {
			method string
			path   string
			status int
		}{
			// Invalid filters reach the public handler without needing a database.
			{"GET", "/discover?page=0", 400},
			{"GET", "/matches", 401},
			{"POST", "/matches", 401},
			{"GET", "/matches/private-match", 401},
			{"GET", "/conversations/private-chat/messages", 401},
		} {
			req := httptest.NewRequest(request.method, "/api/v1"+request.path, nil)
			if token != "" {
				req.Header.Set("Cookie", "companion_session="+token)
			}
			res := httptest.NewRecorder()
			router.ServeHTTP(res, req)
			if res.Code != request.status {
				t.Fatalf("%s %s: got %d, want %d: %s", request.method, request.path, res.Code, request.status, res.Body.String())
			}
		}
	}
}
