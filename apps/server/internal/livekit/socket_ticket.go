package livekit

import (
	"crypto/hmac"
	"crypto/sha256"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

const RoomSocketTicketPath = "/api/v1/rooms/socket-ticket"

const (
	roomSocketTicketLifetime = time.Minute
	roomSocketTicketLimit    = 2048
	roomSocketTicketIssuer   = "companion-rooms-socket"
)

type roomSocketTicketClaims struct {
	jwt.RegisteredClaims
	RoomID string `json:"roomId"`
	Origin string `json:"origin"`
}

// Derive a separate signing key: even an authenticated user's read-only socket
// ticket must never verify as an application session or a LiveKit credential.
func (h Handler) roomSocketTicketKey() []byte {
	mac := hmac.New(sha256.New, []byte(h.Auth.Service.Secret))
	_, _ = mac.Write([]byte("companion:rooms-socket-ticket:v1"))
	return mac.Sum(nil)
}

func (h Handler) signRoomSocketTicket(userID, room, origin string) (string, error) {
	if h.Auth.Service.Secret == "" {
		return "", errors.New("socket ticket signing unavailable")
	}
	now := h.clock()
	claims := roomSocketTicketClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer: roomSocketTicketIssuer, Subject: userID,
			Audience: jwt.ClaimStrings{RoomSocketPath},
			IssuedAt: jwt.NewNumericDate(now), NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(roomSocketTicketLifetime)),
		},
		RoomID: room, Origin: origin,
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(h.roomSocketTicketKey())
}

func (h Handler) verifyRoomSocketTicket(raw, room, origin string) (string, error) {
	if h.Auth.Service.Secret == "" || len(raw) == 0 || len(raw) > roomSocketTicketLimit {
		return "", errors.New("invalid socket ticket")
	}
	claims := &roomSocketTicketClaims{}
	_, err := jwt.ParseWithClaims(raw, claims, func(_ *jwt.Token) (any, error) { return h.roomSocketTicketKey(), nil },
		jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer(roomSocketTicketIssuer),
		jwt.WithAudience(RoomSocketPath), jwt.WithExpirationRequired(), jwt.WithIssuedAt(), jwt.WithTimeFunc(h.clock))
	if err != nil || claims.RoomID != room || claims.Origin != origin ||
		claims.IssuedAt == nil || claims.ExpiresAt == nil || claims.ExpiresAt.Sub(claims.IssuedAt.Time) > roomSocketTicketLifetime {
		return "", errors.New("invalid socket ticket")
	}
	return claims.Subject, nil // Empty subject is an explicitly signed guest.
}

func (h Handler) roomSocketTicket(origin string) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		if !h.Client.config.Enabled() || h.Auth.Service.Secret == "" {
			fail(c, http.StatusServiceUnavailable, "Live room connections are unavailable")
			return
		}
		id := c.Query("roomId")
		if id != "" && !roomID.MatchString(id) {
			fail(c, http.StatusBadRequest, "Invalid room id")
			return
		}
		// The same-origin Next.js bootstrap has no Origin header when forwarding
		// server-side; browsers that send one must match the configured website.
		if supplied := c.GetHeader("Origin"); supplied != "" && supplied != origin {
			fail(c, http.StatusForbidden, "Invalid origin")
			return
		}
		userID, err := h.sessionUser(c)
		if err != nil {
			fail(c, http.StatusUnauthorized, "登录已失效，请重新登录")
			return
		}
		if !h.allowRate(c, "ip", c.ClientIP(), h.limit("ip_total")) || !h.allowAccountRate(c, "socket", userID) {
			return
		}
		// HTTP bootstrap makes lease-limit Retry-After observable to browsers,
		// whose WebSocket API cannot read a rejected upgrade response.
		lease, ok := h.acquireRoomLease(c, userID)
		if !ok {
			return
		}
		lease.release()
		ticket, err := h.signRoomSocketTicket(userID, id, origin)
		if err != nil {
			fail(c, http.StatusServiceUnavailable, "Live room connections are unavailable")
			return
		}
		c.JSON(http.StatusOK, gin.H{"ticket": ticket})
	}
}
