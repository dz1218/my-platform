package livekit

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"
)

func TestRecoveryDeadlineAndFreshAdmission(t *testing.T) {
	f := newLifecycleFixture(t)
	ctx := context.Background()
	old := f.connect(t, "attempt-original-session")
	f.Lock()
	f.people["room-host"] = nil
	f.Unlock()
	if err := f.h.ReconcileRoom(ctx, "room-host"); err != nil {
		t.Fatal(err)
	}
	r, _ := f.h.loadLifecycle(ctx, "room-host")
	deadline := r.ReconnectDeadline
	if r.State != "open" || r.HostConnection != "reconnecting" || deadline < time.Now().Add(59*time.Second).UnixMilli() {
		t.Fatal(r)
	}
	if err := f.h.ReconcileRoomEvent(ctx, RoomLifecycleEvent{Event: "participant_joined", RoomID: "room-host", RoomSID: "RM_host", Identity: old["identity"].(string), ParticipantSID: r.Host.SID}); err != nil {
		t.Fatal(err)
	}
	r, _ = f.h.loadLifecycle(ctx, "room-host")
	if r.ReconnectDeadline != deadline || r.HostConnection != "reconnecting" {
		t.Fatal("delayed join event erased recovery deadline", r)
	}
	next := request(t, f.router, "POST", "/rooms/room-host/join", `{"attemptId":"attempt-fresh-session"}`, 201)
	if next["identity"] == old["identity"] {
		t.Fatal("reused departed identity")
	}
	if err := f.h.ReconcileRoom(ctx, "room-host"); err != nil {
		t.Fatal(err)
	}
	r, _ = f.h.loadLifecycle(ctx, "room-host")
	if r.ReconnectDeadline != deadline || r.HostConnection != "reconnecting" {
		t.Fatal("token extended or completed recovery", r)
	}
	f.Lock()
	f.people["room-host"] = []voiceParticipant{{SID: "PA_new", Identity: next["identity"].(string), State: json.RawMessage(`"ACTIVE"`)}}
	f.Unlock()
	if err := f.h.ReconcileRoom(ctx, "room-host"); err != nil {
		t.Fatal(err)
	}
	// An old scheduled job and a delayed leave event cannot end the new session.
	if err := f.h.checkRoomDue(ctx, "room-host"); err != nil {
		t.Fatal(err)
	}
	if err := f.h.ReconcileRoomEvent(ctx, RoomLifecycleEvent{RoomID: "room-host", RoomSID: "RM_host", Event: "participant_left", Identity: old["identity"].(string), ParticipantSID: "PA_current"}); err != nil {
		t.Fatal(err)
	}
	r, _ = f.h.loadLifecycle(ctx, "room-host")
	if r.State != "open" || r.ReconnectDeadline != 0 || r.HostConnection != "connected" || r.Host.Identity != next["identity"] {
		t.Fatal(r)
	}
}

func TestDueRecoveryRechecksPresenceAndSerializesWorkers(t *testing.T) {
	f := newLifecycleFixture(t)
	ctx := context.Background()
	f.connect(t, "attempt-workers-123")
	f.Lock()
	f.people["room-host"] = nil
	f.Unlock()
	if err := f.h.ReconcileRoom(ctx, "room-host"); err != nil {
		t.Fatal(err)
	}
	expireHostRecovery(t, f.h, "room-host")
	var workers sync.WaitGroup
	for i := 0; i < 4; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			if err := f.h.checkRoomDue(ctx, "room-host"); err != nil {
				t.Error(err)
			}
		}()
	}
	workers.Wait()
	r, _ := f.h.loadLifecycle(ctx, "room-host")
	if r.State != "closed" || f.deletes != 1 {
		t.Fatal(r, f.deletes)
	}
}

func TestWaitingRoomReconcilesMissingWebhookAndFailuresBackOff(t *testing.T) {
	f := newLifecycleFixture(t)
	ctx := context.Background()
	r, _ := f.h.loadLifecycle(ctx, "room-host")
	r.CheckAt = time.Now().Add(-time.Second).UnixMilli()
	if err := f.h.saveLifecycle(ctx, r); err != nil {
		t.Fatal(err)
	}
	f.Lock()
	f.failList = true
	f.Unlock()
	if err := f.h.checkRoomDue(ctx, r.ID); err == nil {
		t.Fatal("missing upstream error")
	}
	r, _ = f.h.loadLifecycle(ctx, r.ID)
	if r.State != "open" || r.CheckAt <= time.Now().UnixMilli() || r.ReconnectDeadline != 0 {
		t.Fatal(r)
	}
	f.Lock()
	f.failList = false
	delete(f.rooms, r.ID)
	f.Unlock()
	r.CheckAt = time.Now().Add(-time.Second).UnixMilli()
	_ = f.h.saveLifecycle(ctx, r)
	if err := f.h.checkRoomDue(ctx, r.ID); err != nil {
		t.Fatal(err)
	}
	r, _ = f.h.loadLifecycle(ctx, r.ID)
	if r.State != "closed" || r.Reason != "room_finished" {
		t.Fatal(r)
	}
}

func TestCloseAcceptedAndIdempotent(t *testing.T) {
	f := newLifecycleFixture(t)
	f.connect(t, "attempt-close-idempotent")
	f.Lock()
	f.failDelete = true
	f.Unlock()
	for i := 0; i < 2; i++ {
		result := request(t, f.router, "DELETE", "/rooms/room-host", "", 202)
		if result["state"] != "closing" {
			t.Fatal(result)
		}
	}
	request(t, f.router, "DELETE", "/rooms/room-host", "", 403, "other-user")
	f.Lock()
	f.failDelete = false
	f.Unlock()
	r, _ := f.h.loadLifecycle(context.Background(), "room-host")
	r.RetryAt = time.Now().Add(-time.Second).UnixMilli()
	if err := f.h.saveLifecycle(context.Background(), r); err != nil {
		t.Fatal(err)
	}
	if err := f.h.retryRoomClose(context.Background(), "room-host"); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		result := request(t, f.router, "DELETE", "/rooms/room-host", "", 200)
		if result["state"] != "closed" {
			t.Fatal(result)
		}
	}
	request(t, f.router, "DELETE", "/rooms/room-host", "", 403, "other-user")
}

func TestStartupMaintenanceRetriesWithoutManualRefresh(t *testing.T) {
	f := newLifecycleFixture(t)
	localSnapshotReadiness.Delete(f.h.snapshotReadyKey())
	f.Lock()
	f.failList = true
	before := f.rpcCount
	f.Unlock()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() { defer close(done); RunRoomMaintenance(ctx, f.h.Client.config, f.h.Auth) }()
	defer func() { cancel(); <-done }()
	deadline := time.Now().Add(4 * time.Second)
	for {
		f.Lock()
		attempted := f.rpcCount > before
		if attempted {
			f.failList = false
		}
		f.Unlock()
		if attempted {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("startup did not attempt sync")
		}
		time.Sleep(5 * time.Millisecond)
	}
	for {
		ready, err := f.h.snapshotsReady(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if ready {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("failed startup did not recover automatically")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestDueRecoveryKeepsReturnedHostAndOldCloseCannotEndNewAdmission(t *testing.T) {
	f := newLifecycleFixture(t)
	ctx := context.Background()
	joined := f.connect(t, "attempt-just-recovered")
	f.Lock()
	f.people["room-host"] = nil
	f.Unlock()
	if err := f.h.ReconcileRoom(ctx, "room-host"); err != nil {
		t.Fatal(err)
	}
	expireHostRecovery(t, f.h, "room-host")
	f.Lock()
	f.people["room-host"] = []voiceParticipant{{SID: "PA_returned", Identity: joined["identity"].(string), State: json.RawMessage(`"ACTIVE"`)}}
	f.Unlock()
	if err := f.h.checkRoomDue(ctx, "room-host"); err != nil {
		t.Fatal(err)
	}
	r, err := f.h.loadLifecycle(ctx, "room-host")
	if err != nil || r.State != "open" || r.ReconnectDeadline != 0 || f.deletes != 0 {
		t.Fatal(r, err)
	}
	request(t, f.router, "DELETE", "/rooms/room-host", `{"hostIdentity":"host_old-admission"}`, 409)
	if f.deletes != 0 {
		t.Fatal("old session closed the recovered host")
	}
}
