package livekit

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"companion/server/internal/auth"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// Separate Redis clients and one-connection DB pools exercise shared snapshots,
// PubSub recovery, refresh throttling and close ownership across API replicas.
func TestSnapshotsAndPersistentRetriesAcrossRedisClients(t *testing.T) {
	dbURL, cacheURL := os.Getenv("TEST_DATABASE_URL"), os.Getenv("TEST_REDIS_URL")
	if dbURL == "" || cacheURL == "" {
		t.Skip("set TEST_DATABASE_URL and TEST_REDIS_URL for snapshot/retry integration")
	}
	f := newLifecycleFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	var handlers []Handler
	for i := 0; i < 2; i++ {
		cfg, err := pgxpool.ParseConfig(dbURL)
		if err != nil {
			t.Fatal(err)
		}
		delete(cfg.ConnConfig.RuntimeParams, "schema")
		cfg.MaxConns = 1
		db, err := pgxpool.NewWithConfig(ctx, cfg)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(db.Close)
		options, err := redis.ParseURL(cacheURL)
		if err != nil {
			t.Fatal(err)
		}
		options.ClientName = fmt.Sprintf("live-room-test-%d-%d", time.Now().UnixNano(), i)
		cache := redis.NewClient(options)
		t.Cleanup(func() { _ = cache.Close() })
		handlers = append(handlers, Handler{Client: NewClient(f.h.Client.config), RoomCache: cache,
			Auth: auth.Handler{Service: auth.Service{VersionLookup: func(context.Context, string) (int64, error) { return 0, nil }, Repo: auth.Repository{DB: db}, Secret: "test-session-secret"}}})
	}
	h1, h2 := handlers[0], handlers[1]
	t.Cleanup(func() {
		cleanupLifecycleKeys(t, h1)
		_ = h1.RoomCache.Del(context.Background(), h1.ownerRoomKey("test-user"), h1.ownerRoomKey("")+":refresh:room:room-host").Err()
	})
	if err := h1.SyncRooms(ctx); err != nil {
		t.Fatal(err)
	}
	updates, err := h1.SubscribeRoomUpdates(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h2.SubscribeRoomUpdates(ctx); err != nil {
		t.Fatal(err)
	}
	n, err := h2.RoomCache.PubSubNumSub(ctx, h1.RoomUpdatesChannel()).Result()
	if err != nil || n[h1.RoomUpdatesChannel()] != 1 {
		t.Fatal("watchers did not share one Redis subscription", n, err)
	}
	r, err := h2.loadLifecycle(ctx, "room-host")
	if err != nil || r == nil {
		t.Fatal(r, err)
	}
	r.Title = "另一个实例写入"
	if err := h2.saveLifecycle(ctx, r); err != nil {
		t.Fatal(err)
	}
	select {
	case id := <-updates:
		if id != "room-host" {
			t.Fatal(id)
		}
	case <-ctx.Done():
		t.Fatal("cross-client notification was lost")
	}
	snapshot, err := h1.CachedRoom(ctx, "room-host")
	if err != nil || snapshot.Item.Title != r.Title {
		t.Fatal("notification preceded committed snapshot", snapshot, err)
	}

	// Kill only this test's named PubSub connection, leaving shared Redis and
	// all unrelated connections intact. Re-subscribe must issue a full resync.
	clients, err := h2.RoomCache.ClientList(ctx).Result()
	if err != nil {
		t.Fatal(err)
	}
	var pubsubID string
	for _, line := range strings.Split(clients, "\n") {
		if !strings.Contains(line, "name="+h1.RoomCache.Options().ClientName+" ") || !strings.Contains(line, "cmd=subscribe") {
			continue
		}
		for _, field := range strings.Fields(line) {
			if strings.HasPrefix(field, "id=") {
				pubsubID = strings.TrimPrefix(field, "id=")
			}
		}
	}
	if pubsubID == "" {
		t.Fatal("test subscription connection not found")
	}
	if err := h2.RoomCache.ClientKillByFilter(ctx, "ID", pubsubID).Err(); err != nil {
		t.Fatal(err)
	}
	select {
	case id := <-updates:
		if id != "" {
			t.Fatalf("reconnect should request full resync, got %q", id)
		}
	case <-ctx.Done():
		t.Fatal("Redis reconnect did not invalidate snapshots")
	}
	var refreshes atomic.Int32
	for _, h := range handlers {
		if err := h.refreshOnce(ctx, "room:room-host", func(context.Context) error { refreshes.Add(1); return nil }); err != nil {
			t.Fatal(err)
		}
	}
	if refreshes.Load() != 1 {
		t.Fatal("shared refresh throttle failed", refreshes.Load())
	}

	r.HadHost = true
	if err := h1.saveLifecycle(ctx, r); err != nil {
		t.Fatal(err)
	}
	if err := h1.saveOwnerRoom(ctx, "test-user", ownerRoom{ID: "room-host"}); err != nil {
		t.Fatal(err)
	}
	f.Lock()
	f.failDelete = true
	f.Unlock()
	if err := h1.ReconcileRoom(ctx, "room-host"); err != nil {
		t.Fatal(err)
	}
	expireHostRecovery(t, h1, "room-host")
	if err := h1.ReconcileRoom(ctx, "room-host"); err == nil {
		t.Fatal("expected delete failure")
	}
	r, err = h2.loadLifecycle(ctx, "room-host")
	if err != nil || r.State != "closing" || r.Retries != 1 {
		t.Fatal("another replica cannot recover the pending close", r, err)
	}
	f.Lock()
	f.failDelete = false
	before := f.rpcCount
	f.Unlock()
	workers, stopWorkers := context.WithCancel(ctx)
	defer stopWorkers()
	done := make(chan struct{}, 2)
	for _, h := range handlers {
		h.now = func() time.Time { return time.Now().Add(2 * time.Second) }
		go func(h Handler) { h.RunRoomRetries(workers); done <- struct{}{} }(h)
	}
	for {
		r, err = h2.loadLifecycle(ctx, "room-host")
		if err != nil {
			t.Fatal(err)
		}
		if r.State == "closed" {
			break
		}
		if ctx.Err() != nil {
			t.Fatal("persisted retry never completed", ctx.Err())
		}
		time.Sleep(5 * time.Millisecond)
	}
	stopWorkers()
	<-done
	<-done
	reserved, err := h2.loadOwnerRoom(ctx, "test-user")
	if err != nil || reserved.ID != "" {
		t.Fatal("confirmed close did not release owner", reserved, err)
	}
	f.Lock()
	defer f.Unlock()
	if f.deletes != 2 || f.rpcCount-before != 2 {
		t.Fatalf("replicas repeated the same deletion or scanned normal rooms: deletes=%d calls=%d", f.deletes, f.rpcCount-before)
	}
}
