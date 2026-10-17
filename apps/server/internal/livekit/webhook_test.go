package livekit

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

func signedWebhook(t *testing.T, cfg Config, body string, change func(jwt.MapClaims)) string {
	t.Helper()
	sum := sha256.Sum256([]byte(body))
	claims := jwt.MapClaims{"iss": cfg.APIKey, "exp": time.Now().Add(time.Minute).Unix(), "nbf": time.Now().Add(-time.Second).Unix(), "sha256": base64.StdEncoding.EncodeToString(sum[:])}
	if change != nil {
		change(claims)
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(cfg.APISecret))
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func webhookRequest(body, token string) *http.Request {
	r := httptest.NewRequest("POST", WebhookPath, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/webhook+json")
	r.Header.Set("Authorization", token)
	return r
}

func TestWebhookAuthenticatesRawBody(t *testing.T) {
	cfg := Config{URL: "ws://webhook-test", APIKey: "webhook-key", APISecret: "webhook-secret"}
	body := `{"id":"EV_signed","event":"participant_left","room":{"name":"room-hook","sid":"RM_1"},"participant":{"identity":"host_owner_session","sid":"PA_1"}}`
	for _, tc := range []struct {
		name  string
		body  string
		token string
		valid bool
	}{
		{"valid raw JWT", body, signedWebhook(t, cfg, body, nil), true},
		{"valid bearer JWT", body, "Bearer " + signedWebhook(t, cfg, body, nil), true},
		{"missing token", body, "", false},
		{"body tampering", strings.Replace(body, "PA_1", "PA_2", 1), signedWebhook(t, cfg, body, nil), false},
		{"changed whitespace", body + "\n", signedWebhook(t, cfg, body, nil), false},
		{"wrong issuer", body, signedWebhook(t, cfg, body, func(c jwt.MapClaims) { c["iss"] = "another-key" }), false},
		{"expired", body, signedWebhook(t, cfg, body, func(c jwt.MapClaims) { c["exp"] = time.Now().Add(-time.Minute).Unix() }), false},
		{"future token", body, signedWebhook(t, cfg, body, func(c jwt.MapClaims) { c["nbf"] = time.Now().Add(time.Hour).Unix() }), false},
		{"missing expiry", body, signedWebhook(t, cfg, body, func(c jwt.MapClaims) { delete(c, "exp") }), false},
		{"missing hash", body, signedWebhook(t, cfg, body, func(c jwt.MapClaims) { delete(c, "sha256") }), false},
		{"invalid JSON", `{`, signedWebhook(t, cfg, `{`, nil), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			event, err := verifyWebhook(cfg, webhookRequest(tc.body, tc.token))
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v, err=%v", tc.valid, err)
			}
			if tc.valid && (event.Room.SID != "RM_1" || event.Participant.SID != "PA_1") {
				t.Fatal(event)
			}
		})
	}
	large := strings.Repeat(" ", webhookBodyLimit+1)
	if _, err := verifyWebhook(cfg, webhookRequest(large, signedWebhook(t, cfg, large, nil))); err == nil {
		t.Fatal("oversized webhook accepted")
	}
}

func TestWebhookRetriesAndDeduplicatesOnlySuccessfulEvents(t *testing.T) {
	cfg := Config{URL: "ws://" + t.Name(), APIKey: "key", APISecret: "secret"}
	h := Handler{Client: NewClient(cfg)}
	calls := 0
	var received RoomLifecycleEvent
	r := gin.New()
	r.POST(WebhookPath, h.webhook(func(_ context.Context, event RoomLifecycleEvent) error {
		calls++
		received = event
		if calls == 1 {
			return errors.New("temporary upstream failure")
		}
		return nil
	}))
	body := `{"id":"EV_retry","event":"participant_left","room":{"name":"room-hook","sid":"RM_1"},"participant":{"identity":"host_owner_session","sid":"PA_1"}}`
	for i, code := range []int{503, 204, 204} {
		res := httptest.NewRecorder()
		r.ServeHTTP(res, webhookRequest(body, signedWebhook(t, cfg, body, nil)))
		if res.Code != code {
			t.Fatalf("delivery %d: %d %s", i, res.Code, res.Body.String())
		}
	}
	if calls != 2 || received.Event != "participant_left" || received.RoomID != "room-hook" || received.RoomSID != "RM_1" || received.ParticipantSID != "PA_1" || received.Identity != "host_owner_session" {
		t.Fatalf("calls=%d, event=%+v", calls, received)
	}
}

func TestWebhookRejectsMalformedLifecycleEventsAndIgnoresOtherEvents(t *testing.T) {
	cfg := Config{URL: "ws://" + t.Name(), APIKey: "key", APISecret: "secret"}
	h := Handler{Client: NewClient(cfg)}
	r := gin.New()
	calls := 0
	r.POST(WebhookPath, h.webhook(func(context.Context, RoomLifecycleEvent) error { calls++; return nil }))
	for _, tc := range []struct {
		event, room, participant string
		status                   int
	}{
		{"egress_started", `{}`, `{}`, 204},
		{"track_published", `{}`, `{}`, 400},
		{"room_started", `{}`, `{}`, 400},
		{"room_started", `{"name":"room-hook","sid":"RM_1"}`, `{}`, 204},
		{"track_published", `{"name":"room-hook","sid":"RM_1"}`, `{"sid":"PA_1","identity":"host_1"}`, 204},
		{"track_unpublished", `{"name":"room-hook","sid":"RM_1"}`, `{"sid":"PA_1","identity":"host_1"}`, 204},
		{"participant_left", `{"name":"room-hook"}`, `{"sid":"PA_1","identity":"host_1"}`, 400},
		{"participant_left", `{"name":"room-hook","sid":"RM_1"}`, `{}`, 400},
		{"room_finished", `{"name":"../bad","sid":"RM_1"}`, `{}`, 400},
		{"room_finished", `{"name":"room-hook","sid":"RM_1"}`, `{}`, 204},
	} {
		body := fmt.Sprintf(`{"id":%q,"event":%q,"room":%s,"participant":%s}`, fmt.Sprint(tc), tc.event, tc.room, tc.participant)
		res := httptest.NewRecorder()
		r.ServeHTTP(res, webhookRequest(body, signedWebhook(t, cfg, body, nil)))
		if res.Code != tc.status {
			t.Fatalf("%s: %d %s", tc.event, res.Code, res.Body.String())
		}
	}
	if calls != 4 {
		t.Fatalf("unexpected lifecycle calls: %d", calls)
	}
}
