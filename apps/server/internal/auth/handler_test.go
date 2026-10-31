package auth

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestOptionalAuthenticationPreservesAccountScope(t *testing.T) {
	h := Handler{Service: Service{VersionLookup: func(context.Context, string) (int64, error) { return 0, nil }, Secret: strings.Repeat("test-secret", 4)}}
	token, err := h.Service.Token("catalog-user")
	if err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	router.GET("/", h.Optional, func(c *gin.Context) { c.String(200, UserID(c)) })
	for _, tc := range []struct {
		name, cookie, bearer, want string
	}{
		{name: "guest"},
		{name: "invalid session", cookie: "invalid"},
		{name: "session", cookie: token, want: "catalog-user"},
		{name: "bearer", bearer: token, want: "catalog-user"},
		{name: "bearer overrides cookie", cookie: token, bearer: "invalid"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/", nil)
			if tc.cookie != "" {
				req.Header.Set("Cookie", CookieName+"="+tc.cookie)
			}
			if tc.bearer != "" {
				req.Header.Set("Authorization", "Bearer "+tc.bearer)
			}
			res := httptest.NewRecorder()
			router.ServeHTTP(res, req)
			if res.Code != 200 || res.Body.String() != tc.want {
				t.Fatalf("got %d %q, want 200 %q", res.Code, res.Body.String(), tc.want)
			}
		})
	}
}
