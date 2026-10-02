package livekit

import (
	"companion/server/internal/auth"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

func request(t *testing.T, router http.Handler, method, path, body string, status int) map[string]any {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	token, err := (auth.Service{Secret: "test-session-secret"}).Token("test-user")
	if err != nil {
		t.Fatal(err)
	}
	req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: token})
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)
	if res.Code != status {
		t.Fatalf("%s %s: got %d, want %d: %s", method, path, res.Code, status, res.Body.String())
	}
	var result map[string]any
	if err := json.Unmarshal(res.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result
}
func claims(t *testing.T, raw string) jwt.MapClaims {
	t.Helper()
	token, err := jwt.Parse(raw, func(_ *jwt.Token) (any, error) { return []byte("test-secret"), nil }, jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer("test-key"), jwt.WithExpirationRequired())
	if err != nil {
		t.Fatal(err)
	}
	return token.Claims.(jwt.MapClaims)
}
func TestRoomLifecycleAndDispatchContract(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var seen []string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.Header.Get("Content-Type") != "application/json" {
			t.Error("invalid Twirp request")
		}
		token := claims(t, strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
		grant := token["video"].(map[string]any)
		var input map[string]any
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			t.Error(err)
		}
		method := r.URL.Path[strings.LastIndex(r.URL.Path, "/")+1:]
		seen = append(seen, method)
		permission := "roomAdmin"
		service := "AgentDispatchService"
		switch method {
		case "ListRooms":
			permission = "roomList"
			service = "RoomService"
		case "CreateRoom", "DeleteRoom":
			permission = "roomCreate"
			service = "RoomService"
		}
		if r.URL.Path != "/twirp/livekit."+service+"/"+method {
			t.Error("wrong RPC service")
		}
		if len(grant) != 1 && permission != "roomAdmin" {
			t.Errorf("excessive grants: %v", grant)
		}
		if grant[permission] != true {
			t.Errorf("missing %s grant: %v", permission, grant)
		}
		if permission == "roomAdmin" && grant["room"] != "room-test" {
			t.Error("dispatch grant must be scoped to room")
		}
		w.Header().Set("Content-Type", "application/json")
		var result any = map[string]any{}
		switch method {
		case "ListRooms":
			result = map[string]any{"rooms": []any{
				map[string]any{"name": "room-test", "metadata": `{"title":"直播测试"}`, "num_participants": 2, "num_publishers": 1},
				map[string]any{"name": "room-empty", "metadata": "invalid"},
				map[string]any{"name": "room-camel", "numParticipants": 3},
			}}
		case "CreateRoom":
			if input["maxParticipants"] != float64(50) || input["emptyTimeout"] != float64(600) {
				t.Error("room defaults changed")
			}
			result = input
		case "DeleteRoom":
			if input["room"] != "room-test" {
				t.Error("wrong room")
			}
		case "CreateDispatch":
			if input["agentName"] != "test-agent" || input["room"] != "room-test" {
				t.Errorf("wrong dispatch: %v", input)
			}
			result = map[string]any{"id": "AD_test", "room": input["room"], "agent_name": input["agentName"], "metadata": input["metadata"]}
		case "ListDispatch":
			result = map[string]any{"agent_dispatches": []any{map[string]any{"id": "AD_test", "room": "room-test", "agent_name": "test-agent"}}}
		case "DeleteDispatch":
			if input["dispatchId"] != "AD_test" || input["room"] != "room-test" {
				t.Error("wrong dispatch deletion")
			}
		default:
			t.Errorf("unexpected method %s", method)
		}
		json.NewEncoder(w).Encode(result)
	}))
	defer upstream.Close()
	router := gin.New()
	Register(router, Config{URL: "wss://public.example.com", InternalURL: upstream.URL, APIKey: "test-key", APISecret: "test-secret", AgentName: "test-agent"}, auth.Handler{Service: auth.Service{Secret: "test-session-secret"}})
	result := request(t, router, "GET", "/rooms", "", 200)
	items := result["items"].([]any)
	if len(items) != 3 || items[0].(map[string]any)["title"] != "直播测试" || items[0].(map[string]any)["status"] != "直播中" || items[0].(map[string]any)["viewers"] != float64(2) {
		t.Fatalf("wrong rooms: %v", items)
	}
	if items[1].(map[string]any)["title"] != "room-empty" || items[1].(map[string]any)["status"] != "准备中" || items[2].(map[string]any)["viewers"] != float64(3) {
		t.Fatal(items)
	}
	created := request(t, router, "POST", "/rooms", `{"id":"room-test","title":"直播测试"}`, 201)["item"].(map[string]any)
	if created["id"] != "room-test" || created["title"] != "直播测试" {
		t.Fatal(created)
	}
	generated := request(t, router, "POST", "/rooms", `{}`, 201)["item"].(map[string]any)
	if !roomID.MatchString(generated["id"].(string)) || generated["title"] != "未命名直播间" {
		t.Fatal(generated)
	}
	for _, body := range []string{`{"identity":" user-1 ","name":" 测试 "}`, `{"identity":"user-1"}`} {
		joined := request(t, router, "POST", "/rooms/room-test/join", body, 201)
		if joined["livekitUrl"] != "wss://public.example.com" || !strings.HasPrefix(joined["identity"].(string), "host_test-user_") || joined["roomId"] != "room-test" {
			t.Fatal(joined)
		}
		token := claims(t, joined["token"].(string))
		if token["sub"] != joined["identity"] || (token["name"] != "测试" && token["name"] != joined["identity"]) {
			t.Fatal(token)
		}
		if token["exp"].(float64)-token["iat"].(float64) != 7200 {
			t.Fatal("token TTL changed")
		}
		grant := token["video"].(map[string]any)
		if len(grant) != 5 || grant["room"] != "room-test" || grant["roomJoin"] != true || grant["canPublish"] != true || grant["canSubscribe"] != true || grant["canPublishData"] != true {
			t.Fatal(grant)
		}
	}
	for _, body := range []string{`{}`, `{"agentName":" test-agent ","metadata":{"language":"中文","count":1}}`} {
		item := request(t, router, "POST", "/rooms/room-test/agent/dispatch", body, 201)["item"].(map[string]any)
		if item["id"] != "AD_test" || item["agentName"] != "test-agent" || item["room"] != "room-test" {
			t.Fatal(item)
		}
		if strings.Contains(body, "metadata") && !strings.Contains(item["metadata"].(string), "中文") {
			t.Fatal("metadata lost")
		}
	}
	dispatches := request(t, router, "GET", "/rooms/room-test/agent/dispatch", "", 200)["items"].([]any)
	if len(dispatches) != 1 || dispatches[0].(map[string]any)["agentName"] != "test-agent" {
		t.Fatal(dispatches)
	}
	request(t, router, "DELETE", "/rooms/room-test/agent/dispatch/AD_test", "", 200)
	request(t, router, "DELETE", "/rooms/room-test", "", 200)
	if len(seen) != 10 {
		t.Fatalf("missing calls: %v", seen)
	}
}
func TestRejectInvalidRequestsBeforeUpstream(t *testing.T) {
	router := gin.New()
	Register(router, Config{URL: "ws://127.0.0.1:1", APIKey: "test-key", APISecret: "test-secret"}, auth.Handler{Service: auth.Service{Secret: "test-session-secret"}})
	cases := []struct{ method, path, body string }{
		{"POST", "/rooms", `null`}, {"POST", "/rooms", `[]`}, {"POST", "/rooms", `{`}, {"POST", "/rooms", `{} {}`}, {"POST", "/rooms", ``},
		{"POST", "/rooms", `{"id":null}`}, {"POST", "/rooms", `{"id":"ab"}`}, {"POST", "/rooms", `{"id":"room/test"}`}, {"POST", "/rooms", `{"title":false}`}, {"POST", "/rooms", `{"title":""}`},
		{"POST", "/rooms", `{"title":"` + strings.Repeat("😀", 51) + `"}`},

		{"POST", "/rooms/room-test/join", `{"identity":"valid","name":null}`}, {"POST", "/rooms/room-test/join", `{"identity":"valid","name":" "}`},
		{"POST", "/rooms/room-test/agent/dispatch", `{"agentName":" "}`}, {"POST", "/rooms/room-test/agent/dispatch", `{"metadata":[]}`}, {"POST", "/rooms/room-test/agent/dispatch", `{"metadata":null}`},
		{"DELETE", "/rooms/room-test/agent/dispatch/%20", ""},
		{"DELETE", "/rooms/ab", ""}, {"POST", "/rooms/a!/join", `{"identity":"valid"}`}, {"GET", "/rooms/ab/agent/dispatch", ""},
	}
	for _, tc := range cases {
		t.Run(tc.method+tc.path+tc.body, func(t *testing.T) { request(t, router, tc.method, tc.path, tc.body, 400) })
	}
}
func TestUnavailableAndEmptyResponses(t *testing.T) {
	router := gin.New()
	Register(router, Config{}, auth.Handler{})
	request(t, router, "GET", "/rooms", "", 503)
	for _, reply := range []struct {
		body       string
		code, want int
	}{{`{}`, 200, 200}, {`{"secret":"do not leak"}`, 500, 502}, {`invalid`, 200, 502}} {
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(reply.code); w.Write([]byte(reply.body)) }))
		r := gin.New()
		Register(r, Config{URL: upstream.URL, APIKey: "test-key", APISecret: "test-secret"}, auth.Handler{Service: auth.Service{Secret: "test-session-secret"}})
		for _, path := range []string{"/rooms", "/rooms/room-test/agent/dispatch"} {
			result := request(t, r, "GET", path, "", reply.want)
			if reply.want == 200 {
				if list, ok := result["items"].([]any); !ok || len(list) != 0 {
					t.Fatal(result)
				}
			}
			if message, _ := result["message"].(string); strings.Contains(message, "do not leak") {
				t.Fatal("secret leaked")
			}
		}
		upstream.Close()
	}
}

func TestGuestTokensAndManagementAuthorization(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/twirp/livekit.RoomService/ListRooms" {
			t.Errorf("unexpected RPC: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"rooms":[{"name":"room-test"}]}`))
	}))
	defer upstream.Close()
	router := gin.New()
	Register(router, Config{URL: upstream.URL, APIKey: "test-key", APISecret: "test-secret"}, auth.Handler{Service: auth.Service{Secret: "test-session-secret"}})
	call := func(method, path, body, cookie string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if cookie != "" {
			req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: cookie})
		}
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		return res
	}
	guest := call("POST", "/rooms/room-test/join", `{"identity":"host_forged","name":"游客"}`, "")
	if guest.Code != 201 {
		t.Fatal(guest.Body.String())
	}
	var result struct{ Token, Identity string }
	if err := json.Unmarshal(guest.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	token := claims(t, result.Token)
	grant := token["video"].(map[string]any)
	if !strings.HasPrefix(result.Identity, "viewer_") || token["sub"] != result.Identity || grant["canPublish"] != false || grant["canPublishData"] != false || grant["canSubscribe"] != true {
		t.Fatal("guest can impersonate or publish", token)
	}
	for _, tc := range []struct{ method, path string }{
		{"POST", "/rooms"}, {"DELETE", "/rooms/room-test"}, {"POST", "/rooms/room-test/agent/dispatch"}, {"GET", "/rooms/room-test/agent/dispatch"}, {"DELETE", "/rooms/room-test/agent/dispatch/AD_test"},
	} {
		if res := call(tc.method, tc.path, `{}`, ""); res.Code != 401 {
			t.Fatalf("unauthenticated %s %s: %d", tc.method, tc.path, res.Code)
		}
	}
	if res := call("POST", "/rooms/room-test/join", `{}`, "invalid"); res.Code != 401 {
		t.Fatal("invalid session accepted")
	}
	if res := call("POST", "/rooms/missing-room/join", `{}`, ""); res.Code != 404 {
		t.Fatalf("missing room accepted: %d", res.Code)
	}
}
