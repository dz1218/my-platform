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

type ownerRoomFixture struct {
	sync.Mutex
	rooms       map[string]room
	created     []string
	globalStale bool
	failCreate  int // 1: before applying; 2: response lost; 3: incomplete success
	failList    bool
	config      Config
}

func newOwnerRoomFixture(t *testing.T) *ownerRoomFixture {
	t.Helper()
	f := &ownerRoomFixture{rooms: map[string]room{}, globalStale: true}
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.Lock()
		defer f.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(r.URL.Path, "/ListRooms"):
			if f.failList {
				w.WriteHeader(503)
				return
			}
			var input struct{ Names []string }
			_ = json.NewDecoder(r.Body).Decode(&input)
			items := []room{}
			for _, item := range f.rooms {
				if len(input.Names) == 1 && input.Names[0] == item.Name || len(input.Names) == 0 && !f.globalStale {
					items = append(items, item)
				}
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"rooms": items})
		case strings.HasSuffix(r.URL.Path, "/CreateRoom"):
			var input room
			_ = json.NewDecoder(r.Body).Decode(&input)
			f.created = append(f.created, input.Name)
			if f.failCreate != 1 {
				f.rooms[input.Name] = input
			}
			if f.failCreate == 3 {
				f.failCreate = 0
				w.Write([]byte(`{}`))
				return
			}
			if f.failCreate != 0 {
				f.failCreate = 0
				w.WriteHeader(503)
				return
			}
			_ = json.NewEncoder(w).Encode(input)
		case strings.HasSuffix(r.URL.Path, "/DeleteRoom"):
			var input struct{ Room string }
			_ = json.NewDecoder(r.Body).Decode(&input)
			delete(f.rooms, input.Room)
			w.Write([]byte(`{}`))
		default:
			t.Errorf("unexpected RPC %s", r.URL.Path)
			w.WriteHeader(500)
		}
	}))
	t.Cleanup(s.Close)
	f.config = Config{URL: s.URL, APIKey: "test-key", APISecret: "test-secret"}
	return f
}

func (f *ownerRoomFixture) router() *gin.Engine {
	r := gin.New()
	a := auth.Handler{Service: auth.Service{Secret: "test-session-secret"}}
	Register(r, f.config, a)
	Register(r.Group("/api/v1"), f.config, a)
	return r
}

func TestOneRoomPerOwnerAcrossConcurrentRequestsAndRoutes(t *testing.T) {
	f := newOwnerRoomFixture(t)
	routers := []*gin.Engine{f.router(), f.router()}
	token, _ := (auth.Service{Secret: "test-session-secret"}).Token("test-user")
	results := make(chan *httptest.ResponseRecorder, 8)
	for i := 0; i < 8; i++ {
		go func(i int) {
			prefix := ""
			if i%2 == 0 {
				prefix = "/api/v1"
			}
			req := httptest.NewRequest("POST", prefix+"/rooms", strings.NewReader(fmt.Sprintf(`{"id":"room-race-%d","title":"title-%d"}`, i, i)))
			req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: token})
			res := httptest.NewRecorder()
			routers[i%2].ServeHTTP(res, req)
			results <- res
		}(i)
	}
	created := 0
	for i := 0; i < 8; i++ {
		res := <-results
		if res.Code == 201 {
			created++
			continue
		}
		if res.Code != 409 || !strings.Contains(res.Body.String(), "room_already_exists") {
			t.Fatalf("unexpected race result: %d %s", res.Code, res.Body.String())
		}
	}
	if created != 1 || len(f.rooms) != 1 || len(f.created) != 1 {
		t.Fatal(created, f.created)
	}
	items := request(t, routers[0], "GET", "/rooms", "", 200)["items"].([]any)
	if len(items) != 1 || items[0].(map[string]any)["canManage"] != true {
		t.Fatal(items)
	}
	// Reconstructing the handler must not lose a reservation.
	request(t, f.router(), "POST", "/rooms", `{"title":"after restart"}`, 409)
}

func TestOwnerSlotReleasesAfterCloseOrExpiry(t *testing.T) {
	f := newOwnerRoomFixture(t)
	r := f.router()
	request(t, r, "POST", "/rooms", `{"id":"room-first","title":"first"}`, 201)
	request(t, r, "POST", "/rooms", `{"id":"room-other","title":"other"}`, 201, "other-user")
	conflict := request(t, r, "POST", "/rooms", `{"title":"blocked"}`, 409)
	if conflict["item"].(map[string]any)["id"] != "room-first" {
		t.Fatal(conflict)
	}
	request(t, r, "DELETE", "/rooms/room-first", "", 200)
	request(t, r, "POST", "/rooms", `{"id":"room-next","title":"next"}`, 201)
	f.Lock()
	delete(f.rooms, "room-next")
	f.Unlock()
	request(t, r, "POST", "/rooms", `{"id":"room-after-expiry","title":"after expiry"}`, 201)
	f.Lock()
	f.failList = true
	f.Unlock()
	request(t, r, "POST", "/rooms", `{"title":"during outage"}`, 502)
	f.Lock()
	f.failList = false
	f.Unlock()
	request(t, r, "POST", "/rooms", `{"title":"still blocked"}`, 409)
}

func TestUncertainCreationCannotAllocateASecondRoom(t *testing.T) {
	for _, mode := range []int{1, 2, 3} {
		t.Run(fmt.Sprint(mode), func(t *testing.T) {
			f := newOwnerRoomFixture(t)
			f.failCreate = mode
			r := f.router()
			request(t, r, "POST", "/rooms", `{"id":"room-reserved","title":"original"}`, 502)
			want := 201
			if mode != 1 {
				want = 409
			}
			result := request(t, f.router(), "POST", "/rooms", `{"id":"room-different","title":"different"}`, want)
			if result["item"].(map[string]any)["id"] != "room-reserved" || len(f.rooms) != 1 {
				t.Fatal(result, f.created)
			}
			for _, id := range f.created {
				if id != "room-reserved" {
					t.Fatal("retry changed reservation", f.created)
				}
			}
		})
	}
}

func TestLegacyDuplicateRoomsBlockFurtherCreation(t *testing.T) {
	f := newOwnerRoomFixture(t)
	f.globalStale = false
	for _, id := range []string{"room-old-a", "room-old-b"} {
		f.rooms[id] = room{Name: id, Metadata: `{"title":"existing","ownerId":"test-user"}`}
	}
	r := f.router()
	request(t, r, "POST", "/rooms", `{"title":"third"}`, 409)
	if len(f.rooms) != 2 {
		t.Fatal("existing rooms were changed")
	}
	request(t, r, "DELETE", "/rooms/room-old-a", "", 200)
	request(t, r, "POST", "/rooms", `{"title":"still blocked"}`, 409)
	request(t, r, "DELETE", "/rooms/room-old-b", "", 200)
	request(t, r, "POST", "/rooms", `{"title":"now allowed"}`, 201)
}

// Uses advisory locks and uniquely scoped Redis keys only; no application rows
// are written. Two pools/clients model separate API processes, each with a
// one-connection pool to catch nested-transaction deadlocks during close.
func TestOwnerRoomAcrossRedisClientsAndDatabaseLocks(t *testing.T) {
	dbURL, cacheURL := os.Getenv("TEST_DATABASE_URL"), os.Getenv("TEST_REDIS_URL")
	if dbURL == "" || cacheURL == "" {
		t.Skip("set TEST_DATABASE_URL and TEST_REDIS_URL for owner-room integration")
	}
	f := newOwnerRoomFixture(t)
	var routers []*gin.Engine
	var caches []*redis.Client
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
		caches = append(caches, cache)
		t.Cleanup(func() { _ = cache.Close() })
		r := gin.New()
		Register(r, f.config, auth.Handler{Service: auth.Service{Repo: auth.Repository{DB: db}, Secret: "test-session-secret"}}, cache)
		routers = append(routers, r)
	}
	t.Cleanup(func() {
		key := (Handler{Client: NewClient(f.config)}).ownerRoomKey("test-user")
		_ = caches[0].Del(context.Background(), key).Err()
	})
	responses := make(chan *httptest.ResponseRecorder, 2)
	token, _ := (auth.Service{Secret: "test-session-secret"}).Token("test-user")
	for i := 0; i < 2; i++ {
		go func(i int) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			req := httptest.NewRequest("POST", "/rooms", strings.NewReader(fmt.Sprintf(`{"id":"room-process-%d","title":"process-%d"}`, i, i))).WithContext(ctx)
			req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: token})
			res := httptest.NewRecorder()
			routers[i].ServeHTTP(res, req)
			responses <- res
		}(i)
	}
	created := ""
	for i := 0; i < 2; i++ {
		res := <-responses
		if res.Code == 201 {
			var result struct{ Item RoomItem }
			_ = json.Unmarshal(res.Body.Bytes(), &result)
			if created != "" {
				t.Fatal("both processes created a room")
			}
			created = result.Item.ID
		} else if res.Code != 409 {
			t.Fatal(res.Code, res.Body.String())
		}
	}
	if created == "" || len(f.created) != 1 {
		t.Fatal("missing single creation", f.created)
	}
	request(t, routers[1], "POST", "/rooms", `{"title":"another attempt"}`, 409)
	// Closing must fit in a single database connection.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req := httptest.NewRequest("DELETE", "/rooms/"+created, nil).WithContext(ctx)
	req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: token})
	res := httptest.NewRecorder()
	routers[0].ServeHTTP(res, req)
	if res.Code != 200 {
		t.Fatal(res.Code, res.Body.String())
	}
	request(t, routers[1], "POST", "/rooms", `{"title":"after close"}`, 201)
}
