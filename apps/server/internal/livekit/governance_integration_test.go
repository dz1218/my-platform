package livekit

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"companion/server/internal/auth"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// All SQL lives in a unique schema; Redis keys use the fixture's unique LiveKit
// URL namespace. Never migrate or truncate the developer's application tables.
func TestGovernancePersistenceAcrossReplicas(t *testing.T) {
	dbURL, cacheURL := os.Getenv("TEST_DATABASE_URL"), os.Getenv("TEST_REDIS_URL")
	if dbURL == "" || cacheURL == "" {
		t.Skip("set TEST_DATABASE_URL and TEST_REDIS_URL for governance persistence integration")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	admin, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := fmt.Sprintf("live_governance_test_%d", time.Now().UnixNano())
	quoted := pgx.Identifier{schema}.Sanitize()
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+quoted); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if _, err := admin.Exec(context.Background(), "DROP SCHEMA "+quoted+" CASCADE"); err != nil {
			t.Error(err)
		}
	}()
	migration, err := os.ReadFile("../../migrations/016_live_governance.sql")
	if err != nil {
		t.Fatal(err)
	}
	historyMigration, err := os.ReadFile("../../migrations/017_live_chat_history.sql")
	if err != nil {
		t.Fatal(err)
	}
	migration = append(migration, historyMigration...)
	f := newGovernanceFixture(t)
	var replicas []Handler
	for i := 0; i < 2; i++ {
		cfg, err := pgxpool.ParseConfig(dbURL)
		if err != nil {
			t.Fatal(err)
		}
		delete(cfg.ConnConfig.RuntimeParams, "schema")
		cfg.ConnConfig.RuntimeParams["search_path"] = schema
		cfg.MaxConns = 4
		db, err := pgxpool.NewWithConfig(ctx, cfg)
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		if i == 0 {
			if _, err = db.Exec(ctx, "CREATE TABLE users (id text PRIMARY KEY); INSERT INTO users(id) VALUES ('test-user');"+string(migration)); err != nil {
				t.Fatal(err)
			}
		}
		opts, err := redis.ParseURL(cacheURL)
		if err != nil {
			t.Fatal(err)
		}
		cache := redis.NewClient(opts)
		defer cache.Close()
		h := f.handler
		h.RoomCache = cache
		h.Auth.Service.Repo = auth.Repository{DB: db}
		replicas = append(replicas, h)
	}
	a, b := replicas[0], replicas[1]
	defer cleanupLifecycleKeys(t, a)
	defer a.RoomCache.Del(context.Background(), a.governanceKey(f.record)+":chat")
	g, _ := f.handler.loadGovernance(ctx, f.record)
	if err = a.saveLifecycle(ctx, f.record); err != nil {
		t.Fatal(err)
	}
	unlock, err := a.lockVoice(ctx, f.record.ID)
	if err != nil {
		t.Fatal(err)
	}
	settings := defaultLiveSettings()
	settings.Rules = "测试房规"
	settings.FAQ = []LiveFAQ{{Question: "几点", Answer: "八点"}}
	if err = a.saveLiveSettings(ctx, f.record, settings); err != nil {
		unlock()
		t.Fatal(err)
	}
	f.failUpdate = true
	action, err := a.changeModeration(ctx, f.record, g, "host_test-user", liveModerationInput{RequestID: "persist-mute-request", MemberID: "viewer_one", Kind: "mute", Duration: 300})
	unlock()
	if err != nil {
		t.Fatal(err)
	}
	if action.Status != "failed" {
		t.Fatal("expected recoverable SDK failure")
	}
	loaded, err := b.loadGovernance(ctx, f.record)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Members["viewer_one"].Mute == nil || loaded.Actions[0].Status != "failed" {
		t.Fatal("desired restriction was not persisted")
	}
	unlock, err = b.lockVoice(ctx, f.record.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = b.changeModeration(ctx, f.record, loaded, "host_test-user", liveModerationInput{RequestID: "persist-retry-request", Kind: "retry", ActionID: action.ID})
	unlock()
	if err != nil {
		t.Fatal(err)
	}
	loaded, err = a.loadGovernance(ctx, f.record)
	if err != nil || loaded.Actions[0].Status != "applied" {
		t.Fatal("replica could not recover pending action", err)
	}
	chat, _ := a.loadChatBuffer(ctx, f.record)
	message := a.appendLiveMessage(chat, LiveChatMessage{MemberID: "viewer_one", Name: "听众·FE7A", Text: "测试聊天 100%_", Role: "viewer"})
	if err = a.saveChatBuffer(ctx, f.record, chat); err != nil {
		t.Fatal(err)
	}
	replayed, err := b.loadChatBuffer(ctx, f.record)
	if err != nil || len(replayed.Messages) != 1 || replayed.Messages[0].ID != message.ID {
		t.Fatal("shared replay failed", err)
	}
	second := a.appendLiveMessage(chat, LiveChatMessage{MemberID: "viewer_two", Name: "另一位观众", Text: "另一条公开发言", Role: "viewer"})
	a.appendLiveMessage(chat, LiveChatMessage{Text: "私有测试聊天 100%_", Role: "system", Destination: "host"})
	if err = a.saveChatBuffer(ctx, f.record, chat); err != nil {
		t.Fatal(err)
	}
	// Expiring Redis delivery data must not expire the assistant's transcript.
	if err = a.RoomCache.Del(ctx, a.governanceKey(f.record)+":chat").Err(); err != nil {
		t.Fatal(err)
	}
	page, err := b.readRoomHistory(ctx, f.record, roomHistoryQuery{Query: "100%_", Limit: 30})
	if err != nil || len(page.Messages) != 1 || page.Messages[0].ID != message.ID {
		t.Fatal("persistent assistant history failed", page, err)
	}
	for _, member := range []string{"viewer_one", "fe7a"} {
		page, err = b.readRoomHistory(ctx, f.record, roomHistoryQuery{Member: member, Limit: 30})
		if err != nil || len(page.Messages) != 1 || page.Messages[0].ID != message.ID {
			t.Fatal("persistent member search failed", page, err)
		}
	}
	page, err = b.readRoomHistory(ctx, f.record, roomHistoryQuery{Limit: 1})
	if err != nil || len(page.Messages) != 1 || page.Messages[0].ID != second.ID || page.NextBefore == nil {
		t.Fatal("persistent history pagination failed", page, err)
	}
	page, err = b.readRoomHistory(ctx, f.record, roomHistoryQuery{Before: *page.NextBefore, Through: message.Sequence, Limit: 1})
	if err != nil || len(page.Messages) != 1 || page.Messages[0].ID != message.ID || page.NextBefore != nil {
		t.Fatal("persistent history cursor failed", page, err)
	}
	newRoom := *f.record
	newRoom.SID += "_next"
	page, err = b.readRoomHistory(ctx, &newRoom, roomHistoryQuery{Limit: 30})
	if err != nil || len(page.Messages) != 0 {
		t.Fatal("history crossed broadcast boundary", page, err)
	}
	fresh, err := b.loadGovernance(ctx, &newRoom)
	if err != nil || len(fresh.Members) != 0 || len(fresh.Actions) != 0 || fresh.Settings.Rules != settings.Rules {
		t.Fatal("new room inherited sanctions or lost preferences", err)
	}
}
