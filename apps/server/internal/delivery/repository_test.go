package delivery

import (
	"companion/server/internal/behavior"
	"companion/server/internal/conversation"
	"companion/server/migrations"
	"companion/server/pkg/database"
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"sync"
	"testing"
	"time"
)

func testDB(t *testing.T) *pgxpool.Pool {
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
	schema := "test_delivery_" + database.ID()
	if _, err = root.Exec(ctx, `CREATE SCHEMA `+schema); err != nil {
		root.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, err := root.Exec(ctx, `DROP SCHEMA `+schema+` CASCADE`)
		if err != nil {
			t.Error(err)
		}
		root.Close()
	})
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	delete(cfg.ConnConfig.RuntimeParams, "schema")
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
	_, err = db.Exec(ctx, `INSERT INTO users(id,email,password_hash,name) VALUES('u','u@example.test','unused','User');
 INSERT INTO matches(id,user_id,identity_id) VALUES('m','u','identity_linwan');
 INSERT INTO conversations(id,match_id,user_id,identity_id) VALUES('c','m','u','identity_linwan')`)
	if err != nil {
		t.Fatal(err)
	}
	return db
}
func TestDurableConversationLifecycle(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	repo := Repository{DB: db}
	messages := conversation.Repository{DB: db}
	p := behavior.Policy{Version: "test-v1", DebounceSeconds: 1, MinDelaySeconds: 1, MaxDelaySeconds: 2, CharactersPerSecond: 10, MaxTypingSeconds: 2, MaxAttempts: 2, RetrySeconds: 1}
	service := Service{Repo: repo, Messages: messages, Policies: behavior.Catalog{Default: p}}
	send := func(id, content string) conversation.Message {
		t.Helper()
		m, err := service.Send(ctx, "u", "c", id, content)
		if err != nil {
			t.Fatal(err)
		}
		return m
	}
	due := func() {
		t.Helper()
		if _, err := db.Exec(ctx, `UPDATE reply_jobs SET due_at=now()-interval '1 second'`); err != nil {
			t.Fatal(err)
		}
	}
	claim := func() Job {
		t.Helper()
		due()
		j, err := repo.Claim(ctx)
		if err != nil {
			t.Fatal(err)
		}
		return j
	}
	if _, err := service.Send(ctx, "other", "c", "request-000", "hello"); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("ownership failure: %v", err)
	}
	first := send("request-001", "明天面试")
	if repeated := send("request-001", "明天面试"); repeated.ID != first.ID {
		t.Fatal("duplicate message")
	}
	if _, err := service.Send(ctx, "u", "c", "request-001", "different"); err == nil {
		t.Fatal("accepted conflicting content")
	}
	j1 := claim()
	second := send("request-002", "下午三点")
	if err := repo.Schedule(ctx, j1, "过期草稿", "test", time.Now().Add(-time.Second)); err != nil {
		t.Fatal(err)
	}
	if delivered, err := repo.Deliver(ctx); err != nil || delivered {
		t.Fatal("superseded draft delivered", err)
	}
	j2 := claim()
	// Simulate process death and recovery: old lease owner can no longer write.
	if _, err := db.Exec(ctx, `UPDATE reply_jobs SET lease_until=now()-interval '1 second'`); err != nil {
		t.Fatal(err)
	}
	recovered, err := repo.Claim(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if recovered.ClaimToken == j2.ClaimToken {
		t.Fatal("lease token was reused")
	}
	if err = repo.Schedule(ctx, j2, "过期租约", "test", time.Now().Add(-time.Second)); err != nil {
		t.Fatal(err)
	}
	if err = repo.Schedule(ctx, recovered, "下午面试，加油。", "test-v1", time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if delivered, err := repo.Deliver(ctx); err != nil || delivered {
		t.Fatal("early delivery", err)
	}
	due()
	// A new repository instance simulates restart before scheduled delivery.
	restarted := Repository{DB: db}
	var wg sync.WaitGroup
	for n := 0; n < 6; n++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := restarted.Deliver(ctx); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	conv, _ := messages.Owned(ctx, "u", "c")
	page, err := messages.History(ctx, conv, 0, 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 3 || page.Items[2].Content != "下午面试，加油。" || page.Items[0].Status != "complete" || page.Items[1].Status != "complete" {
		t.Fatalf("bad history: %+v", page.Items)
	}
	if repeated := send("request-002", "下午三点"); repeated.ID != second.ID {
		t.Fatal("completed retry duplicated user message")
	}
	// New input supersedes a scheduled-but-undelivered reply as well.
	send("request-003", "还有点紧张")
	j3 := claim()
	_ = repo.Schedule(ctx, j3, "旧回复", "test", time.Now().Add(time.Hour))
	send("request-004", "不过我准备好了")
	due()
	if delivered, err := repo.Deliver(ctx); err != nil || delivered {
		t.Fatal("scheduled reply not cancelled")
	}
	j4 := claim()
	if err = repo.Failed(ctx, j4); err != nil {
		t.Fatal(err)
	}
	j4 = claim()
	if err = repo.Failed(ctx, j4); err != nil {
		t.Fatal(err)
	}
	var status string
	if err = db.QueryRow(ctx, `SELECT status FROM reply_jobs WHERE conversation_id='c'`).Scan(&status); err != nil || status != "failed" {
		t.Fatal(status, err)
	}
	send("request-004", "不过我准备好了")
	j5 := claim()
	if j5.Version <= j4.Version || j5.Attempts != 1 {
		t.Fatal("explicit retry did not reset job")
	}
	if err = repo.Schedule(ctx, j5, "准备好了就好。", "test", time.Now().Add(-time.Second)); err != nil {
		t.Fatal(err)
	}
	if ok, err := repo.Deliver(ctx); err != nil || !ok {
		t.Fatal(ok, err)
	}
	var count int
	if err = db.QueryRow(ctx, `SELECT count(*) FROM messages WHERE sender_type='identity'`).Scan(&count); err != nil || count != 2 {
		t.Fatal("duplicate delivery", count, err)
	}
}
