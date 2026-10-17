package livekit

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"companion/server/internal/auth"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type lifecycleFixture struct {
	sync.Mutex
	rooms              map[string]room
	people             map[string][]voiceParticipant
	deletes            int
	failParticipants   bool
	failDelete         bool
	deleteResponseLost bool
	globalStale        bool
	failList           bool
	rpcCount           int
	h                  Handler
	router             *gin.Engine
}

func newLifecycleFixture(t *testing.T) *lifecycleFixture {
	t.Helper()
	f := &lifecycleFixture{rooms: map[string]room{}, people: map[string][]voiceParticipant{}}
	f.rooms["room-host"] = room{SID: "RM_host", Name: "room-host", Metadata: `{"ownerId":"test-user","title":"主播房间"}`}
	f.rooms["room-other"] = room{SID: "RM_other", Name: "room-other", Metadata: `{"ownerId":"other-user","title":"别人的房间"}`}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.Lock()
		defer f.Unlock()
		f.rpcCount++
		w.Header().Set("Content-Type", "application/json")
		var in struct {
			Names                          []string
			Room, Identity, Name, Metadata string
		}
		_ = json.NewDecoder(r.Body).Decode(&in)
		switch {
		case strings.HasSuffix(r.URL.Path, "/ListRooms"):
			if f.failList {
				w.WriteHeader(503)
				return
			}
			items := []room{}
			for id, item := range f.rooms {
				if len(in.Names) > 0 && in.Names[0] != id {
					continue
				}
				if len(in.Names) == 0 && f.globalStale {
					continue
				}
				items = append(items, item)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"rooms": items})
		case strings.HasSuffix(r.URL.Path, "/ListParticipants"):
			if f.failParticipants {
				w.WriteHeader(503)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"participants": f.people[in.Room]})
		case strings.HasSuffix(r.URL.Path, "/DeleteRoom"):
			f.deletes++
			if !f.failDelete {
				delete(f.rooms, in.Room)
				delete(f.people, in.Room)
			}
			if f.failDelete || f.deleteResponseLost {
				w.WriteHeader(503)
				return
			}
			_, _ = w.Write([]byte(`{}`))
		case strings.HasSuffix(r.URL.Path, "/RemoveParticipant"):
			remaining := []voiceParticipant{}
			for _, p := range f.people[in.Room] {
				if p.Identity != in.Identity {
					remaining = append(remaining, p)
				}
			}
			f.people[in.Room] = remaining
			_, _ = w.Write([]byte(`{}`))
		case strings.HasSuffix(r.URL.Path, "/CreateRoom"):
			item := room{SID: "RM_" + in.Name, Name: in.Name, Metadata: in.Metadata}
			f.rooms[in.Name] = item
			_ = json.NewEncoder(w).Encode(item)
		default:
			t.Errorf("unexpected lifecycle RPC %s", r.URL.Path)
			w.WriteHeader(500)
		}
	}))
	t.Cleanup(server.Close)
	cfg := Config{URL: server.URL, APIKey: "test-key", APISecret: "test-secret"}
	f.h = Handler{Client: NewClient(cfg), Auth: auth.Handler{Service: auth.Service{Secret: "test-session-secret"}}}
	f.router = gin.New()
	Register(f.router, cfg, f.h.Auth)
	if err := f.h.SyncRooms(context.Background()); err != nil {
		t.Fatal(err)
	}
	return f
}

func (f *lifecycleFixture) connect(t *testing.T, attempt string) map[string]any {
	t.Helper()
	joined := request(t, f.router, "POST", "/rooms/room-host/join", fmt.Sprintf(`{"attemptId":%q}`, attempt), 201)
	f.Lock()
	f.people["room-host"] = []voiceParticipant{{SID: "PA_current", Identity: joined["identity"].(string), State: json.RawMessage(`"ACTIVE"`)}}
	f.Unlock()
	if err := f.h.ReconcileRoom(context.Background(), "room-host"); err != nil {
		t.Fatal(err)
	}
	return joined
}

func TestHostAdmissionConcurrentPagesAndViewerScope(t *testing.T) {
	f := newLifecycleFixture(t)
	second := gin.New()
	Register(second, f.h.Client.config, f.h.Auth)
	responses := make(chan *httptest.ResponseRecorder, 2)
	for i, router := range []*gin.Engine{f.router, second} {
		go func(i int, router *gin.Engine) {
			req := httptest.NewRequest("POST", "/rooms/room-host/join", strings.NewReader(fmt.Sprintf(`{"attemptId":"attempt-concurrent-%d"}`, i)))
			token, _ := f.h.Auth.Service.Token("test-user")
			req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: token})
			res := httptest.NewRecorder()
			router.ServeHTTP(res, req)
			responses <- res
		}(i, router)
	}
	created, conflicts := 0, 0
	for i := 0; i < 2; i++ {
		res := <-responses
		switch res.Code {
		case 201:
			created++
		case 409:
			conflicts++
			if !strings.Contains(res.Body.String(), "host_session_in_use") || strings.Contains(res.Body.String(), `"token"`) {
				t.Fatal(res.Body.String())
			}
		default:
			t.Fatal(res.Code, res.Body.String())
		}
	}
	if created != 1 || conflicts != 1 {
		t.Fatal(created, conflicts)
	}
	other := request(t, second, "POST", "/rooms/room-other/join", `{}`, 201)
	if other["role"] != "viewer" {
		t.Fatal("own host slot restricted viewing another room", other)
	}
	viewer := request(t, f.router, "POST", "/rooms/room-host/join", `{}`, 201, "other-user")
	if viewer["role"] != "viewer" {
		t.Fatal(viewer)
	}
}

func TestHostAdmissionRetryAndPendingRecovery(t *testing.T) {
	f := newLifecycleFixture(t)
	first := request(t, f.router, "POST", "/rooms/room-host/join", `{"attemptId":"attempt-retry-1234"}`, 201)
	retry := request(t, f.router, "POST", "/rooms/room-host/join", `{"attemptId":"attempt-retry-1234"}`, 201)
	if first["identity"] != retry["identity"] || first["token"] != retry["token"] {
		t.Fatal("retry changed admission")
	}
	if got := claims(t, first["token"].(string)); got["exp"].(float64)-got["iat"].(float64) != 60 {
		t.Fatal(got)
	}
	record, err := f.h.loadLifecycle(context.Background(), "room-host")
	if err != nil {
		t.Fatal(err)
	}
	record.Host.ExpiresAt = time.Now().Add(-time.Second).Unix()
	if err = f.h.saveLifecycle(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	request(t, f.router, "POST", "/rooms/room-host/join", `{"attemptId":"attempt-different"}`, 409)
	record.Host.PendingUntil = time.Now().Add(-time.Second).Unix()
	if err = f.h.saveLifecycle(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	if err = f.h.ReconcileRoom(context.Background(), "room-host"); err != nil {
		t.Fatal(err)
	}
	if f.deletes != 0 {
		t.Fatal("failed initial connection closed room")
	}
	next := request(t, f.router, "POST", "/rooms/room-host/join", `{"attemptId":"attempt-different"}`, 201)
	if next["identity"] == first["identity"] {
		t.Fatal("expired admission reused")
	}
}

func TestConnectedHostLeavesClosesRoomWithViewersAndReleasesOwner(t *testing.T) {
	f := newLifecycleFixture(t)
	ctx := context.Background()
	if err := f.h.saveOwnerRoom(ctx, "test-user", ownerRoom{ID: "room-host", Title: "主播房间"}); err != nil {
		t.Fatal(err)
	}
	joined := f.connect(t, "attempt-connected-1")
	request(t, f.router, "POST", "/rooms/room-host/join", `{"attemptId":"attempt-connected-1"}`, 409)
	f.Lock()
	f.people["room-host"] = []voiceParticipant{{SID: "PA_viewer", Identity: "viewer_one"}, {SID: "PA_agent", Identity: "assistant", Kind: json.RawMessage(`"AGENT"`)}}
	f.Unlock()
	err := f.h.ReconcileRoomEvent(ctx, RoomLifecycleEvent{Event: "participant_left", RoomID: "room-host", RoomSID: "RM_host", Identity: joined["identity"].(string), ParticipantSID: "PA_current"})
	if err != nil {
		t.Fatal(err)
	}
	detail := request(t, f.router, "GET", "/rooms/room-host", "", 200)
	if detail["state"] != "closed" || detail["reason"] != "host_left" {
		t.Fatal(detail)
	}
	request(t, f.router, "POST", "/rooms/room-host/join", `{}`, 410)
	reserved, err := f.h.loadOwnerRoom(ctx, "test-user")
	if err != nil || reserved.ID != "" {
		t.Fatal(reserved, err)
	}
	request(t, f.router, "POST", "/rooms", `{"id":"room-after-host","title":"下一场"}`, 201)
	// A cached LiveKit token can recreate a low-level room, but never its app
	// listing or join route. Explicit reconciliation removes the orphaned transport.
	f.Lock()
	f.rooms["room-host"] = room{Name: "room-host", SID: "RM_replayed"}
	f.Unlock()
	listed := request(t, f.router, "GET", "/rooms", "", 200)["items"].([]any)
	for _, raw := range listed {
		if raw.(map[string]any)["id"] == "room-host" {
			t.Fatal("closed room resurfaced")
		}
	}
	request(t, f.router, "POST", "/rooms/room-host/join", `{}`, 410)
	if err = f.h.ReconcileRoom(ctx, "room-host"); err != nil {
		t.Fatal(err)
	}
	if f.deletes != 2 {
		t.Fatal(f.deletes)
	}
}

func TestLifecycleShortSessionsAndDelayedEvents(t *testing.T) {
	t.Run("joined event may precede participant list visibility", func(t *testing.T) {
		f := newLifecycleFixture(t)
		joined := request(t, f.router, "POST", "/rooms/room-host/join", `{"attemptId":"attempt-joined-lag"}`, 201)
		err := f.h.ReconcileRoomEvent(context.Background(), RoomLifecycleEvent{Event: "participant_joined", RoomID: "room-host", RoomSID: "RM_host", Identity: joined["identity"].(string), ParticipantSID: "PA_joined"})
		record, _ := f.h.loadLifecycle(context.Background(), "room-host")
		if err != nil || f.deletes != 0 || !record.HadHost {
			t.Fatal(err, f.deletes, record)
		}
	})
	t.Run("short connection is closed by its authenticated leave event", func(t *testing.T) {
		f := newLifecycleFixture(t)
		joined := request(t, f.router, "POST", "/rooms/room-host/join", `{"attemptId":"attempt-short-1234"}`, 201)
		err := f.h.ReconcileRoomEvent(context.Background(), RoomLifecycleEvent{Event: "participant_left", RoomID: "room-host", RoomSID: "RM_host", Identity: joined["identity"].(string), ParticipantSID: "PA_short"})
		if err != nil || f.deletes != 1 {
			t.Fatal(err, f.deletes)
		}
	})
	t.Run("old participant and room events cannot close reconnected host", func(t *testing.T) {
		f := newLifecycleFixture(t)
		joined := f.connect(t, "attempt-reconnect-1")
		f.Lock()
		f.people["room-host"][0].SID = "PA_reconnected"
		f.Unlock()
		err := f.h.ReconcileRoomEvent(context.Background(), RoomLifecycleEvent{Event: "participant_left", RoomID: "room-host", RoomSID: "RM_host", Identity: joined["identity"].(string), ParticipantSID: "PA_current"})
		if err != nil {
			t.Fatal(err)
		}
		err = f.h.ReconcileRoomEvent(context.Background(), RoomLifecycleEvent{Event: "room_finished", RoomID: "room-host", RoomSID: "RM_older"})
		if err != nil || f.deletes != 0 {
			t.Fatal(err, f.deletes)
		}
		record, _ := f.h.loadLifecycle(context.Background(), "room-host")
		if record.Host.SID != "PA_reconnected" {
			t.Fatal(record)
		}
	})
	t.Run("different room SID cannot be deleted using old open record", func(t *testing.T) {
		f := newLifecycleFixture(t)
		f.connect(t, "attempt-new-room-sid")
		f.Lock()
		r := f.rooms["room-host"]
		r.SID = "RM_independent"
		f.rooms["room-host"] = r
		f.Unlock()
		for i := 0; i < 2; i++ {
			if err := f.h.ReconcileRoom(context.Background(), "room-host"); err != nil {
				t.Fatal(err)
			}
		}
		if f.deletes != 0 {
			t.Fatal("deleted a different room SID", f.deletes)
		}
		record, _ := f.h.loadLifecycle(context.Background(), "room-host")
		if record.State != "closed" || record.SID != "RM_host" {
			t.Fatal(record)
		}
	})
}

func TestLifecycleFailuresAndRestartDoNotReleaseOrReopen(t *testing.T) {
	f := newLifecycleFixture(t)
	ctx := context.Background()
	f.connect(t, "attempt-failures-1")
	if err := f.h.saveOwnerRoom(ctx, "test-user", ownerRoom{ID: "room-host"}); err != nil {
		t.Fatal(err)
	}
	f.Lock()
	f.people["room-host"] = nil
	f.failParticipants = true
	f.Unlock()
	if err := f.h.ReconcileRoom(ctx, "room-host"); err == nil || f.deletes != 0 {
		t.Fatal("upstream failure treated as departure", err, f.deletes)
	}
	f.Lock()
	f.failParticipants = false
	f.failDelete = true
	f.Unlock()
	if err := f.h.ReconcileRoom(ctx, "room-host"); err == nil {
		t.Fatal("delete failure hidden")
	}
	record, _ := f.h.loadLifecycle(ctx, "room-host")
	reserved, _ := f.h.loadOwnerRoom(ctx, "test-user")
	if record.State != "closing" || reserved.ID != "room-host" {
		t.Fatal(record, reserved)
	}
	request(t, f.router, "POST", "/rooms/room-host/join", `{}`, 410)
	// A new handler, like a restarted process using the same Redis scope,
	// retries the persisted close even if the global list omits the room.
	f.Lock()
	f.failDelete = false
	f.deleteResponseLost = true
	f.globalStale = true
	f.Unlock()
	restarted := Handler{Client: NewClient(f.h.Client.config), Auth: f.h.Auth, now: func() time.Time { return time.Now().Add(2 * time.Second) }}
	if err := restarted.retryRoomClose(ctx, "room-host"); err != nil {
		t.Fatal(err)
	}
	record, _ = restarted.loadLifecycle(ctx, "room-host")
	reserved, _ = restarted.loadOwnerRoom(ctx, "test-user")
	if record.State != "closed" || reserved.ID != "" {
		t.Fatal(record, reserved)
	}
}

func TestPresenceChecksActualHostAndNativeEmptyTimeout(t *testing.T) {
	f := newLifecycleFixture(t)
	joined := request(t, f.router, "POST", "/rooms/room-host/join", `{"attemptId":"attempt-presence-1"}`, 201)
	call := func(want int) {
		req := httptest.NewRequest("POST", "/rooms/room-host/presence", nil)
		req.Header.Set("X-Live-Voice-Token", joined["voiceToken"].(string))
		token, _ := f.h.Auth.Service.Token("test-user")
		req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: token})
		res := httptest.NewRecorder()
		f.router.ServeHTTP(res, req)
		if res.Code != want {
			t.Fatal(res.Code, res.Body.String())
		}
	}
	call(409)
	if f.deletes != 0 {
		t.Fatal("unconnected creation was closed")
	}
	f.Lock()
	f.people["room-host"] = []voiceParticipant{{SID: "PA_presence", Identity: joined["identity"].(string), State: json.RawMessage(`"ACTIVE"`)}}
	f.Unlock()
	call(200)
	// No browser heartbeat is required after confirmation.
	if err := f.h.ReconcileRoom(context.Background(), "room-host"); err != nil || f.deletes != 0 {
		t.Fatal(err, f.deletes)
	}
	request(t, f.router, "GET", "/rooms/unknown-room", "", 404)
}

func TestIncompleteHostConnectionReservesWithoutClosingRoom(t *testing.T) {
	for _, state := range []string{`null`, `0`, `1`, `"JOINING"`, `"JOINED"`} {
		t.Run(state, func(t *testing.T) {
			f := newLifecycleFixture(t)
			joined := request(t, f.router, "POST", "/rooms/room-host/join", `{"attemptId":"attempt-incomplete"}`, 201)
			f.Lock()
			f.people["room-host"] = []voiceParticipant{{SID: "PA_handshake", Identity: joined["identity"].(string), State: json.RawMessage(state)}}
			f.Unlock()
			if err := f.h.ReconcileRoom(context.Background(), "room-host"); err != nil {
				t.Fatal(err)
			}
			request(t, f.router, "POST", "/rooms/room-host/join", `{"attemptId":"attempt-second-page"}`, 409)
			record, _ := f.h.loadLifecycle(context.Background(), "room-host")
			if record.HadHost {
				t.Fatal("incomplete transport counted as successful host", record)
			}
			f.Lock()
			f.people["room-host"] = nil
			f.Unlock()
			if err := f.h.ReconcileRoomEvent(context.Background(), RoomLifecycleEvent{Event: "participant_connection_aborted", RoomID: "room-host", RoomSID: "RM_host", Identity: joined["identity"].(string), ParticipantSID: "PA_handshake"}); err != nil {
				t.Fatal(err)
			}
			if err := f.h.ReconcileRoom(context.Background(), "room-host"); err != nil || f.deletes != 0 {
				t.Fatal(err, f.deletes)
			}
		})
	}
}

func TestAdmittedHostIdentityExcludesOlderConnection(t *testing.T) {
	f := newLifecycleFixture(t)
	joined := f.connect(t, "attempt-current-host")
	f.Lock()
	f.people["room-host"] = append(f.people["room-host"], voiceParticipant{SID: "PA_old", Identity: "host_test-user_expired-session", State: json.RawMessage(`2`)})
	f.Unlock()
	oldToken, _ := f.h.Client.VoiceToken("room-host", "host_test-user_expired-session", "test-user")
	req := httptest.NewRequest("GET", "/rooms/room-host/voice", nil)
	req.Header.Set("X-Live-Voice-Token", oldToken)
	session, _ := f.h.Auth.Service.Token("test-user")
	req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: session})
	res := httptest.NewRecorder()
	f.router.ServeHTTP(res, req)
	if res.Code != 403 {
		t.Fatal("old admission could control host actions", res.Code, res.Body.String())
	}
	if err := f.h.ReconcileRoom(context.Background(), "room-host"); err != nil {
		t.Fatal(err)
	}
	if len(f.people["room-host"]) != 1 || f.people["room-host"][0].Identity != joined["identity"] {
		t.Fatal(f.people)
	}
}

func TestHostAdmissionAcrossRedisClientsAndDatabaseLocks(t *testing.T) {
	dbURL, cacheURL := os.Getenv("TEST_DATABASE_URL"), os.Getenv("TEST_REDIS_URL")
	if dbURL == "" || cacheURL == "" {
		t.Skip("set TEST_DATABASE_URL and TEST_REDIS_URL for shared host admission integration")
	}
	f := newLifecycleFixture(t)
	var handlers []Handler
	var routers []*gin.Engine
	for i := 0; i < 2; i++ {
		cfg, err := pgxpool.ParseConfig(dbURL)
		if err != nil {
			t.Fatal(err)
		}
		delete(cfg.ConnConfig.RuntimeParams, "schema")
		cfg.MaxConns = 1
		db, err := pgxpool.NewWithConfig(context.Background(), cfg)
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
		h := Handler{Client: NewClient(f.h.Client.config), Auth: auth.Handler{Service: auth.Service{Repo: auth.Repository{DB: db}, Secret: "test-session-secret"}}, RoomCache: cache}
		handlers = append(handlers, h)
		router := gin.New()
		Register(router, f.h.Client.config, h.Auth, cache)
		routers = append(routers, router)
	}
	t.Cleanup(func() { cleanupLifecycleKeys(t, handlers[0]) })
	responses := make(chan *httptest.ResponseRecorder, 2)
	for i := range handlers {
		go func(i int) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			req := httptest.NewRequest("POST", "/rooms/room-host/join", strings.NewReader(fmt.Sprintf(`{"attemptId":"attempt-replica-%d"}`, i))).WithContext(ctx)
			token, _ := handlers[i].Auth.Service.Token("test-user")
			req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: token})
			res := httptest.NewRecorder()
			routers[i].ServeHTTP(res, req)
			responses <- res
		}(i)
	}
	created, conflicts := 0, 0
	for i := 0; i < 2; i++ {
		res := <-responses
		switch res.Code {
		case 201:
			created++
		case 409:
			conflicts++
		default:
			t.Fatal(res.Code, res.Body.String())
		}
	}
	if created != 1 || conflicts != 1 {
		t.Fatal(created, conflicts)
	}
	record, err := handlers[1].loadLifecycle(context.Background(), "room-host")
	if err != nil || record == nil || record.Host == nil {
		t.Fatal(record, err)
	}
	f.Lock()
	f.people["room-host"] = []voiceParticipant{{SID: "PA_shared", Identity: record.Host.Identity, State: json.RawMessage(`2`)}}
	f.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err = handlers[0].ReconcileRoom(ctx, "room-host"); err != nil {
		t.Fatal(err)
	}
	f.Lock()
	f.people["room-host"] = nil
	f.Unlock()
	if err = handlers[1].ReconcileRoom(ctx, "room-host"); err != nil {
		t.Fatal(err)
	}
	record, err = handlers[0].loadLifecycle(ctx, "room-host")
	if err != nil || record.State != "closed" || f.deletes != 1 {
		t.Fatal(record, err, f.deletes)
	}
}

func cleanupLifecycleKeys(t *testing.T, h Handler) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	it := h.RoomCache.Scan(ctx, 0, h.lifecycleKey("*"), 100).Iterator()
	var keys []string
	for it.Next(ctx) {
		keys = append(keys, it.Val())
	}
	if err := it.Err(); err != nil {
		t.Error(err)
	}
	keys = append(keys, h.lifecycleIndexKey(), h.snapshotReadyKey(), h.closeRetryKey(), h.ownerRoomKey("")+":refresh:all")
	if err := h.RoomCache.Del(ctx, keys...).Err(); err != nil {
		t.Error(err)
	}
}
