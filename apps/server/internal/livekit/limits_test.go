package livekit

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestFullRoomRejectsAdmissionWithRoomFull(t *testing.T) {
	f := newLifecycleFixture(t)
	f.Lock()
	for i := 0; i < 50; i++ {
		f.people["room-host"] = append(f.people["room-host"], voiceParticipant{SID: fmt.Sprintf("PA_%d", i), Identity: fmt.Sprintf("viewer_%d", i), State: json.RawMessage(`"ACTIVE"`)})
	}
	f.Unlock()
	result := request(t, f.router, "POST", "/rooms/room-host/join", `{}`, 409, "viewer-owner")
	if result["error"].(map[string]any)["code"] != "room_full" || result["token"] != nil {
		t.Fatal(result)
	}
}

func TestRoomAliasesShareAccountRateBudget(t *testing.T) {
	f := newLifecycleFixture(t)
	cfg := f.h.Client.config
	cfg.Limits = map[string]int{"join_account": 2}
	r := gin.New()
	Register(r, cfg, f.h.Auth)
	Register(r.Group("/api/v1"), cfg, f.h.Auth)
	for _, path := range []string{"/rooms/room-host/join", "/api/v1/rooms/room-host/join"} {
		request(t, r, "POST", path, `{"attemptId":"attempt-rate-1234"}`, 201)
	}
	response := request(t, r, "POST", "/rooms/room-host/join", `{"attemptId":"attempt-rate-1234"}`, 429)
	if response["error"].(map[string]any)["code"] != "rate_limit" {
		t.Fatal(response)
	}
	request(t, r, "POST", "/rooms/room-host/join", `{}`, 201, "other-user")
}

func TestConnectionLeasesReleaseExpireAndRejectOverflow(t *testing.T) {
	f := newLifecycleFixture(t)
	h := f.h
	h.Client.config.Limits = map[string]int{"connections_account": 1}
	current := time.Now()
	h.now = func() time.Time { return current }
	makeContext := func() (*gin.Context, *httptest.ResponseRecorder) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest("GET", "/", nil)
		return c, w
	}
	c, _ := makeContext()
	first, ok := h.acquireRoomLease(c, "owner")
	if !ok {
		t.Fatal("initial lease failed")
	}
	c, w := makeContext()
	if _, ok := h.acquireRoomLease(c, "owner"); ok || w.Code != 429 || w.Header().Get("Retry-After") == "" {
		t.Fatal("missing lease rejection", w)
	}
	first.release()
	c, _ = makeContext()
	second, ok := h.acquireRoomLease(c, "owner")
	if !ok {
		t.Fatal("release did not free capacity")
	}
	current = current.Add(91 * time.Second)
	c, _ = makeContext()
	third, ok := h.acquireRoomLease(c, "owner")
	if !ok {
		t.Fatal("crashed lease did not expire")
	}
	defer third.release()
	second.release()
	c, w = makeContext()
	if _, ok := h.acquireRoomLease(c, "owner"); ok || w.Code != 429 {
		t.Fatal("old release removed a newer lease")
	}
}
