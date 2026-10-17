package livekit

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestCachedReadsDoNotContactCloudOrTakeCreationLock(t *testing.T) {
	f := newLifecycleFixture(t)
	f.Lock()
	f.failList, f.failParticipants = true, true
	before := f.rpcCount
	f.Unlock()
	roomCreationMu.Lock()
	done := make(chan error, 1)
	go func() {
		items, err := f.h.CachedRooms(context.Background())
		if err == nil && len(items) != 2 {
			err = errors.New("cached rooms disappeared during Cloud outage")
		}
		if err == nil {
			_, err = f.h.CachedRoom(context.Background(), "room-host")
		}
		done <- err
	}()
	select {
	case err := <-done:
		roomCreationMu.Unlock()
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		roomCreationMu.Unlock()
		t.Fatal("cached reads waited for the global creation lock")
	}
	request(t, f.router, "GET", "/rooms", "", 200)
	request(t, f.router, "GET", "/rooms/room-host", "", 200)
	f.Lock()
	defer f.Unlock()
	if f.rpcCount != before {
		t.Fatalf("cached GET issued %d Cloud calls", f.rpcCount-before)
	}
}

func TestStartupSyncFailureReturnsUnavailableThenRecovers(t *testing.T) {
	f := newLifecycleFixture(t)
	localRoomLifecycles.Lock()
	delete(localRoomLifecycles.items, f.h.lifecycleKey("room-host"))
	delete(localRoomLifecycles.items, f.h.lifecycleKey("room-other"))
	localRoomLifecycles.Unlock()
	localSnapshotReadiness.Delete(f.h.snapshotReadyKey())
	f.Lock()
	f.failList = true
	f.Unlock()
	if err := f.h.SyncRooms(context.Background()); err == nil {
		t.Fatal("expected startup synchronization failure")
	}
	request(t, f.router, "GET", "/rooms", "", 503)
	request(t, f.router, "GET", "/rooms/room-host", "", 503)
	f.Lock()
	f.failList = false
	f.Unlock()
	request(t, f.router, "POST", "/rooms/refresh", "", 200)
	request(t, f.router, "GET", "/rooms/room-host", "", 200)
	request(t, f.router, "GET", "/rooms/room-missing", "", 404)
}

func TestManualRefreshCoalescesConcurrentCallers(t *testing.T) {
	f := newLifecycleFixture(t)
	var calls atomic.Int32
	var wg sync.WaitGroup
	errors := make(chan error, 24)
	for i := 0; i < cap(errors); i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errors <- f.h.refreshOnce(context.Background(), "room:room-host", func(context.Context) error {
				calls.Add(1)
				time.Sleep(20 * time.Millisecond)
				return nil
			})
		}()
	}
	wg.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("concurrent refresh made %d upstream observations", calls.Load())
	}
}

func TestRoomUpdatesCoalesceOverflowWithoutBlockingConsumer(t *testing.T) {
	ch := make(chan string, 16)
	hub := &roomUpdateHub{subscribers: map[chan string]struct{}{ch: {}}}
	for i := 0; i < cap(ch); i++ {
		hub.broadcast("room-old")
	}
	hub.broadcast("room-new")
	if got := <-ch; got != "" {
		t.Fatalf("overflow must request a full resync, got %q", got)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-ch:
			}
		}
	}()
	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < 20000; i++ {
			hub.broadcast("room-change")
		}
	}()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("overflow drain deadlocked with an active consumer")
	}
}

func TestEventSnapshotUsesParticipantsAndTracksInsteadOfLaggingRoomCounts(t *testing.T) {
	f := newLifecycleFixture(t)
	f.connect(t, "attempt-event-snapshot")
	f.Lock()
	host := f.people["room-host"][0]
	host.Tracks = []json.RawMessage{json.RawMessage(`{"sid":"TR_audio"}`)}
	f.people["room-host"] = []voiceParticipant{host,
		{SID: "PA_viewer", Identity: "viewer_present", State: json.RawMessage(`2`)},
		{SID: "PA_hidden", Identity: "agent_hidden", Permission: participantPermission{Hidden: true}},
		{SID: "PA_gone", Identity: "viewer_gone", State: json.RawMessage(`3`)},
	}
	f.Unlock()
	if err := f.h.ReconcileRoomEvent(context.Background(), RoomLifecycleEvent{Event: "track_published", RoomID: "room-host", RoomSID: "RM_host"}); err != nil {
		t.Fatal(err)
	}
	snapshot, err := f.h.CachedRoom(context.Background(), "room-host")
	if err != nil || snapshot.Item.Status != "直播中" || snapshot.Item.Viewers != 2 {
		t.Fatal(snapshot, err)
	}
	f.Lock()
	f.people["room-host"][0].Tracks = nil
	f.Unlock()
	if err := f.h.ReconcileRoomEvent(context.Background(), RoomLifecycleEvent{Event: "track_unpublished", RoomID: "room-host", RoomSID: "RM_host"}); err != nil {
		t.Fatal(err)
	}
	snapshot, err = f.h.CachedRoom(context.Background(), "room-host")
	if err != nil || snapshot.Item.Status != "准备中" {
		t.Fatal(snapshot, err)
	}
}

func TestCloseRetriesResumeOnlyKnownClosingRoom(t *testing.T) {
	f := newLifecycleFixture(t)
	f.connect(t, "attempt-close-retry-worker")
	if err := f.h.saveOwnerRoom(context.Background(), "test-user", ownerRoom{ID: "room-host"}); err != nil {
		t.Fatal(err)
	}
	f.Lock()
	f.people["room-host"] = nil
	f.failDelete = true
	f.Unlock()
	if err := f.h.ReconcileRoom(context.Background(), "room-host"); err == nil {
		t.Fatal("expected close failure")
	}
	r, err := f.h.loadLifecycle(context.Background(), "room-host")
	if err != nil || r.State != "closing" || r.RetryAt == 0 || r.Retries != 1 {
		t.Fatal(r, err)
	}
	reserved, err := f.h.loadOwnerRoom(context.Background(), "test-user")
	if err != nil || reserved.ID != "room-host" {
		t.Fatal("owner released before deletion confirmed", reserved, err)
	}
	f.Lock()
	f.failDelete = false
	before := f.rpcCount
	f.Unlock()
	restarted := Handler{Client: NewClient(f.h.Client.config), Auth: f.h.Auth, now: func() time.Time { return time.Now().Add(2 * time.Second) }}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() { defer close(done); restarted.RunRoomRetries(ctx) }()
	deadline := time.Now().Add(2 * time.Second)
	for {
		r, err = restarted.loadLifecycle(ctx, "room-host")
		if err != nil {
			t.Fatal(err)
		}
		if r.State == "closed" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("persisted close did not resume", r)
		}
		time.Sleep(5 * time.Millisecond)
	}
	time.Sleep(30 * time.Millisecond)
	cancel()
	<-done
	f.Lock()
	defer f.Unlock()
	if f.rpcCount-before != 2 || f.deletes != 2 {
		t.Fatalf("retry must only verify/delete the known room: calls=%d deletes=%d", f.rpcCount-before, f.deletes)
	}
	if _, ok := f.rooms["room-other"]; !ok {
		t.Fatal("retry affected a normal room")
	}
}

func TestCreateDuringFailedCloseDoesNotReturnEnterableRoom(t *testing.T) {
	f := newLifecycleFixture(t)
	f.connect(t, "attempt-create-after-close")
	if err := f.h.saveOwnerRoom(context.Background(), "test-user", ownerRoom{ID: "room-host"}); err != nil {
		t.Fatal(err)
	}
	f.Lock()
	f.failDelete = true
	f.Unlock()
	request(t, f.router, "DELETE", "/rooms/room-host", "", 502)
	response := request(t, f.router, "POST", "/rooms", `{"title":"下一个直播间"}`, 409)
	if response["error"].(map[string]any)["code"] != "room_closing" || response["item"] != nil {
		t.Fatal("failed close was exposed as an enterable owner room", response)
	}
	reserved, err := f.h.loadOwnerRoom(context.Background(), "test-user")
	if err != nil || reserved.ID != "room-host" {
		t.Fatal("closing room lost its owner reservation", reserved, err)
	}
}
