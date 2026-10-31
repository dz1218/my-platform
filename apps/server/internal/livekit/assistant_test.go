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
)

func assistantRecord(t *testing.T, f *lifecycleFixture) *roomLifecycle {
	t.Helper()
	r, err := f.h.loadLifecycle(context.Background(), "room-host")
	if err != nil || r == nil {
		t.Fatalf("record: %v", err)
	}
	return r
}

func TestAssistantConcurrentDispatchAndTrustedPresence(t *testing.T) {
	f := newLifecycleFixture(t)
	f.connect(t, "assistant-host-attempt")
	var wg sync.WaitGroup
	codes := make(chan int, 4)
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			req := httptest.NewRequest("POST", "/rooms/room-host/agent/dispatch", strings.NewReader(`{}`))
			token, _ := f.h.Auth.Service.Token("test-user")
			req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: token})
			result := httptest.NewRecorder()
			f.router.ServeHTTP(result, req)
			codes <- result.Code
		}()
	}
	wg.Wait()
	close(codes)
	for code := range codes {
		if code != 200 && code != 201 {
			t.Fatalf("dispatch status %d", code)
		}
	}
	if f.dispatchCreates != 1 {
		t.Fatalf("created %d assistants", f.dispatchCreates)
	}
	r := assistantRecord(t, f)
	if r.Assistant.Status != "starting" {
		t.Fatal(r.Assistant)
	}
	// A standard participant cannot establish AI presence, even with a matching name.
	f.Lock()
	f.people[r.ID] = append(f.people[r.ID], voiceParticipant{SID: "PA_fake", Identity: r.Assistant.Identity})
	f.Unlock()
	if err := f.h.ReconcileRoom(context.Background(), r.ID); err != nil {
		t.Fatal(err)
	}
	if assistantRecord(t, f).Assistant.Status != "starting" {
		t.Fatal("trusted a human as AI")
	}
	f.Lock()
	f.people[r.ID][1].Kind = json.RawMessage(`"AGENT"`)
	f.Unlock()
	if err := f.h.ReconcileRoom(context.Background(), r.ID); err != nil {
		t.Fatal(err)
	}
	snapshot, err := f.h.CachedRoom(context.Background(), r.ID)
	if err != nil || snapshot.Assistant.Status != "online" {
		t.Fatalf("snapshot %v %v", snapshot, err)
	}
	f.Lock()
	f.dispatches["AD_other"] = Dispatch{ID: "AD_other", Room: "room-other", AgentName: f.h.assistantName()}
	f.Unlock()
	request(t, f.router, "DELETE", "/rooms/room-host/agent/dispatch/AD_other", "", 404)
	request(t, f.router, "DELETE", "/rooms/room-host/agent/dispatch/"+r.Assistant.DispatchID, "", 200)
	f.Lock()
	_, foreignRetained := f.dispatches["AD_other"]
	f.Unlock()
	if !foreignRetained {
		t.Fatal("removed another room's dispatch")
	}
	if assistantRecord(t, f).Assistant.Status != "idle" {
		t.Fatal("assistant not removed")
	}
	// A delayed worker cannot bring an expired session back online.
	f.Lock()
	f.people[r.ID] = append(f.people[r.ID], voiceParticipant{SID: "PA_late", Identity: r.Assistant.Identity, Kind: json.RawMessage(`4`)})
	f.Unlock()
	if err := f.h.ReconcileRoom(context.Background(), r.ID); err != nil {
		t.Fatal(err)
	}
	f.Lock()
	defer f.Unlock()
	if len(f.people[r.ID]) != 1 {
		t.Fatal("late assistant retained")
	}
}

func TestAssistantTimeoutAndCleanupRetry(t *testing.T) {
	f := newLifecycleFixture(t)
	f.connect(t, "assistant-timeout-host")
	request(t, f.router, "POST", "/rooms/room-host/agent/dispatch", `{}`, 201)
	r := assistantRecord(t, f)
	f.h.now = func() time.Time { return time.UnixMilli(r.Assistant.Deadline + 1) }
	f.failDispatchDelete = true
	if err := f.h.checkRoomDue(context.Background(), r.ID); err != nil {
		t.Fatal("assistant cleanup must not block host reconciliation", err)
	}
	if assistantRecord(t, f).Assistant.Status != "stopping" {
		t.Fatal("must reserve until cleanup succeeds")
	}
	request(t, f.router, "POST", "/rooms/room-host/agent/dispatch", `{}`, 409)
	f.failDispatchDelete = false
	if err := f.h.ReconcileRoom(context.Background(), r.ID); err != nil {
		t.Fatal(err)
	}
	if assistantRecord(t, f).Assistant.Status != "failed" {
		t.Fatal("missing retry state")
	}
	request(t, f.router, "POST", "/rooms/room-host/agent/dispatch", `{}`, 201)
	next := assistantRecord(t, f)
	if next.Assistant.SessionID == r.Assistant.SessionID || f.dispatchCreates != 2 {
		t.Fatal("new session not created")
	}
	request(t, f.router, "DELETE", "/rooms/room-host", "", 200)
	if assistantRecord(t, f).Assistant.Status != "idle" {
		t.Fatal("closed room retained assistant")
	}
	if len(f.dispatches) != 0 {
		t.Fatal("closed room retained dispatch")
	}
}

func TestAssistantLostCreateResponseAndAuthorization(t *testing.T) {
	f := newLifecycleFixture(t)
	f.connect(t, "assistant-lost-host")
	f.lostDispatchResponse = true
	request(t, f.router, "POST", "/rooms/room-host/agent/dispatch", `{}`, 502)
	request(t, f.router, "POST", "/rooms/room-host/agent/dispatch", `{}`, 200)
	if f.dispatchCreates != 1 {
		t.Fatal("uncertain create duplicated")
	}
	r := assistantRecord(t, f)
	request(t, f.router, "DELETE", "/rooms/room-host/agent/dispatch/"+r.Assistant.SessionID, "", 200)
	if len(f.dispatches) != 0 {
		t.Fatal("uncertain dispatch not cleaned")
	}
	for _, method := range []string{"POST", "DELETE"} {
		path := "/rooms/room-host/agent/dispatch"
		if method == "DELETE" {
			path += "/AD_1"
		}
		req := httptest.NewRequest(method, path, strings.NewReader(`{}`))
		token, _ := f.h.Auth.Service.Token("other-user")
		req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: token})
		result := httptest.NewRecorder()
		f.router.ServeHTTP(result, req)
		if result.Code != 403 {
			t.Fatal(result.Code)
		}
	}
	request(t, f.router, "POST", "/rooms/room-host/agent/dispatch", `{"agentName":"another-agent"}`, 400)
	request(t, f.router, "POST", "/rooms/room-host/agent/dispatch", `{"metadata":{"sessionId":"forged"}}`, 400)
}

func TestAssistantArrivalAfterDeadlineCannotBecomeOnline(t *testing.T) {
	f := newLifecycleFixture(t)
	f.connect(t, "assistant-late-arrival")
	request(t, f.router, "POST", "/rooms/room-host/agent/dispatch", `{}`, 201)
	r := assistantRecord(t, f)
	f.h.now = func() time.Time { return time.UnixMilli(r.Assistant.Deadline + 1) }
	f.Lock()
	f.people[r.ID] = append(f.people[r.ID], voiceParticipant{SID: "PA_late", Identity: r.Assistant.Identity, Kind: json.RawMessage(`"AGENT"`)})
	f.Unlock()
	if err := f.h.ReconcileRoom(context.Background(), r.ID); err != nil {
		t.Fatal(err)
	}
	if assistantRecord(t, f).Assistant.Status != "failed" {
		t.Fatal("late arrival revived expired dispatch")
	}
	f.Lock()
	defer f.Unlock()
	if len(f.people[r.ID]) != 1 || len(f.dispatches) != 0 {
		t.Fatal("late worker or dispatch retained")
	}
}
