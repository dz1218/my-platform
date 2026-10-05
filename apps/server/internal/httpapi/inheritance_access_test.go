package httpapi

import (
	"net/http/httptest"
	"strings"
	"testing"

	"companion/server/internal/behavior"
	"companion/server/internal/config"
)

func TestInheritanceRoutesRequireAuthenticatedAccount(t *testing.T) {
	router := New(config.Config{JWTSecret: strings.Repeat("test-secret", 4), WebOrigin: "http://localhost:3011"}, nil, nil, behavior.Catalog{})
	for _, request := range []struct {
		method string
		path   string
		body   string
	}{
		{"GET", "/identity-inheritance", ""},
		{"POST", "/identity-inheritance", `{"identityId":"identity_chennian","userId":"another-account"}`},
		{"POST", "/identity-inheritance/skip", `{}`},
		{"POST", "/identity-inheritance/gender", `{"gender":"FEMALE"}`},
	} {
		t.Run(request.method+request.path, func(t *testing.T) {
			for _, token := range []string{"", "forged-session"} {
				req := httptest.NewRequest(request.method, "/api/v1"+request.path, strings.NewReader(request.body))
				req.Header.Set("Content-Type", "application/json")
				if token != "" {
					req.Header.Set("Authorization", "Bearer "+token)
				}
				res := httptest.NewRecorder()
				router.ServeHTTP(res, req)
				if res.Code != 401 {
					t.Fatalf("inheritance route accepted an unauthenticated account: %d %s", res.Code, res.Body.String())
				}
			}
		})
	}
}
