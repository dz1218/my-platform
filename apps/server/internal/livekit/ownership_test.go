package livekit

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"companion/server/internal/auth"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

func TestRoomCreatorOwnsHostRoleAndManagement(t *testing.T) {
	var createdOwner string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(r.URL.Path, "/ListRooms"):
			json.NewEncoder(w).Encode(map[string]any{"rooms": []room{
				{Name: "room-owned", Metadata: `{"title":"房主的直播","ownerId":"creator"}`},
				{Name: "room-legacy", Metadata: `{"title":"旧直播间"}`},
			}})
		case strings.HasSuffix(r.URL.Path, "/CreateRoom"):
			var input room
			if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
				t.Error(err)
			}
			createdOwner = input.item().OwnerID
			json.NewEncoder(w).Encode(input)
		case strings.HasSuffix(r.URL.Path, "/DeleteRoom"):
			w.Write([]byte(`{}`))
		default:
			t.Errorf("unexpected upstream request: %s", r.URL.Path)
			w.WriteHeader(500)
		}
	}))
	defer upstream.Close()
	service := auth.Service{Secret: "ownership-test-session"}
	cfg := Config{URL: upstream.URL, APIKey: "test-key", APISecret: "test-secret"}
	router := gin.New()
	Register(router, cfg, auth.Handler{Service: service})
	call := func(user, method, path, body string, want int) map[string]any {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		if user != "" {
			token, _ := service.Token(user)
			req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: token})
		}
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		if res.Code != want {
			t.Fatalf("%s %s as %s: %d, want %d: %s", method, path, user, res.Code, want, res.Body.String())
		}
		var result map[string]any
		if err := json.Unmarshal(res.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	for _, user := range []string{"creator", "another-account", ""} {
		joined := call(user, "POST", "/rooms/room-owned/join", `{"name":"测试","role":"host","identity":"host_creator_forged"}`, 201)
		isHost := user == "creator"
		role := "viewer"
		if isHost {
			role = "host"
		}
		if joined["role"] != role || strings.HasPrefix(joined["identity"].(string), "host_") != isHost {
			t.Fatal(joined)
		}
		grant := claims(t, joined["token"].(string))["video"].(map[string]any)
		if grant["canPublish"] != isHost {
			t.Fatal("login alone granted publishing rights", grant)
		}
		var voice voiceClaims
		_, err := jwt.ParseWithClaims(joined["voiceToken"].(string), &voice, func(_ *jwt.Token) (any, error) { return []byte(cfg.APISecret), nil })
		if err != nil || voice.Role != role {
			t.Fatal(voice, err)
		}
		listed := call(user, "GET", "/rooms", "", 200)["items"].([]any)
		if listed[0].(map[string]any)["canManage"] != isHost {
			t.Fatal(listed)
		}
		if _, leaked := listed[0].(map[string]any)["ownerId"]; leaked {
			t.Fatal("raw owner ID exposed")
		}
	}
	for _, path := range []string{"/rooms/room-owned", "/rooms/room-owned/agent/dispatch/AD_test"} {
		call("another-account", "DELETE", path, "", 403)
	}
	call("another-account", "POST", "/rooms/room-owned/agent/dispatch", `{}`, 403)
	call("another-account", "GET", "/rooms/room-owned/agent/dispatch", "", 403)
	call("creator", "DELETE", "/rooms/room-owned", "", 200)
	created := call("another-account", "POST", "/rooms", `{"title":"新直播","ownerId":"creator"}`, 201)["item"].(map[string]any)
	if createdOwner != "another-account" || created["canManage"] != true {
		t.Fatal("client assigned room ownership", createdOwner, created)
	}
	legacy := call("creator", "POST", "/rooms/room-legacy/join", `{}`, 201)
	if legacy["role"] != "viewer" || legacy["notice"] == "" {
		t.Fatal("legacy room silently claimed", legacy)
	}
	call("creator", "DELETE", "/rooms/room-legacy", "", 403)
}

// LiveKit Cloud can omit a just-created room from the global listing while a
// query for its exact name already returns the room and its ownership metadata.
func TestCreatorCanJoinBeforeGlobalRoomListCatchesUp(t *testing.T) {
	var created *room
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(r.URL.Path, "/CreateRoom"):
			created = &room{}
			if err := json.NewDecoder(r.Body).Decode(created); err != nil {
				t.Error(err)
			}
			json.NewEncoder(w).Encode(created)
		case strings.HasSuffix(r.URL.Path, "/ListRooms"):
			var input struct{ Names []string }
			if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
				t.Error(err)
			}
			items := []room{}
			if created != nil && len(input.Names) == 1 && input.Names[0] == created.Name {
				items = append(items, *created)
			}
			json.NewEncoder(w).Encode(map[string]any{"rooms": items})
		case strings.HasSuffix(r.URL.Path, "/DeleteRoom"):
			created = nil
			w.Write([]byte(`{}`))
		default:
			t.Errorf("unexpected upstream request: %s", r.URL.Path)
			w.WriteHeader(500)
		}
	}))
	defer upstream.Close()
	router := gin.New()
	Register(router, Config{URL: upstream.URL, APIKey: "test-key", APISecret: "test-secret"}, auth.Handler{Service: auth.Service{Secret: "test-session-secret"}})
	request(t, router, "POST", "/rooms", `{"id":"room-new","title":"刚创建的房间"}`, 201)
	listed := request(t, router, "GET", "/rooms", "", 200)["items"].([]any)
	if len(listed) != 1 || listed[0].(map[string]any)["id"] != "room-new" {
		t.Fatal("owner's room should remain visible despite a stale global list", listed)
	}
	joined := request(t, router, "POST", "/rooms/room-new/join", `{}`, 201)
	if joined["role"] != "host" || claims(t, joined["token"].(string))["video"].(map[string]any)["canPublish"] != true {
		t.Fatal("creator was not recognized before global list caught up", joined["role"])
	}
	guest := httptest.NewRecorder()
	router.ServeHTTP(guest, httptest.NewRequest("POST", "/rooms/room-new/join", strings.NewReader(`{}`)))
	var guestJoined struct{ Role string }
	if guest.Code != 201 || json.Unmarshal(guest.Body.Bytes(), &guestJoined) != nil || guestJoined.Role != "viewer" {
		t.Fatal("guest received an incorrect room role", guest.Code, guestJoined.Role)
	}
	request(t, router, "POST", "/rooms/room-other/join", `{}`, 404)
	request(t, router, "DELETE", "/rooms/room-new", "", 200)
	request(t, router, "POST", "/rooms/room-new/join", `{}`, 404)
}
