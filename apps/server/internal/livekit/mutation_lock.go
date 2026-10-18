package livekit

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
)

var localLockModes sync.Map
var localMutationLocks = struct {
	sync.Mutex
	items map[string]*mutationLock
}{items: map[string]*mutationLock{}}

type mutationLock struct {
	ch   chan struct{}
	refs int
}

func localMutationLock(ctx context.Context, key string) (func(), error) {
	localMutationLocks.Lock()
	l := localMutationLocks.items[key]
	if l == nil {
		l = &mutationLock{ch: make(chan struct{}, 1)}
		localMutationLocks.items[key] = l
	}
	l.refs++
	localMutationLocks.Unlock()
	releaseRef := func() {
		localMutationLocks.Lock()
		l.refs--
		if l.refs == 0 {
			delete(localMutationLocks.items, key)
		}
		localMutationLocks.Unlock()
	}
	select {
	case l.ch <- struct{}{}:
		return func() { <-l.ch; releaseRef() }, nil
	case <-ctx.Done():
		releaseRef()
		return nil, ctx.Err()
	}
}
func (h Handler) lockModeKey() string { return h.ownerRoomKey("") + ":reservation-version-2" }
func (h Handler) lockMode() string {
	if h.Client.config.ScopedLocks {
		return "scoped"
	}
	return "global"
}
func (h Handler) storedLockMode(ctx context.Context) (string, error) {
	if h.RoomCache == nil {
		value, _ := localLockModes.Load(h.lockModeKey())
		mode, _ := value.(string)
		return mode, nil
	}
	mode, err := h.RoomCache.Get(ctx, h.lockModeKey()).Result()
	if errors.Is(err, redis.Nil) {
		return "", nil
	}
	return mode, err
}

// A shared gate prevents this version's global/scoped writers from mixing.
// Enabling scoped mode is a separate deployment after older binaries stop.
func (h Handler) prepareRoomWrites(ctx context.Context) error {
	mode, err := h.storedLockMode(ctx)
	if err != nil {
		return err
	}
	if mode == h.lockMode() {
		return nil
	}
	unlock, err := h.lockRoomCreation(ctx)
	if err != nil {
		return err
	}
	defer unlock()
	mode, err = h.storedLockMode(ctx)
	if err != nil {
		return err
	}
	if mode == h.lockMode() {
		return nil
	}
	if mode == "scoped" {
		return errors.New("room lock mode changed; restart all writers with the same mode")
	}
	if err := h.backfillResources(ctx); err != nil {
		return err
	}
	if h.RoomCache != nil {
		return h.RoomCache.Set(ctx, h.lockModeKey(), h.lockMode(), 0).Err()
	}
	localLockModes.Store(h.lockModeKey(), h.lockMode())
	return nil
}

func (h Handler) lockMutation(ctx context.Context, owner, id, title string, create bool) (func(), string, string, error) {
	if err := h.prepareRoomWrites(ctx); err != nil {
		return nil, id, title, err
	}
	start := time.Now()
	var tx pgx.Tx
	var releases []func()
	release := func() {
		for i := len(releases) - 1; i >= 0; i-- {
			releases[i]()
		}
		if tx != nil {
			cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = tx.Rollback(cleanup)
		}
	}
	fail := func(err error) (func(), string, string, error) { release(); return nil, id, title, err }
	if db := h.Auth.Service.Repo.DB; db != nil {
		var err error
		tx, err = db.Begin(ctx)
		if err != nil {
			return nil, id, title, err
		}
	}
	acquire := func(key string, room bool) error {
		if tx != nil {
			number := int64(voiceLockKey(key))
			if key == "global" {
				number = 716482901
			}
			_, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", number)
			return err
		}
		var unlock func()
		var err error
		if key == "global" {
			roomCreationMu.Lock()
			unlock = roomCreationMu.Unlock
		} else if room {
			unlock, err = h.lockVoice(ctx, key)
		} else {
			unlock, err = localMutationLock(ctx, h.ownerRoomKey("")+key)
		}
		if err == nil {
			releases = append(releases, unlock)
		}
		return err
	}
	if h.Client.config.ScopedLocks {
		if err := acquire("account:"+owner, false); err != nil {
			return fail(err)
		}
	} else {
		if err := acquire("global", false); err != nil {
			return fail(err)
		}
	}
	// A legacy writer may have queued on the global lock during migration.
	mode, err := h.storedLockMode(ctx)
	if err != nil {
		return fail(err)
	}
	if mode != h.lockMode() {
		return fail(errors.New("room lock mode changed"))
	}
	if create {
		reserved, err := h.loadOwnerRoom(ctx, owner)
		if err != nil {
			return fail(err)
		}
		if reserved.Pending {
			id, title = reserved.ID, reserved.Title
		}
	}
	if h.Client.config.ScopedLocks {
		if err := acquire("title:"+foldRoomTitle(title), false); err != nil {
			return fail(err)
		}
	}
	if err := acquire(id, true); err != nil {
		return fail(err)
	}
	elapsed := time.Since(start)
	if elapsed >= 50*time.Millisecond {
		slog.Info("room mutation lock waited", "room", id, "mode", mode, "wait_ms", elapsed.Milliseconds())
	} else {
		slog.Debug("room mutation lock acquired", "room", id, "mode", mode, "wait_ms", elapsed.Milliseconds())
	}
	return release, id, title, nil
}
func (h Handler) lockClosing(ctx context.Context, id string) (func(), error) {
	r, err := h.loadLifecycle(ctx, id)
	if err != nil {
		return nil, err
	}
	if r == nil {
		item, err := h.exactRoom(ctx, id)
		if err != nil {
			return nil, err
		}
		if item != nil {
			r = lifecycleForRoom(*item)
		}
	}
	if r == nil {
		r = &roomLifecycle{ID: id}
	}
	unlock, _, _, err := h.lockMutation(ctx, r.OwnerID, id, r.Title, false)
	return unlock, err
}

func (h Handler) syncAndPrepare(ctx context.Context) error {
	if err := h.SyncRooms(ctx); err != nil {
		return err
	}
	return h.prepareRoomWrites(ctx)
}
