package httpapi

import (
	"context"
	"os"
	"testing"
	"time"

	"companion/server/internal/behavior"
	"companion/server/internal/conversation"
	"companion/server/internal/delivery"
	"companion/server/internal/matching"
	"companion/server/internal/matchupdates"
	"companion/server/migrations"
	"companion/server/pkg/database"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/net/websocket"
)

func matchUpdatesTestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set TEST_DATABASE_URL to run isolated-schema PostgreSQL integration tests")
	}
	ctx := context.Background()
	root, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	schema := "test_match_updates_" + database.ID()
	if _, err = root.Exec(ctx, `CREATE SCHEMA `+schema); err != nil {
		root.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := root.Exec(ctx, `DROP SCHEMA `+schema+` CASCADE`); err != nil {
			t.Error(err)
		}
		root.Close()
	})
	cfg := root.Config()
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	db, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	if err = migrations.Apply(ctx, db); err != nil {
		t.Fatal(err)
	}
	if err = migrations.Apply(ctx, db); err != nil {
		t.Fatal("migration rerun", err)
	}
	if _, err = db.Exec(ctx, `INSERT INTO users(id,email,password_hash,name) VALUES
	 ('owner','owner@example.test','unused','Owner'),('other','other@example.test','unused','Other')`); err != nil {
		t.Fatal(err)
	}
	return db
}

type matchEvent struct {
	Type  string           `json:"type"`
	Items []matching.Match `json:"items"`
	err   error
}

func matchEvents(ws *websocket.Conn) <-chan matchEvent {
	stream := make(chan matchEvent, 20)
	_ = ws.SetReadDeadline(time.Time{})
	go func() {
		defer close(stream)
		for {
			var event matchEvent
			event.err = websocket.JSON.Receive(ws, &event)
			stream <- event
			if event.err != nil {
				return
			}
		}
	}()
	return stream
}

func expectMatchOrder(t *testing.T, stream <-chan matchEvent, want ...string) {
	t.Helper()
	select {
	case event := <-stream:
		if event.err != nil || event.Type != "matches.updated" {
			t.Fatalf("unexpected event: %+v", event)
		}
		if len(event.Items) != len(want) {
			t.Fatalf("want %v, got %+v", want, event.Items)
		}
		for i, id := range want {
			if event.Items[i].ID != id {
				t.Fatalf("want %v, got %+v", want, event.Items)
			}
		}
	case <-time.After(6 * time.Second):
		t.Fatal("timed out waiting for committed account snapshot")
	}
}

func expectNoMatchEvent(t *testing.T, stream <-chan matchEvent) {
	t.Helper()
	select {
	case event := <-stream:
		t.Fatalf("unexpected account update: %+v", event)
	case <-time.After(100 * time.Millisecond):
	}
}

func TestMatchesSocketPostgresCommitIsolationAndListenerRecovery(t *testing.T) {
	db := matchUpdatesTestDB(t)
	ctx := context.Background()
	repo := matching.Repository{DB: db}
	older, err := repo.Create(ctx, "owner", "identity_linwan")
	if err != nil {
		t.Fatal(err)
	}
	newer, err := repo.Create(ctx, "owner", "identity_suhe")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(ctx, `UPDATE conversations SET updated_at=now()-interval '1 hour' WHERE id=$1`, older.ConversationID); err != nil {
		t.Fatal(err)
	}
	// Two hubs represent separate API processes listening to the same database.
	startHub := func(suffix string) (*matchupdates.Hub, string) {
		hub := matchupdates.New()
		cfg := db.Config().ConnConfig.Copy()
		name := cfg.RuntimeParams["search_path"] + suffix
		cfg.RuntimeParams["application_name"] = name
		runCtx, cancel := context.WithCancel(ctx)
		done := make(chan struct{})
		go func() {
			defer close(done)
			hub.Run(runCtx, cfg)
		}()
		t.Cleanup(func() { cancel(); <-done })
		return hub, name
	}
	hubA, listenerA := startHub("_a")
	hubB, _ := startHub("_b")
	serverA := matchSocketServer(repo, hubA)
	defer serverA.Close()
	serverB := matchSocketServer(repo, hubB)
	defer serverB.Close()
	wsA, err := dialMatchSocket(t, serverA, "owner", "http://web")
	if err != nil {
		t.Fatal(err)
	}
	defer wsA.Close()
	wsB, err := dialMatchSocket(t, serverB, "owner", "http://web")
	if err != nil {
		t.Fatal(err)
	}
	defer wsB.Close()
	wsOther, err := dialMatchSocket(t, serverA, "other", "http://web")
	if err != nil {
		t.Fatal(err)
	}
	defer wsOther.Close()
	a, b, other := matchEvents(wsA), matchEvents(wsB), matchEvents(wsOther)
	expectMatchOrder(t, a, newer.ID, older.ID)
	expectMatchOrder(t, b, newer.ID, older.ID)
	expectMatchOrder(t, other)

	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `UPDATE conversations SET updated_at=clock_timestamp() WHERE id=$1`, older.ConversationID); err != nil {
		t.Fatal(err)
	}
	expectNoMatchEvent(t, a)
	if err = tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	expectNoMatchEvent(t, a)
	expectNoMatchEvent(t, b)

	// This is the ordering write shared by user sends, human replies and worker AI delivery.
	if _, err = db.Exec(ctx, `UPDATE conversations SET updated_at=clock_timestamp() WHERE id=$1`, older.ConversationID); err != nil {
		t.Fatal(err)
	}
	expectMatchOrder(t, a, older.ID, newer.ID)
	expectMatchOrder(t, b, older.ID, newer.ID)
	expectNoMatchEvent(t, other)

	chat := delivery.Service{
		Repo: delivery.Repository{DB: db}, Messages: conversation.Repository{DB: db},
		Policies: behavior.Catalog{Default: behavior.Policy{Version: "test-updates", DebounceSeconds: 1, MaxWaitSeconds: 10, MaxAttempts: 2, RetrySeconds: 1}},
	}
	if _, err = chat.Send(ctx, "owner", newer.ConversationID, "account-user-send", "你好"); err != nil {
		t.Fatal("user send", err)
	}
	expectMatchOrder(t, a, newer.ID, older.ID)
	expectMatchOrder(t, b, newer.ID, older.ID)
	if _, err = db.Exec(ctx, `UPDATE conversations SET updated_at=clock_timestamp() WHERE id=$1`, older.ConversationID); err != nil {
		t.Fatal(err)
	}
	expectMatchOrder(t, a, older.ID, newer.ID)
	expectMatchOrder(t, b, older.ID, newer.ID)
	if _, err = db.Exec(ctx, `UPDATE reply_jobs SET due_at=now()-interval '1 second'`); err != nil {
		t.Fatal(err)
	}
	job, err := chat.Repo.Claim(ctx)
	if err != nil {
		t.Fatal("worker claim", err)
	}
	if err = chat.Repo.Schedule(ctx, job, "我在这里", "test-updates", time.Now().Add(-time.Second)); err != nil {
		t.Fatal("worker schedule", err)
	}
	if delivered, err := chat.Repo.Deliver(ctx); err != nil || !delivered {
		t.Fatalf("worker delivery: %v %v", delivered, err)
	}
	expectMatchOrder(t, a, newer.ID, older.ID)
	expectMatchOrder(t, b, newer.ID, older.ID)
	if _, err = db.Exec(ctx, `UPDATE users SET gender=(SELECT gender FROM identities WHERE id='identity_linwan') WHERE id='other'`); err != nil {
		t.Fatal(err)
	}
	if err = chat.Repo.InheritIdentity(ctx, "other", "identity_linwan", chat.Policies); err != nil {
		t.Fatal("inherit identity for human reply", err)
	}
	expectMatchOrder(t, a, older.ID, newer.ID)
	expectMatchOrder(t, b, older.ID, newer.ID)
	expectMatchOrder(t, other)
	if _, err = chat.Send(ctx, "owner", newer.ConversationID, "account-user-next", "再聊一会"); err != nil {
		t.Fatal(err)
	}
	expectMatchOrder(t, a, newer.ID, older.ID)
	expectMatchOrder(t, b, newer.ID, older.ID)
	if message, err := chat.Send(ctx, "other", older.ConversationID, "account-human-send", "我来回复你了"); err != nil || message.Source != "HUMAN" {
		t.Fatalf("human send: %+v %v", message, err)
	}
	expectMatchOrder(t, a, older.ID, newer.ID)
	expectMatchOrder(t, b, older.ID, newer.ID)
	expectNoMatchEvent(t, other)

	created, err := repo.Create(ctx, "owner", "identity_chennian")
	if err != nil {
		t.Fatal(err)
	}
	expectMatchOrder(t, a, created.ID, older.ID, newer.ID)
	expectMatchOrder(t, b, created.ID, older.ID, newer.ID)
	if _, err = db.Exec(ctx, `INSERT INTO identity_inheritances(identity_id,user_id) VALUES('identity_suhe','owner')`); err != nil {
		t.Fatal(err)
	}
	expectMatchOrder(t, a, created.ID, older.ID)
	expectMatchOrder(t, b, created.ID, older.ID)
	if _, err = db.Exec(ctx, `DELETE FROM conversations WHERE id=$1`, created.ConversationID); err != nil {
		t.Fatal(err)
	}
	expectMatchOrder(t, a, older.ID)
	expectMatchOrder(t, b, older.ID)
	expectNoMatchEvent(t, other)

	// Kill only our isolated listener, then commit while it is disconnected.
	var terminated bool
	if err = db.QueryRow(ctx, `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name=$1`, listenerA).Scan(&terminated); err != nil || !terminated {
		t.Fatalf("terminate isolated listener: %v %v", terminated, err)
	}
	otherMatch, err := repo.Create(ctx, "other", "identity_chennian")
	if err != nil {
		t.Fatal(err)
	}
	// Re-LISTEN refreshes every account, including the previously idle owner.
	expectMatchOrder(t, a, older.ID)
	expectMatchOrder(t, other, otherMatch.ID)
	expectNoMatchEvent(t, b)
}
