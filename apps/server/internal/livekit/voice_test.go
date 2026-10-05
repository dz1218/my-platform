package livekit

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"companion/server/internal/auth"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

type voiceFixture struct {
	mu                            sync.Mutex
	people                        map[string]voiceParticipant
	permissions                   map[string]map[string]any
	failUpdate, applyFailedUpdate bool
	handler                       Handler
	router                        *gin.Engine
	tokens                        map[string]string
	cookie                        string
}

func newVoiceFixture(t *testing.T) *voiceFixture {
	t.Helper()
	f := &voiceFixture{people: map[string]voiceParticipant{}, permissions: map[string]map[string]any{}, tokens: map[string]string{}}
	for _, id := range []string{"host_test-user", "viewer_one", "viewer_two"} {
		f.people[id] = voiceParticipant{SID: "PA_" + id, Identity: id, Name: id, Attributes: map[string]string{}}
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		var input struct {
			Identity   string            `json:"identity"`
			Attributes map[string]string `json:"attributes"`
			Permission map[string]any    `json:"permission"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			t.Error(err)
		}
		switch {
		case strings.HasSuffix(r.URL.Path, "/ListRooms"):
			json.NewEncoder(w).Encode(map[string]any{"rooms": []map[string]string{{"name": "room-voice", "metadata": `{"ownerId":"test-user"}`}}})
		case strings.HasSuffix(r.URL.Path, "/ListParticipants"):
			list := []voiceParticipant{}
			for _, p := range f.people {
				list = append(list, p)
			}
			json.NewEncoder(w).Encode(map[string]any{"participants": list})
		case strings.HasSuffix(r.URL.Path, "/UpdateParticipant"):
			failUpdate := f.failUpdate
			f.failUpdate = false
			p, exists := f.people[input.Identity]
			if !exists {
				w.WriteHeader(404)
				return
			}
			if !failUpdate || f.applyFailedUpdate {
				for k, v := range input.Attributes {
					p.Attributes[k] = v
				}
				p.Permission.CanPublish, _ = input.Permission["canPublish"].(bool)
				f.permissions[p.Identity] = input.Permission
				f.people[p.Identity] = p
			}
			if failUpdate {
				w.WriteHeader(500)
				return
			}
			json.NewEncoder(w).Encode(p)
		default:
			t.Errorf("unexpected RPC %s", r.URL.Path)
			w.WriteHeader(500)
		}
	}))
	t.Cleanup(upstream.Close)
	cfg := Config{URL: upstream.URL, APIKey: "key", APISecret: "voice-test-secret"}
	service := auth.Service{Secret: "voice-session-secret"}
	f.handler = Handler{Client: NewClient(cfg), Auth: auth.Handler{Service: service}}
	f.router = gin.New()
	Register(f.router, cfg, f.handler.Auth)
	Register(f.router.Group("/api/v1"), cfg, f.handler.Auth)
	f.cookie, _ = service.Token("test-user")
	for id := range f.people {
		userID := ""
		if strings.HasPrefix(id, "host_") {
			userID = "test-user"
		}
		f.tokens[id], _ = f.handler.Client.VoiceToken("room-voice", id, userID)
	}
	return f
}

func (f *voiceFixture) call(actor, method, path, requestID string) *httptest.ResponseRecorder {
	payload, _ := json.Marshal(map[string]string{"requestId": requestID})
	req := httptest.NewRequest(method, path, strings.NewReader(string(payload)))
	req.Header.Set("X-Live-Voice-Token", f.tokens[actor])
	req.Header.Set("Content-Type", "application/json")
	if strings.HasPrefix(actor, "host_") {
		req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: f.cookie})
	}
	res := httptest.NewRecorder()
	f.router.ServeHTTP(res, req)
	return res
}

func voiceResult(t *testing.T, res *httptest.ResponseRecorder, code int) voiceState {
	t.Helper()
	if res.Code != code {
		t.Fatalf("status %d, want %d: %s", res.Code, code, res.Body.String())
	}
	var state voiceState
	if code == 200 {
		if err := json.Unmarshal(res.Body.Bytes(), &state); err != nil {
			t.Fatal(err)
		}
	}
	return state
}

const voiceBase = "/rooms/room-voice/voice"
const firstRequest = "request-viewer-one"
const secondRequest = "request-viewer-two"

func TestVoiceSingleSlotLifecycle(t *testing.T) {
	f := newVoiceFixture(t)
	state := voiceResult(t, f.call("viewer_one", "POST", voiceBase+"/request", firstRequest), 200)
	if state.Slot == nil || state.Slot.Status != "pending" {
		t.Fatal(state)
	}
	voiceResult(t, f.call("viewer_one", "POST", voiceBase+"/request", firstRequest), 200)
	voiceResult(t, f.call("viewer_two", "POST", voiceBase+"/request", secondRequest), 409)
	voiceResult(t, f.call("viewer_two", "DELETE", voiceBase+"/request", firstRequest), 403)
	voiceResult(t, f.call("viewer_one", "POST", voiceBase+"/requests/"+firstRequest+"/approve", ""), 403)
	state = voiceResult(t, f.call("host_test-user", "POST", voiceBase+"/requests/"+firstRequest+"/approve", ""), 200)
	if state.Slot.Status != "approved" {
		t.Fatal(state)
	}
	voiceResult(t, f.call("host_test-user", "POST", voiceBase+"/requests/"+firstRequest+"/approve", ""), 200)
	// Granted-but-not-publishing (including muted) must still occupy the slot.
	voiceResult(t, f.call("viewer_two", "POST", voiceBase+"/request", secondRequest), 409)
	voiceResult(t, f.call("viewer_one", "DELETE", voiceBase+"/request", firstRequest), 409)
	f.mu.Lock()
	permission := f.permissions["viewer_one"]
	f.mu.Unlock()
	sources := permission["canPublishSources"].([]any)
	if permission["canPublish"] != true || permission["canSubscribe"] != true || permission["canPublishData"] != true || permission["canUpdateOwnMetadata"] != false || len(sources) != 2 || sources[0] != float64(1) || sources[1] != float64(2) {
		t.Fatal(permission)
	}
	voiceResult(t, f.call("viewer_two", "POST", voiceBase+"/end", firstRequest), 403)
	state = voiceResult(t, f.call("viewer_one", "POST", voiceBase+"/end", firstRequest), 200)
	if state.Slot != nil {
		t.Fatal("hangup did not release slot")
	}
	voiceResult(t, f.call("viewer_one", "POST", voiceBase+"/end", firstRequest), 200)
	voiceResult(t, f.call("host_test-user", "POST", voiceBase+"/requests/"+firstRequest+"/approve", ""), 409)
	voiceResult(t, f.call("viewer_one", "POST", voiceBase+"/request", firstRequest), 409)
	voiceResult(t, f.call("viewer_two", "POST", voiceBase+"/request", secondRequest), 200)
	voiceResult(t, f.call("host_test-user", "POST", voiceBase+"/requests/"+secondRequest+"/reject", ""), 200)
	voiceResult(t, f.call("host_test-user", "POST", voiceBase+"/requests/"+secondRequest+"/reject", ""), 200)
	voiceResult(t, f.call("viewer_one", "POST", voiceBase+"/request", "request-one-again"), 200)
	state = voiceResult(t, f.call("viewer_one", "DELETE", voiceBase+"/request", "request-one-again"), 200)
	if state.Slot != nil {
		t.Fatal(state)
	}
}

func TestVoiceConcurrentRequestsAcrossRouteAliases(t *testing.T) {
	f := newVoiceFixture(t)
	start := make(chan struct{})
	results := make(chan int, 2)
	for i, actor := range []string{"viewer_one", "viewer_two"} {
		go func(i int, actor string) {
			<-start
			prefix := ""
			if i == 1 {
				prefix = "/api/v1"
			}
			results <- f.call(actor, "POST", prefix+voiceBase+"/request", "request-"+actor).Code
		}(i, actor)
	}
	close(start)
	a, b := <-results, <-results
	if !((a == 200 && b == 409) || (a == 409 && b == 200)) {
		t.Fatalf("expected exactly one success: %d %d", a, b)
	}
}

func TestVoiceAuthenticationAndStaleSessions(t *testing.T) {
	f := newVoiceFixture(t)
	voiceResult(t, f.call("unknown", "GET", voiceBase, ""), 401)
	voiceResult(t, f.call("viewer_one", "GET", "/rooms/other-room/voice", ""), 401)
	voiceResult(t, f.call("host_test-user", "POST", voiceBase+"/request", firstRequest), 403)
	voiceResult(t, f.call("viewer_one", "POST", voiceBase+"/request", "short"), 400)
	f.tokens["viewer_one"] += "tampered"
	voiceResult(t, f.call("viewer_one", "GET", voiceBase, ""), 401)
	f.tokens["viewer_one"], _ = f.handler.Client.JoinToken("room-voice", "viewer_one", "name", false)
	voiceResult(t, f.call("viewer_one", "GET", voiceBase, ""), 401)
	f.tokens["viewer_one"], _ = f.handler.Client.VoiceToken("room-voice", "viewer_one", "")
	var claims voiceClaims
	_, _ = jwt.ParseWithClaims(f.tokens["viewer_one"], &claims, func(_ *jwt.Token) (any, error) { return []byte("voice-test-secret"), nil })
	if claims.ExpiresAt.Sub(claims.IssuedAt.Time) != 2*time.Hour || claims.Role != "viewer" {
		t.Fatal(claims)
	}
	claims.ExpiresAt = jwt.NewNumericDate(time.Now().Add(-time.Minute))
	f.tokens["viewer_one"], _ = jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte("voice-test-secret"))
	voiceResult(t, f.call("viewer_one", "GET", voiceBase, ""), 401)
	f.cookie, _ = f.handler.Auth.Service.Token("other-user")
	voiceResult(t, f.call("host_test-user", "GET", voiceBase, ""), 401)
	f.mu.Lock()
	delete(f.people, "viewer_two")
	f.mu.Unlock()
	voiceResult(t, f.call("viewer_two", "GET", voiceBase, ""), 403)
}

func TestVoiceCleanupAndSessionReplacement(t *testing.T) {
	for _, scenario := range []string{"host left", "viewer left", "new session", "agent is not host"} {
		t.Run(scenario, func(t *testing.T) {
			f := newVoiceFixture(t)
			voiceResult(t, f.call("viewer_one", "POST", voiceBase+"/request", firstRequest), 200)
			voiceResult(t, f.call("host_test-user", "POST", voiceBase+"/requests/"+firstRequest+"/approve", ""), 200)
			f.mu.Lock()
			switch scenario {
			case "host left":
				delete(f.people, "host_test-user")
			case "viewer left":
				delete(f.people, "viewer_one")
			case "new session":
				p := f.people["viewer_one"]
				p.SID = "PA_rejoined"
				f.people[p.Identity] = p
			case "agent is not host":
				p := f.people["host_test-user"]
				p.Kind = json.RawMessage(`"AGENT"`)
				f.people[p.Identity] = p
			}
			f.mu.Unlock()
			if err := f.handler.cleanupVoiceRooms(context.Background()); err != nil {
				t.Fatal(err)
			}
			state := voiceResult(t, f.call("viewer_two", "GET", voiceBase, ""), 200)
			if state.Slot != nil {
				t.Fatal("stale slot survived", state)
			}
			f.mu.Lock()
			if f.people["viewer_one"].Permission.CanPublish {
				t.Error("publish permission survived cleanup")
			}
			f.mu.Unlock()
		})
	}
}

func TestVoiceLostUpdateResponseAndFailedRevoke(t *testing.T) {
	f := newVoiceFixture(t)
	voiceResult(t, f.call("viewer_one", "POST", voiceBase+"/request", firstRequest), 200)
	f.mu.Lock()
	f.failUpdate = true
	f.applyFailedUpdate = true
	f.mu.Unlock()
	voiceResult(t, f.call("host_test-user", "POST", voiceBase+"/requests/"+firstRequest+"/approve", ""), 200)
	voiceResult(t, f.call("viewer_two", "POST", voiceBase+"/request", secondRequest), 409)
	f.mu.Lock()
	f.failUpdate = true
	f.applyFailedUpdate = false
	f.mu.Unlock()
	voiceResult(t, f.call("host_test-user", "POST", voiceBase+"/end", firstRequest), 502)
	voiceResult(t, f.call("viewer_two", "POST", voiceBase+"/request", secondRequest), 409)
	state := voiceResult(t, f.call("host_test-user", "POST", voiceBase+"/end", firstRequest), 200)
	if state.Slot != nil {
		t.Fatal(state)
	}
}

func TestVoicePermissionProtoJSON(t *testing.T) {
	var p voiceParticipant
	if err := json.Unmarshal([]byte(`{"permission":{"can_publish":true}}`), &p); err != nil || !p.Permission.CanPublish {
		t.Fatal(p, err)
	}
}

func TestVoiceDisconnectedParticipantIsNotAHost(t *testing.T) {
	for _, state := range []string{"3", `"DISCONNECTED"`} {
		f := newVoiceFixture(t)
		f.mu.Lock()
		p := f.people["host_test-user"]
		p.State = json.RawMessage(state)
		f.people[p.Identity] = p
		f.mu.Unlock()
		voiceResult(t, f.call("viewer_one", "POST", voiceBase+"/request", firstRequest), 409)
	}
}

func TestVoiceCancelRacingApprovalCannotFreeAnApprovedSlot(t *testing.T) {
	f := newVoiceFixture(t)
	voiceResult(t, f.call("viewer_one", "POST", voiceBase+"/request", firstRequest), 200)
	start := make(chan struct{})
	results := make(chan int, 2)
	go func() { <-start; results <- f.call("viewer_one", "DELETE", voiceBase+"/request", firstRequest).Code }()
	go func() {
		<-start
		results <- f.call("host_test-user", "POST", voiceBase+"/requests/"+firstRequest+"/approve", "").Code
	}()
	close(start)
	a, b := <-results, <-results
	if !((a == 200 && b == 409) || (a == 409 && b == 200)) {
		t.Fatalf("cancel/approve: %d %d", a, b)
	}
	state := voiceResult(t, f.call("viewer_two", "GET", voiceBase, ""), 200)
	expected := 200
	if state.Slot != nil {
		expected = 409
	}
	voiceResult(t, f.call("viewer_two", "POST", voiceBase+"/request", secondRequest), expected)
}
