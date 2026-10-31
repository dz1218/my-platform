package livekit

import (
	"companion/server/internal/auth"
	"context"
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
	Member  *liveRoomClaims `json:"member,omitempty"`
	RoomID  string          `json:"roomId"`
	Origin  string          `json:"origin"`
	Version int64           `json:"sv"`
}

// Derive a separate signing key: even an authenticated user's read-only socket
// ticket must never verify as an application session or a LiveKit credential.
func (h Handler) roomSocketTicketKey() []byte {
	mac := hmac.New(sha256.New, []byte(h.Auth.Service.Secret))
	_, _ = mac.Write([]byte("companion:rooms-socket-ticket:v1"))
	return mac.Sum(nil)
}

func (h Handler) signRoomSocketTicket(userID, room, origin string, versions ...int64) (string, error) {
	if h.Auth.Service.Secret == "" {
		return "", errors.New("socket ticket signing unavailable")
	}
	version := int64(0)
	if len(versions) > 0 {
		version = versions[0]
	}
	now := h.clock()
	claims := roomSocketTicketClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer: roomSocketTicketIssuer, Subject: userID,
			Audience: jwt.ClaimStrings{RoomSocketPath},
			IssuedAt: jwt.NewNumericDate(now), NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(roomSocketTicketLifetime)),
		},
		RoomID: room, Origin: origin, Version: version,
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(h.roomSocketTicketKey())
}

func (h Handler) verifyRoomSocketTicket(raw, room, origin string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	session, err := h.verifyRoomSocketSession(ctx, raw, room, origin)
	return session.UserID, err
}

func (h Handler) verifyRoomSocketSession(ctx context.Context, raw, room, origin string) (auth.Session, error) {
	if h.Auth.Service.Secret == "" || len(raw) == 0 || len(raw) > roomSocketTicketLimit {
		return auth.Session{}, errors.New("invalid socket ticket")
	}
	claims := &roomSocketTicketClaims{}
	_, err := jwt.ParseWithClaims(raw, claims, func(_ *jwt.Token) (any, error) { return h.roomSocketTicketKey(), nil },
		jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer(roomSocketTicketIssuer),
		jwt.WithAudience(RoomSocketPath), jwt.WithExpirationRequired(), jwt.WithIssuedAt(), jwt.WithTimeFunc(h.clock))
	if err != nil || claims.RoomID != room || claims.Origin != origin ||
		claims.IssuedAt == nil || claims.ExpiresAt == nil || claims.ExpiresAt.Sub(claims.IssuedAt.Time) > roomSocketTicketLifetime {
		return auth.Session{}, errors.New("invalid socket ticket")
	}
	session := auth.Session{UserID: claims.Subject, Version: claims.Version}
	if session.UserID != "" {
		return session, h.Auth.Service.CheckSession(ctx, session)
	}
	return session, nil // Empty subject is an explicitly signed guest.
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
		ticket, err := h.signRoomSocketTicket(userID, id, origin, auth.SessionVersion(c))
		if raw := c.GetHeader("X-Live-Room-Token"); raw != "" && err == nil {
			member, parseErr := h.parseLiveClaims(raw, "room")
			if parseErr != nil || member.RoomID != id {
				fail(c, 401, "房间凭证已失效")
				return
			}
			r, loadErr := h.loadLifecycle(c.Request.Context(), id)
			if upstreamFailed(c, loadErr) {
				return
			}
			if r == nil {
				missingRoom(c)
				return
			}
			g, loadErr := h.loadGovernance(c.Request.Context(), r)
			if upstreamFailed(c, loadErr) {
				return
			}
			if _, loadErr = h.validateLiveActor(c.Request.Context(), r, g, member); loadErr != nil {
				fail(c, 401, "房间凭证已失效")
				return
			}
			claims := &roomSocketTicketClaims{}
			_, err = jwt.ParseWithClaims(ticket, claims, func(*jwt.Token) (any, error) { return h.roomSocketTicketKey(), nil }, jwt.WithValidMethods([]string{"HS256"}), jwt.WithTimeFunc(h.clock))
			if err == nil {
				claims.Member = member
				ticket, err = jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(h.roomSocketTicketKey())
			}
		}
		if err != nil {
			fail(c, http.StatusServiceUnavailable, "Live room connections are unavailable")
			return
		}
		c.JSON(http.StatusOK, gin.H{"ticket": ticket})
	}
}
