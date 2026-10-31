package auth

import (
	"context"
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

func TestPrivateSocketTicketScope(t *testing.T) {
	version := int64(0)
	h := Handler{Service: Service{VersionLookup: func(context.Context, string) (int64, error) { return version, nil }, Secret: "test-private-socket-secret"}}
	origin := "https://web.example"
	session, _ := h.Service.Token("alice")
	r := gin.New()
	r.POST("/api/v1/matches/socket-ticket", h.Require, h.SocketTicket(origin))
	for _, path := range []string{"/api/v1/matches/socket", "/api/v1/conversations/other/socket"} {
		r.GET(path, h.RequireSocket(origin), func(c *gin.Context) { c.String(200, UserID(c)) })
	}
	req := httptest.NewRequest("POST", "/api/v1/matches/socket-ticket", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != 401 {
		t.Fatalf("guest ticket issuance: %d", rec.Code)
	}
	req = httptest.NewRequest("POST", "/api/v1/matches/socket-ticket", nil)
	req.Header.Set("Cookie", CookieName+"="+session)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	var data struct {
		Ticket string `json:"ticket"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &data); err != nil || data.Ticket == "" {
		t.Fatalf("ticket issuance: %d %s", rec.Code, rec.Body)
	}
	if _, err := h.Service.Verify(data.Ticket); err == nil {
		t.Fatal("socket ticket accepted as login session")
	}
	expired, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, socketClaims{RegisteredClaims: jwt.RegisteredClaims{
		Issuer: "companion-private-socket", Subject: "alice", Audience: jwt.ClaimStrings{"/api/v1/matches/socket"},
		IssuedAt: jwt.NewNumericDate(time.Now().Add(-2 * time.Minute)), ExpiresAt: jwt.NewNumericDate(time.Now().Add(-time.Minute)),
	}, Origin: origin}).SignedString(h.socketKey())
	for _, tc := range []struct {
		name, path, ticket, origin string
		want                       int
	}{
		{"valid", "/api/v1/matches/socket", data.Ticket, origin, 200},
		{"wrong path", "/api/v1/conversations/other/socket", data.Ticket, origin, 401},
		{"wrong origin", "/api/v1/matches/socket", data.Ticket, "https://evil.example", 401},
		{"expired", "/api/v1/matches/socket", expired, origin, 401},
		{"session not ticket", "/api/v1/matches/socket", session, origin, 401},
		{"tampered", "/api/v1/matches/socket", data.Ticket + "x", origin, 401},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", tc.path+"?ticket="+url.QueryEscape(tc.ticket), nil)
			req.Header.Set("Origin", tc.origin)
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)
			if rec.Code != tc.want {
				t.Fatalf("got %d want %d", rec.Code, tc.want)
			}
			if tc.want == 200 && rec.Body.String() != "alice" {
				t.Fatal("lost account scope")
			}
		})
	}
	version++
	req = httptest.NewRequest("GET", "/api/v1/matches/socket?ticket="+url.QueryEscape(data.Ticket), nil)
	req.Header.Set("Origin", origin)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != 401 {
		t.Fatalf("revoked ticket accepted: %d", rec.Code)
	}
}
