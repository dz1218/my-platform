package httpapi

import (
	"companion/server/internal/delivery"
	"github.com/gin-gonic/gin"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCompanionInternalEndpointsRequireServiceToken(t *testing.T) {
	for _, configured := range []string{"", strings.Repeat("s", 32)} {
		r := gin.New()
		agentRoutes(r, configured, delivery.Repository{})
		for _, path := range []string{"/internal/companion/validate", "/internal/companion/search"} {
			for _, token := range []string{"", "Bearer ", "Bearer forged-user-token"} {
				req := httptest.NewRequest("POST", path, strings.NewReader(`{}`))
				req.Header.Set("Authorization", token)
				res := httptest.NewRecorder()
				r.ServeHTTP(res, req)
				if res.Code != 401 {
					t.Fatalf("%s accepted user credential: %d", path, res.Code)
				}
			}
		}
	}
}
