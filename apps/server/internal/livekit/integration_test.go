package livekit

import (
	"context"
	"os"
	"testing"
	"time"

	"companion/server/pkg/database"
)

// Opt in against a local LiveKit instance. Only the uniquely named test room is
// modified; it is removed even if an assertion fails. No media worker is started.
func TestLiveKitIntegration(t *testing.T) {
	if os.Getenv("LIVEKIT_INTEGRATION") != "1" {
		t.Skip("set LIVEKIT_INTEGRATION=1 to test local LiveKit")
	}
	value := func(key, fallback string) string {
		if v := os.Getenv(key); v != "" {
			return v
		}
		return fallback
	}
	cfg := Config{URL: value("LIVEKIT_TEST_URL", "http://127.0.0.1:7880"), APIKey: value("LIVEKIT_TEST_API_KEY", "devkey"), APISecret: value("LIVEKIT_TEST_API_SECRET", "devsecretdevsecretdevsecretdevsec")}
	if err := cfg.Validate(); err != nil || !cfg.Enabled() {
		t.Fatal("valid LiveKit settings required")
	}
	client := NewClient(cfg)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	id := "migration-test-" + database.ID()
	room, err := client.CreateRoom(ctx, id, "迁移联调", "integration-owner")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := client.DeleteRoom(cleanup, id); err != nil {
			t.Errorf("cleanup test room: %v", err)
		}
	})
	if room.ID != id || room.Title != "迁移联调" {
		t.Fatalf("wrong room: %+v", room)
	}
	rooms, err := client.ListRooms(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, r := range rooms {
		if r.ID == id {
			found = true
		}
	}
	if !found {
		t.Fatal("new room missing from list")
	}
	dispatch, err := client.CreateDispatch(ctx, id, id, `{"test":true}`)
	if err != nil {
		t.Fatal(err)
	}
	if dispatch.ID == "" || dispatch.Room != id || dispatch.AgentName != id || dispatch.Metadata != `{"test":true}` {
		t.Fatalf("wrong dispatch: %+v", dispatch)
	}
	dispatches, err := client.ListDispatches(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	found = false
	for _, d := range dispatches {
		if d.ID == dispatch.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("new dispatch missing from list")
	}
	if err := client.DeleteDispatch(ctx, id, dispatch.ID); err != nil {
		t.Fatal(err)
	}
	dispatches, err = client.ListDispatches(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	for _, d := range dispatches {
		if d.ID == dispatch.ID {
			t.Fatal("deleted dispatch still present")
		}
	}
}
