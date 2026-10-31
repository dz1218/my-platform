package livekit

import (
	"context"
	"errors"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"

	"companion/server/internal/auth"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

func TestScopedReservationsAndRecoveryAcrossReplicas(t *testing.T) {
	dbURL, cacheURL := os.Getenv("TEST_DATABASE_URL"), os.Getenv("TEST_REDIS_URL")
	if dbURL == "" || cacheURL == "" {
		t.Skip("set TEST_DATABASE_URL and TEST_REDIS_URL for scoped reservations/recovery integration")
	}
	f := newLifecycleFixture(t)
	cfg := f.h.Client.config
	cfg.ScopedLocks = true
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	var handlers []Handler
	for i := 0; i < 2; i++ {
		config, err := pgxpool.ParseConfig(dbURL)
		if err != nil {
			t.Fatal(err)
		}
		delete(config.ConnConfig.RuntimeParams, "schema")
		config.MaxConns = 1
		db, err := pgxpool.NewWithConfig(ctx, config)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(db.Close)
		options, err := redis.ParseURL(cacheURL)
		if err != nil {
			t.Fatal(err)
		}
		cache := redis.NewClient(options)
		t.Cleanup(func() { _ = cache.Close() })
		handlers = append(handlers, Handler{Client: NewClient(cfg), RoomCache: cache, Auth: auth.Handler{Service: auth.Service{VersionLookup: func(context.Context, string) (int64, error) { return 0, nil }, Repo: auth.Repository{DB: db}, Secret: "test-session-secret"}}})
	}
	a, b := handlers[0], handlers[1]
	t.Cleanup(func() { cleanupLifecycleKeys(t, a) })
	a.Client.config.Limits = map[string]int{"connections_account": 1}
	b.Client.config.Limits = map[string]int{"connections_account": 1}
	requestContext := func() *gin.Context {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("GET", "/", nil)
		return c
	}
	lease, ok := a.acquireRoomLease(requestContext(), "lease-owner")
	if !ok {
		t.Fatal("initial shared lease failed")
	}
	if _, ok := b.acquireRoomLease(requestContext(), "lease-owner"); ok {
		t.Fatal("another replica bypassed connection limit")
	}
	lease.release()
	lease, ok = b.acquireRoomLease(requestContext(), "lease-owner")
	if !ok {
		t.Fatal("shared lease was not released")
	}
	if err := b.RoomCache.ZAdd(ctx, lease.key, redis.Z{Score: float64(time.Now().Add(-time.Second).UnixMilli()), Member: lease.id}).Err(); err != nil {
		t.Fatal(err)
	}
	newLease, ok := a.acquireRoomLease(requestContext(), "lease-owner")
	if !ok {
		t.Fatal("crashed replica lease was not reclaimed")
	}
	lease.release()
	newLease.release()
	if err := a.prepareRoomWrites(ctx); err != nil {
		t.Fatal(err)
	}
	release, _, _, err := a.lockMutation(ctx, "owner-a", "room-a", "title-a", true)
	if err != nil {
		t.Fatal(err)
	}
	second, _, _, err := b.lockMutation(ctx, "owner-b", "room-b", "title-b", true)
	if err != nil {
		release()
		t.Fatal(err)
	}
	second()
	release()
	if err := a.saveOwnerRoom(ctx, "owner-a", ownerRoom{ID: "pending-shared", Title: "Pending", Pending: true}); err != nil {
		t.Fatal(err)
	}
	if err := b.saveOwnerRoom(ctx, "owner-b", ownerRoom{ID: "pending-shared", Title: "Other", Pending: true}); !errors.Is(err, errRoomReserved) {
		t.Fatal(err)
	}
	if err := b.saveOwnerRoom(ctx, "owner-b", ownerRoom{ID: "other-id", Title: "PENDING", Pending: true}); !errors.Is(err, errRoomReserved) {
		t.Fatal(err)
	}
	f.connect(t, "attempt-shared-recovery")
	if err := a.SyncRooms(ctx); err != nil {
		t.Fatal(err)
	}
	if err := a.saveOwnerRoom(ctx, "test-user", ownerRoom{ID: "room-host", Title: "主播房间"}); err != nil {
		t.Fatal(err)
	}
	f.Lock()
	f.people["room-host"] = nil
	f.Unlock()
	if err := a.ReconcileRoom(ctx, "room-host"); err != nil {
		t.Fatal(err)
	}
	r, err := b.loadLifecycle(ctx, "room-host")
	if err != nil || r.ReconnectDeadline == 0 {
		t.Fatal(r, err)
	}
	expireHostRecovery(t, a, "room-host")
	var workers sync.WaitGroup
	for _, h := range handlers {
		workers.Add(1)
		go func(h Handler) {
			defer workers.Done()
			if err := h.checkRoomDue(ctx, "room-host"); err != nil {
				t.Error(err)
			}
		}(h)
	}
	workers.Wait()
	r, err = b.loadLifecycle(ctx, "room-host")
	if err != nil || r.State != "closed" || f.deletes != 1 {
		t.Fatal(r, err, f.deletes)
	}
	if _, err := b.RoomCache.ZScore(ctx, b.checkQueueKey(), "room-host").Result(); !errors.Is(err, redis.Nil) {
		t.Fatal("completed job remained queued", err)
	}
}
