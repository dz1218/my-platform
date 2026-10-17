package httpapi

import (
	"crypto/sha256"
	"encoding/base64"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"companion/server/internal/behavior"
	"companion/server/internal/config"
	"companion/server/internal/livekit"
	"github.com/golang-jwt/jwt/v5"
)

func TestLiveKitRoutesAndCORS(t *testing.T) {
	router := New(config.Config{WebOrigin: "http://localhost:3011", LiveKit: livekit.Config{URL: "ws://localhost:7880", APIKey: "key", APISecret: "secret"}}, nil, nil, behavior.Catalog{}, nil)
	for _, prefix := range []string{"", "/api/v1"} {
		req := httptest.NewRequest("OPTIONS", prefix+"/rooms/room-test", nil)
		req.Header.Set("Origin", "http://localhost:3011")
		req.Header.Set("Access-Control-Request-Method", "DELETE")
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		if res.Code != 204 || !strings.Contains(res.Header().Get("Access-Control-Allow-Methods"), "DELETE") || !strings.Contains(res.Header().Get("Access-Control-Allow-Headers"), "X-Live-Voice-Token") {
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

func TestLiveKitWebhookUsesServerSignatureInsteadOfLogin(t *testing.T) {
	cfg := config.Config{WebOrigin: "http://localhost:3011", LiveKit: livekit.Config{URL: "ws://localhost:7880", APIKey: "key", APISecret: "secret"}}
	router := New(cfg, nil, nil, behavior.Catalog{}, nil)
	body := `{"id":"EV_route","event":"egress_started","room":{"sid":"RM_route","name":"room-route"}}`
	unauthorized := httptest.NewRequest("POST", livekit.WebhookPath, strings.NewReader(body))
	unauthorized.Header.Set("Content-Type", "application/webhook+json")
	res := httptest.NewRecorder()
	router.ServeHTTP(res, unauthorized)
	if res.Code != 401 || !strings.Contains(res.Body.String(), "Invalid LiveKit webhook") {
		t.Fatalf("unsigned webhook: %d %s", res.Code, res.Body.String())
	}
	sum := sha256.Sum256([]byte(body))
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"iss": "key", "exp": time.Now().Add(time.Minute).Unix(), "sha256": base64.StdEncoding.EncodeToString(sum[:]),
	}).SignedString([]byte("secret"))
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("POST", livekit.WebhookPath, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/webhook+json")
	req.Header.Set("Authorization", token)
	res = httptest.NewRecorder()
	router.ServeHTTP(res, req)
	if res.Code != 204 {
		t.Fatalf("authenticated webhook without session cookie: %d %s", res.Code, res.Body.String())
	}
}
