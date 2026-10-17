package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

type socketClaims struct {
	jwt.RegisteredClaims
	Origin string `json:"origin"`
}

func (h Handler) socketKey() []byte {
	mac := hmac.New(sha256.New, []byte(h.Service.Secret))
	mac.Write([]byte("companion:private-socket:v1"))
	return mac.Sum(nil)
}

// SocketTicket runs after Require. Tickets authorize only the exact socket path;
// conversation access is still checked by the chat handler before upgrading.
func (h Handler) SocketTicket(origin string) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		if h.Service.Secret == "" || UserID(c) == "" {
			c.AbortWithStatus(http.StatusUnauthorized)
			return
		}
		if supplied := c.GetHeader("Origin"); supplied != "" && supplied != origin {
			c.AbortWithStatus(http.StatusForbidden)
			return
		}
		path := "/api/v1/matches/socket"
		if id := c.Param("id"); id != "" {
			path = "/api/v1/conversations/" + id + "/socket"
		}
		now := time.Now()
		claims := socketClaims{RegisteredClaims: jwt.RegisteredClaims{
			Issuer: "companion-private-socket", Subject: UserID(c), Audience: jwt.ClaimStrings{path},
			IssuedAt: jwt.NewNumericDate(now), NotBefore: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(time.Minute)),
		}, Origin: origin}
		ticket, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(h.socketKey())
		if err != nil {
			c.AbortWithStatus(http.StatusServiceUnavailable)
			return
		}
		c.JSON(http.StatusOK, gin.H{"ticket": ticket})
	}
}

// RequireSocket accepts either an ordinary session or a short-lived socket-only
// ticket. It is deliberately not installed on ordinary HTTP API routes.
func (h Handler) RequireSocket(origin string) gin.HandlerFunc {
	return func(c *gin.Context) {
		tickets, supplied := c.Request.URL.Query()["ticket"]
		if !supplied {
			h.Require(c)
			return
		}
		if h.Service.Secret == "" || len(tickets) != 1 || len(tickets[0]) > 2048 || c.GetHeader("Origin") != origin {
			c.AbortWithStatus(http.StatusUnauthorized)
			return
		}
		claims := &socketClaims{}
		_, err := jwt.ParseWithClaims(tickets[0], claims, func(_ *jwt.Token) (any, error) { return h.socketKey(), nil },
			jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer("companion-private-socket"),
			jwt.WithAudience(c.Request.URL.Path), jwt.WithExpirationRequired(), jwt.WithIssuedAt())
		if err != nil || claims.Subject == "" || claims.Origin != origin || claims.IssuedAt == nil || claims.ExpiresAt == nil || claims.ExpiresAt.Sub(claims.IssuedAt.Time) > time.Minute {
			c.AbortWithStatus(http.StatusUnauthorized)
			return
		}
		c.Set("userID", claims.Subject)
		c.Next()
	}
}
