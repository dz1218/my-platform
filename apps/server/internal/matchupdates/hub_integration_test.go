package matchupdates

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"companion/server/pkg/database"
)

func TestListenerIdleHeartbeatKeepsSessionAndNotifications(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set TEST_DATABASE_URL to run PostgreSQL listener integration tests")
	}
	ctx := context.Background()
	db, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	h := New()
	h.listenIdle = 20 * time.Millisecond
	h.pingTimeout = time.Second
	config := db.Config().ConnConfig.Copy()
	name := "test_match_listener_" + database.ID()
	config.RuntimeParams["application_name"] = name
	runCtx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() { defer close(done); h.Run(runCtx, config) }()
	defer func() { cancel(); <-done }()
	changes, stop := h.Subscribe(name)
	defer stop()
	receive(t, changes)
	var initialPID, finalPID int
	if err = db.QueryRow(ctx, `SELECT pid FROM pg_stat_activity WHERE application_name=$1`, name).Scan(&initialPID); err != nil {
		t.Fatal(err)
	}
	// Exercise several real pgx notification-deadline/heartbeat cycles.
	time.Sleep(120 * time.Millisecond)
	if err = db.QueryRow(ctx, `SELECT pid FROM pg_stat_activity WHERE application_name=$1`, name).Scan(&finalPID); err != nil || initialPID != finalPID {
		t.Fatalf("idle heartbeat lost LISTEN session: %d -> %d, %v", initialPID, finalPID, err)
	}
	noChange(t, changes)
	var schema string
	if err = db.QueryRow(ctx, `SELECT current_schema()`).Scan(&schema); err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(map[string]string{"schema": schema, "userId": name})
	if _, err = db.Exec(ctx, `SELECT pg_notify($1,$2)`, channel, string(payload)); err != nil {
		t.Fatal(err)
	}
	receive(t, changes)
}
