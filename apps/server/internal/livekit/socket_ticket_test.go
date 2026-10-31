package livekit

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"companion/server/internal/auth"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

func socketTicketHandler() Handler {
	return Handler{Client: NewClient(Config{URL: "ws://unused", APIKey: "key", APISecret: "secret"}),
		Auth: auth.Handler{Service: auth.Service{VersionLookup: func(context.Context, string) (int64, error) { return 0, nil }, Secret: "socket-test-secret"}}}
}

func TestSocketTicketsAuthenticateDirectConnectionWithoutCookies(t *testing.T) {
	f, server := roomSocketFixture(t)
	f.detail = &RoomSnapshot{Item: f.items[0], State: "open"}
	for _, user := range []string{"", "owner", "someone-else"} {
		for _, scope := range []string{"", "room-owner"} {
			t.Run(user+"/"+scope, func(t *testing.T) {
				query := "?roomId=" + url.QueryEscape(scope) + "&userId=owner"
				req, err := http.NewRequest(http.MethodPost, server.URL+RoomSocketTicketPath+query, nil)
				if err != nil {
					t.Fatal(err)
				}
				if user != "" {
					token, err := socketTicketHandler().Auth.Service.Token(user)
					if err != nil {
						t.Fatal(err)
					}
					if scope == "" {
						req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: token})
					} else {
						req.Header.Set("Authorization", "Bearer "+token)
					}
				}
				res, err := server.Client().Do(req)
				if err != nil {
					t.Fatal(err)
				}
				defer res.Body.Close()
				if res.StatusCode != http.StatusOK || res.Header.Get("Cache-Control") != "no-store" {
					t.Fatal("ticket response must be private and uncached", res.StatusCode, res.Header)
				}
				var body struct{ Ticket string }
				if err := json.NewDecoder(res.Body).Decode(&body); err != nil || body.Ticket == "" {
					t.Fatal("missing ticket", err)
				}
				claims := &roomSocketTicketClaims{}
				if _, _, err := jwt.NewParser().ParseUnverified(body.Ticket, claims); err != nil ||
					claims.ExpiresAt.Sub(claims.IssuedAt.Time) != time.Minute || claims.Subject != user || claims.RoomID != scope {
					t.Fatal("incorrect ticket scope or lifetime", err)
				}
				// No account cookie reaches this connection: the short ticket alone
				// conveys the identity verified by the same-origin bootstrap.
				ws, err := dialRoomSocket(t, server, "", query+"&ticket="+url.QueryEscape(body.Ticket), "http://web")
				if err != nil {
					t.Fatal(err)
				}
				event := socketEvent(t, ws)
				if scope == "" {
					var items []RoomItem
					if err := json.Unmarshal(event["items"], &items); err != nil || len(items) != 1 || items[0].CanManage != (user == "owner") {
						t.Fatal("lobby permissions lost", err, string(event["items"]))
					}
				} else {
					var detail RoomSnapshot
					if err := json.Unmarshal(event["detail"], &detail); err != nil || detail.Item.CanManage != (user == "owner") {
						t.Fatal("room permissions lost", err, string(event["detail"]))
					}
				}
				_ = ws.Close()
				select {
				case <-f.closed:
				case <-time.After(time.Second):
					t.Fatal("ticket connection leaked subscription")
				}
			})
		}
	}
}

func TestSocketTicketRejectsReplayOutsideScopeAndInvalidCredentials(t *testing.T) {
	h := socketTicketHandler()
	valid, err := h.signRoomSocketTicket("owner", "room-owner", "http://web")
	if err != nil {
		t.Fatal(err)
	}
	past := h
	past.now = func() time.Time { return time.Now().Add(-2 * time.Minute) }
	expired, _ := past.signRoomSocketTicket("owner", "room-owner", "http://web")
	parts := strings.Split(valid, ".")
	parts[1] = "e30" // Change the signed claims without knowing the derived key.
	tampered := strings.Join(parts, ".")
	login, _ := h.Auth.Service.Token("owner")
	if _, err := h.Auth.Service.Verify(valid); err == nil {
		t.Fatal("read-only socket ticket authenticated as a login session")
	}
	if _, err := h.verifyRoomSocketTicket(login, "room-owner", "http://web"); err == nil {
		t.Fatal("account session accepted as a socket ticket")
	}
	claims := &roomSocketTicketClaims{}
	_, _, _ = jwt.NewParser().ParseUnverified(valid, claims)
	wrongKey, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(h.Auth.Service.Secret))
	if _, err := h.verifyRoomSocketTicket(wrongKey, "room-owner", "http://web"); err == nil {
		t.Fatal("ticket used the login session key instead of the derived key")
	}
	router := gin.New()
	router.GET(RoomSocketPath, h.roomSocket(nil, "http://web"))
	for _, tc := range []struct{ name, ticket, room, origin, extra string }{
		{"expired", expired, "room-owner", "http://web", ""},
		{"tampered", tampered, "room-owner", "http://web", ""},
		{"login-token", login, "room-owner", "http://web", ""},
		{"wrong-key", wrongKey, "room-owner", "http://web", ""},
		{"different-room", valid, "room-other", "http://web", ""},
		{"lobby-replay", valid, "", "http://web", ""},
		{"wrong-origin", valid, "room-owner", "http://evil", ""},
		{"missing-origin", valid, "room-owner", "", ""},
		{"empty", "", "room-owner", "http://web", ""},
		{"too-long", strings.Repeat("x", roomSocketTicketLimit+1), "room-owner", "http://web", ""},
		{"duplicate", valid, "room-owner", "http://web", "&ticket=" + url.QueryEscape(valid)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, RoomSocketPath+"?roomId="+tc.room+"&ticket="+url.QueryEscape(tc.ticket)+tc.extra, nil)
			req.Header.Set("Origin", tc.origin)
			// A bad supplied ticket must not silently fall back to this valid
			// account cookie, nor connect as a guest.
			req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: login})
			res := httptest.NewRecorder()
			router.ServeHTTP(res, req)
			if res.Code != http.StatusUnauthorized {
				t.Fatalf("got %d, want 401", res.Code)
			}
		})
	}
}

func TestSocketTicketEndpointRejectsInvalidSessionOriginAndRoom(t *testing.T) {
	h := socketTicketHandler()
	router := gin.New()
	router.POST(RoomSocketTicketPath, h.roomSocketTicket("http://web"))
	for _, tc := range []struct {
		name, query, cookie, origin string
		status                      int
	}{
		{"invalid-session", "", "invalid", "", 401},
		{"invalid-room", "?roomId=..%2Fprivate", "", "", 400},
		{"wrong-origin", "", "", "http://evil", 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, RoomSocketTicketPath+tc.query, nil)
			req.Header.Set("Origin", tc.origin)
			if tc.cookie != "" {
				req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: tc.cookie})
			}
			res := httptest.NewRecorder()
			router.ServeHTTP(res, req)
			if res.Code != tc.status || strings.Contains(res.Body.String(), `"ticket"`) {
				t.Fatal(res.Code, res.Body.String())
			}
		})
	}
	disabled := gin.New()
	RegisterRealtime(disabled, Config{}, h.Auth, nil, "http://web")
	res := httptest.NewRecorder()
	disabled.ServeHTTP(res, httptest.NewRequest(http.MethodPost, RoomSocketTicketPath, nil))
	if res.Code != http.StatusServiceUnavailable {
		t.Fatal(res.Code)
	}
}
