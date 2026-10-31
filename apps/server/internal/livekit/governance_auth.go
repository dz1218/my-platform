package livekit

import (
	"companion/server/internal/auth"
	"companion/server/pkg/database"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"net/http"
	"slices"
	"strings"
	"time"
)

const liveGuestCookie = "live_guest"

func bindLiveInput(c *gin.Context, input any) error {
	// Allows a complete FAQ/settings document while bounding unauthenticated
	// JSON parsing before the room credential and message limits are checked.
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 128<<10)
	return c.ShouldBindJSON(input)
}

type liveRoomClaims struct {
	jwt.RegisteredClaims
	RoomID   string `json:"roomId"`
	RoomSID  string `json:"roomSid"`
	MemberID string `json:"memberId"`
	Origin   string `json:"origin,omitempty"`
}

func (h Handler) liveKey(purpose string) []byte {
	key := h.Auth.Service.Secret
	if key == "" {
		key = h.Client.config.APISecret
	}
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write([]byte("live:" + purpose))
	return mac.Sum(nil)
}
func (h Handler) guestID(c *gin.Context) (string, error) {
	raw, _ := c.Cookie(liveGuestCookie)
	claims := &jwt.RegisteredClaims{}
	if _, err := jwt.ParseWithClaims(raw, claims, func(*jwt.Token) (any, error) { return h.liveKey("guest"), nil }, jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer("live-guest"), jwt.WithExpirationRequired(), jwt.WithTimeFunc(h.clock)); err == nil && len(claims.Subject) == 32 {
		return claims.Subject, nil
	}
	id := database.ID()
	now := h.clock()
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{Issuer: "live-guest", Subject: id, IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(30 * 24 * time.Hour))}).SignedString(h.liveKey("guest"))
	if err != nil {
		return "", err
	}
	http.SetCookie(c.Writer, &http.Cookie{Name: liveGuestCookie, Value: token, Path: "/", MaxAge: 30 * 24 * 3600, HttpOnly: true, Secure: h.Auth.SecureCookie, SameSite: http.SameSiteLaxMode})
	return id, nil
}
func (h Handler) signLiveClaims(claims liveRoomClaims, purpose string, ttl time.Duration) (string, error) {
	now := h.clock()
	claims.Issuer = "live-" + purpose
	claims.Audience = jwt.ClaimStrings{purpose}
	claims.IssuedAt = jwt.NewNumericDate(now)
	claims.ExpiresAt = jwt.NewNumericDate(now.Add(ttl))
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(h.liveKey(purpose))
}
func (h Handler) parseLiveClaims(raw, purpose string) (*liveRoomClaims, error) {
	if len(raw) > 4096 {
		return nil, errors.New("invalid credential")
	}
	claims := &liveRoomClaims{}
	_, err := jwt.ParseWithClaims(raw, claims, func(*jwt.Token) (any, error) { return h.liveKey(purpose), nil }, jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer("live-"+purpose), jwt.WithAudience(purpose), jwt.WithExpirationRequired(), jwt.WithTimeFunc(h.clock))
	if err != nil || claims.Subject == "" || claims.RoomSID == "" {
		return nil, errors.New("invalid credential")
	}
	return claims, nil
}
func (h Handler) admitLiveMember(c *gin.Context, r *roomLifecycle, identity, userID, name string) (*LiveMember, string, error) {
	ctx := c.Request.Context()
	g, err := h.loadGovernance(ctx, r)
	if err != nil {
		return nil, "", err
	}
	guest, err := h.guestID(c)
	if err != nil {
		return nil, "", err
	}
	subjects := []string{"g:" + guest}
	if userID != "" {
		subjects = append(subjects, "u:"+userID)
	}
	var member *LiveMember
	var inheritedMute *LiveRestriction
	for _, m := range g.Members {
		for _, subject := range subjects {
			if slices.Contains(m.Subjects, subject) {
				if activeRestriction(m.Ban, h.clock().UnixMilli()) && userID != r.OwnerID {
					return nil, "", errLiveBanned
				}
				if activeRestriction(m.Mute, h.clock().UnixMilli()) {
					inheritedMute = m.Mute
				}
				// Never inherit an account's identity or role through its browser cookie.
				if userID != "" && subject == "u:"+userID || userID == "" && len(m.Subjects) == 1 && subject == "g:"+guest {
					member = m
				}
			}
		}
	}
	if member == nil {
		id := database.ID()
		seed := id
		if userID == "" {
			seed = guest
		}
		code := strings.ToUpper(seed[:4])
		for size := 4; size <= len(seed); size += 4 {
			code = strings.ToUpper(seed[:size])
			collision := false
			for _, other := range g.Members {
				if other.Code == code {
					collision = true
					break
				}
			}
			if !collision {
				break
			}
		}
		member = &LiveMember{ID: id, Code: code, Role: "viewer", Subjects: subjects}
		g.Members[id] = member
	}
	for _, subject := range subjects {
		if !slices.Contains(member.Subjects, subject) {
			member.Subjects = append(member.Subjects, subject)
		}
	}
	if member.Name == "" {
		if userID != "" && h.Auth.Service.Repo.DB != nil {
			var actual string
			if err := h.Auth.Service.Repo.DB.QueryRow(ctx, `SELECT COALESCE(name,'') FROM users WHERE id=$1`, userID).Scan(&actual); err != nil {
				return nil, "", err
			}
			name = actual
		}
		if userID == "" || strings.TrimSpace(name) == "" {
			name = "听众·" + member.Code
		}
		member.Name = strings.TrimSpace(name)
	}
	if userID == r.OwnerID && userID != "" {
		member.Role = "host"
	} else if inheritedMute != nil {
		member.Mute = inheritedMute
	}
	// Replay belongs to the stable member in this broadcast, not a single
	// connection. Preserve its first admission even when refresh replaces identity.
	joinedAt := h.clock().UnixMilli()
	for _, admission := range g.Admissions {
		if admission.MemberID == member.ID && admission.JoinedAt > 0 {
			joinedAt = min(joinedAt, admission.JoinedAt)
		}
	}
	g.Admissions[identity] = liveAdmission{MemberID: member.ID, JoinedAt: joinedAt, ExpiresAt: h.clock().Add(12 * time.Hour).UnixMilli(), UserID: userID, SessionVersion: auth.SessionVersion(c)}
	if err = h.saveGovernance(ctx, r, g); err != nil {
		return nil, "", err
	}
	token, err := h.signLiveClaims(liveRoomClaims{RegisteredClaims: jwt.RegisteredClaims{Subject: identity}, RoomID: r.ID, RoomSID: r.SID, MemberID: member.ID}, "room", 12*time.Hour)
	v := publicMember(member, h.clock().UnixMilli())
	return &v, token, err
}

var errLiveBanned = errors.New("room member banned")

func (h Handler) validateLiveActor(ctx context.Context, r *roomLifecycle, g *roomGovernance, claims *liveRoomClaims) (*LiveMember, error) {
	if claims.RoomSID != r.SID || claims.RoomID != r.ID {
		return nil, errors.New("room session changed")
	}
	a, ok := g.Admissions[claims.Subject]
	m := g.Members[a.MemberID]
	if !ok || a.MemberID != claims.MemberID || m == nil || a.ExpiresAt < h.clock().UnixMilli() {
		return nil, errors.New("membership expired")
	}
	if a.UserID != "" {
		if err := h.Auth.Service.CheckSession(ctx, auth.Session{UserID: a.UserID, Version: a.SessionVersion}); err != nil {
			return nil, err
		}
	}
	if m.Role == "host" && (r.Host == nil || r.Host.Identity != claims.Subject) {
		return nil, errors.New("host session changed")
	}
	return m, nil
}

// Every HTTP room operation is serialized with admission, cohosting and closure.
func (h Handler) liveOperation(c *gin.Context, owner, present bool, fn func(*roomLifecycle, *roomGovernance, *LiveMember, *liveRoomClaims)) {
	claims, err := h.parseLiveClaims(c.GetHeader("X-Live-Room-Token"), "room")
	if err != nil || claims.RoomID != c.Param("roomId") {
		failRoom(c, 401, "live_session_invalid", "房间凭证已失效，请重新进入")
		return
	}
	unlock, err := h.lockVoice(c.Request.Context(), claims.RoomID)
	if upstreamFailed(c, err) {
		return
	}
	defer unlock()
	r, err := h.loadLifecycle(c.Request.Context(), claims.RoomID)
	if upstreamFailed(c, err) {
		return
	}
	if r == nil || r.State != "open" {
		closedRoom(c)
		return
	}
	g, err := h.loadGovernance(c.Request.Context(), r)
	if upstreamFailed(c, err) {
		return
	}
	m, err := h.validateLiveActor(c.Request.Context(), r, g, claims)
	if err != nil {
		failRoom(c, 401, "live_session_invalid", "房间凭证已失效，请重新进入")
		return
	}
	if activeRestriction(m.Ban, h.clock().UnixMilli()) {
		failRoom(c, 403, "room_banned", "你已被移出，本场直播内不可重新进入")
		return
	}
	if owner && m.Role != "host" {
		fail(c, 403, "只有主播可以执行此操作")
		return
	}
	if present {
		people, err := h.Client.ListParticipants(c.Request.Context(), r.ID)
		if upstreamFailed(c, err) {
			return
		}
		found := false
		for _, p := range people {
			if p.Identity == claims.Subject && p.human() && p.online() {
				found = true
			}
		}
		if !found {
			fail(c, 403, "请先连接直播间")
			return
		}
	}
	fn(r, g, m, claims)
}
func liveHash(v any) string {
	b, _ := json.Marshal(v)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
