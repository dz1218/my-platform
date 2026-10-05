package livekit

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

	"companion/server/internal/auth"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

const voiceAttribute = "live.voice"

var voiceRequestID = regexp.MustCompile(`^[a-zA-Z0-9_-]{16,80}$`)

// Striped, context-aware locks are shared by both route prefixes and the sweeper.
// Production uses a database advisory lock shared by all API replicas.
var voiceLocks = func() [64]chan struct{} {
	var locks [64]chan struct{}
	for i := range locks {
		locks[i] = make(chan struct{}, 1)
	}
	return locks
}()

type voiceClaims struct {
	jwt.RegisteredClaims
	Room   string `json:"room"`
	Role   string `json:"role"`
	UserID string `json:"userId,omitempty"`
}

func (c *Client) VoiceToken(room, identity, userID string) (string, error) {
	now := time.Now()
	role := "viewer"
	if userID != "" {
		role = "host"
	}
	claims := voiceClaims{RegisteredClaims: jwt.RegisteredClaims{
		Issuer: c.config.APIKey, Audience: jwt.ClaimStrings{"live-voice"}, Subject: identity,
		IssuedAt: jwt.NewNumericDate(now), NotBefore: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(2 * time.Hour)),
	}, Room: room, Role: role, UserID: userID}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(c.config.APISecret))
}

// This credential cannot be used as an application login or a LiveKit join token.
func (h Handler) voiceActor(c *gin.Context) (*voiceClaims, bool) {
	claims := &voiceClaims{}
	_, err := jwt.ParseWithClaims(c.GetHeader("X-Live-Voice-Token"), claims, func(_ *jwt.Token) (any, error) {
		return []byte(h.Client.config.APISecret), nil
	}, jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer(h.Client.config.APIKey), jwt.WithAudience("live-voice"), jwt.WithExpirationRequired())
	if err != nil || claims.Subject == "" || claims.Room != c.Param("roomId") || (claims.Role != "host" && claims.Role != "viewer") {
		fail(c, http.StatusUnauthorized, "连线凭证已失效，请重新进入直播间")
		return nil, false
	}
	if claims.Role == "host" {
		raw, _ := c.Cookie(auth.CookieName)
		if v := c.GetHeader("Authorization"); strings.HasPrefix(v, "Bearer ") {
			raw = strings.TrimPrefix(v, "Bearer ")
		}
		userID, err := h.Auth.Service.Verify(raw)
		if err != nil || userID != claims.UserID || userID == "" {
			fail(c, http.StatusUnauthorized, "登录已失效，请重新登录")
			return nil, false
		}
		if !h.ownsRoom(c, userID) {
			return nil, false
		}
	}
	return claims, true
}

type participantPermission struct {
	CanPublish bool `json:"canPublish"`
}

func (p *participantPermission) UnmarshalJSON(data []byte) error {
	var wire struct {
		CanPublish bool `json:"canPublish"`
		Proto      bool `json:"can_publish"`
	}
	if err := json.Unmarshal(data, &wire); err != nil {
		return err
	}
	p.CanPublish = wire.CanPublish || wire.Proto
	return nil
}

type voiceParticipant struct {
	SID        string                `json:"sid"`
	Identity   string                `json:"identity"`
	Name       string                `json:"name"`
	Kind       json.RawMessage       `json:"kind"`
	State      json.RawMessage       `json:"state"`
	Attributes map[string]string     `json:"attributes"`
	Permission participantPermission `json:"permission"`
}

func (p voiceParticipant) human() bool {
	return len(p.Kind) == 0 || string(p.Kind) == "null" || string(p.Kind) == "0" || string(p.Kind) == `"STANDARD"`
}
func (p voiceParticipant) online() bool {
	return p.SID != "" && string(p.State) != "3" && string(p.State) != `"DISCONNECTED"`
}

// Terminal states retain the request ID so retries cannot affect a newer request.
type voiceRequest struct {
	ID          string `json:"requestId"`
	SID         string `json:"participantSid"`
	Status      string `json:"status"`
	RequestedAt int64  `json:"requestedAt"`
}

func (p voiceParticipant) request() voiceRequest {
	var request voiceRequest
	_ = json.Unmarshal([]byte(p.Attributes[voiceAttribute]), &request)
	return request
}
func (r voiceRequest) occupies() bool { return r.Status == "pending" || r.Status == "approved" }

type voiceSlot struct {
	voiceRequest
	Identity string `json:"identity"`
	Name     string `json:"name"`
}
type voiceState struct {
	Slot    *voiceSlot `json:"slot"`
	HasHost bool       `json:"hasHost"`
}

func stateFromParticipants(participants []voiceParticipant) voiceState {
	state := voiceState{}
	for _, p := range participants {
		if !p.online() || !p.human() {
			continue
		}
		if strings.HasPrefix(p.Identity, "host_") {
			state.HasHost = true
		}
		if strings.HasPrefix(p.Identity, "viewer_") {
			r := p.request()
			if r.occupies() || p.Permission.CanPublish {
				state.Slot = &voiceSlot{voiceRequest: r, Identity: p.Identity, Name: p.Name}
			}
		}
	}
	return state
}

func (c *Client) ListParticipants(ctx context.Context, room string) ([]voiceParticipant, error) {
	var result struct {
		Participants []voiceParticipant `json:"participants"`
	}
	err := c.call(ctx, "RoomService", "ListParticipants", adminGrant(room), map[string]string{"room": room}, &result)
	return result.Participants, err
}

// Attributes and permission are updated together on the same participant.
func (c *Client) updateVoice(ctx context.Context, room string, p voiceParticipant, request voiceRequest) (voiceParticipant, error) {
	encoded, _ := json.Marshal(request)
	var result voiceParticipant
	err := c.call(ctx, "RoomService", "UpdateParticipant", adminGrant(room), map[string]any{
		"room": room, "identity": p.Identity,
		"attributes": map[string]string{voiceAttribute: string(encoded)},
		"permission": map[string]any{
			"canPublish": request.Status == "approved", "canPublishSources": []int{1, 2},
			"canSubscribe": true, "canPublishData": true, "canUpdateOwnMetadata": false,
		},
	}, &result)
	return result, err
}

func voiceLockKey(room string) uint64 {
	hash := fnv.New64a()
	_, _ = hash.Write([]byte("live-voice:" + room))
	return hash.Sum64()
}

func (h Handler) lockVoice(ctx context.Context, room string) (func(), error) {
	key := voiceLockKey(room)
	if db := h.Auth.Service.Repo.DB; db != nil {
		tx, err := db.Begin(ctx)
		if err != nil {
			return nil, err
		}
		unlock := func() {
			cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = tx.Rollback(cleanup)
		}
		if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", int64(key)); err != nil {
			unlock()
			return nil, err
		}
		return unlock, nil
	}
	lock := voiceLocks[key%uint64(len(voiceLocks))]
	select {
	case lock <- struct{}{}:
		return func() { <-lock }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// Called under the room lock. A new session cannot inherit an old approval,
// and unexpected publishing rights are revoked before the slot becomes free.
func (h Handler) reconcileVoice(ctx context.Context, room string, participants []voiceParticipant) ([]voiceParticipant, error) {
	state := stateFromParticipants(participants)
	occupied := 0
	for _, p := range participants {
		if p.human() && p.online() && strings.HasPrefix(p.Identity, "viewer_") && (p.request().occupies() || p.Permission.CanPublish) {
			occupied++
		}
	}
	for i, p := range participants {
		if !p.human() || !p.online() || !strings.HasPrefix(p.Identity, "viewer_") {
			continue
		}
		r := p.request()
		if !r.occupies() && !p.Permission.CanPublish {
			continue
		}
		if !state.HasHost || r.SID != p.SID || occupied > 1 || (p.Permission.CanPublish && r.Status != "approved") {
			r.Status = "ended"
			updated, err := h.Client.updateVoice(ctx, room, p, r)
			if err != nil {
				return nil, err
			}
			participants[i] = updated
		}
	}
	return participants, nil
}

func (h Handler) voice(action string) gin.HandlerFunc {
	return func(c *gin.Context) {
		actor, ok := h.voiceActor(c)
		if !ok {
			return
		}
		if ((action == "approve" || action == "reject") && actor.Role != "host") || ((action == "request" || action == "cancel") && actor.Role != "viewer") {
			fail(c, http.StatusForbidden, "无权执行此连线操作")
			return
		}
		requestID := c.Param("requestId")
		if action != "state" && requestID == "" {
			b, ok := body(c)
			if !ok {
				return
			}
			var valid bool
			requestID, _, valid = field(b, "requestId", 16, 80, false)
			if !valid {
				fail(c, 400, "无效的连线申请")
				return
			}
		}
		if action != "state" && !voiceRequestID.MatchString(requestID) {
			fail(c, 400, "无效的连线申请")
			return
		}
		room := c.Param("roomId")
		unlock, err := h.lockVoice(c.Request.Context(), room)
		if upstreamFailed(c, err) {
			return
		}
		defer unlock()
		// Finish the bounded operation under the lock even if the browser leaves.
		ctx, cancel := context.WithTimeout(context.WithoutCancel(c.Request.Context()), 12*time.Second)
		defer cancel()
		participants, err := h.Client.ListParticipants(ctx, room)
		if upstreamFailed(c, err) {
			return
		}
		caller := -1
		for i, p := range participants {
			if p.Identity == actor.Subject && p.human() && p.online() {
				caller = i
				break
			}
		}
		if caller < 0 {
			fail(c, http.StatusForbidden, "请先进入直播间")
			return
		}
		participants, err = h.reconcileVoice(ctx, room, participants)
		if upstreamFailed(c, err) {
			return
		}
		state := stateFromParticipants(participants)
		if action == "state" {
			c.JSON(200, state)
			return
		}
		var target voiceParticipant
		var request voiceRequest
		if action == "request" {
			target = participants[caller]
			if !strings.HasPrefix(target.Identity, "viewer_") {
				fail(c, 403, "只有观众可以申请连线")
				return
			}
			if state.Slot != nil {
				if state.Slot.Identity == actor.Subject && state.Slot.ID == requestID {
					c.JSON(200, state)
					return
				}
				fail(c, 409, "已有观众申请或正在连线，请等待名额空闲")
				return
			}
			if !state.HasHost {
				fail(c, 409, "主播暂未在线，稍后再申请")
				return
			}
			for _, p := range participants {
				if p.request().ID == requestID {
					fail(c, 409, "此申请已结束，请重新申请")
					return
				}
			}
			request = voiceRequest{ID: requestID, SID: target.SID, Status: "pending", RequestedAt: time.Now().UnixMilli()}
		} else {
			for _, p := range participants {
				if p.human() && p.online() && strings.HasPrefix(p.Identity, "viewer_") && p.request().ID == requestID {
					target = p
					break
				}
			}
			request = target.request()
			if target.Identity == "" || request.SID != target.SID {
				fail(c, 409, "申请已失效，请刷新连线状态")
				return
			}
			if actor.Role == "viewer" && target.Identity != actor.Subject {
				fail(c, 403, "只能操作自己的连线")
				return
			}
			switch action {
			case "approve":
				if request.Status == "approved" {
					c.JSON(200, state)
					return
				}
				if request.Status != "pending" || state.Slot == nil || state.Slot.ID != requestID {
					fail(c, 409, "申请已结束，无法同意")
					return
				}
				request.Status = "approved"
			case "cancel", "reject":
				terminal := "cancelled"
				if action == "reject" {
					terminal = "rejected"
				}
				if request.Status == terminal {
					c.JSON(200, state)
					return
				}
				if request.Status != "pending" {
					fail(c, 409, "申请状态已改变，请刷新后重试")
					return
				}
				request.Status = terminal
			case "end":
				if request.Status == "ended" {
					c.JSON(200, state)
					return
				}
				if request.Status != "approved" {
					fail(c, 409, "当前没有可结束的连线")
					return
				}
				request.Status = "ended"
			}
		}
		_, err = h.Client.updateVoice(ctx, room, target, request)
		if err != nil {
			// A lost response is not evidence of a failed update. Read back under
			// the same lock; never clear a reservation based on a transport error.
			verifyCtx, verifyCancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer verifyCancel()
			actual, readErr := h.Client.ListParticipants(verifyCtx, room)
			if readErr == nil {
				for _, p := range actual {
					if p.Identity == target.Identity && p.request() == request && p.Permission.CanPublish == (request.Status == "approved") {
						c.JSON(200, stateFromParticipants(actual))
						return
					}
				}
			}
			upstreamFailed(c, err)
			return
		}
		participants, err = h.Client.ListParticipants(ctx, room)
		if !upstreamFailed(c, err) {
			c.JSON(200, stateFromParticipants(participants))
		}
	}
}

// RunVoiceCleanup runs once per API process. It is safe across replicas and both
// URL aliases because it uses the same advisory locks as the request handlers.
func RunVoiceCleanup(ctx context.Context, cfg Config, authentication auth.Handler) {
	if !cfg.Enabled() {
		return
	}
	h := Handler{Client: NewClient(cfg), Auth: authentication}
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := h.cleanupVoiceRooms(ctx); err != nil && ctx.Err() == nil {
				slog.Warn("voice cleanup failed", "error", err)
			}
		}
	}
}

func (h Handler) cleanupVoiceRooms(ctx context.Context) error {
	rooms, err := h.Client.ListRooms(ctx)
	if err != nil {
		return err
	}
	var failures []error
	for _, room := range rooms {
		if err := h.ReconcileVoiceRoom(ctx, room.ID); err != nil {
			failures = append(failures, fmt.Errorf("room %s: %w", room.ID, err))
		}
	}
	return errors.Join(failures...)
}

// ReconcileVoiceRoom revokes stale voice approvals under the room lock.
func (h Handler) ReconcileVoiceRoom(ctx context.Context, room string) error {
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	unlock, err := h.lockVoice(ctx, room)
	if err != nil {
		return err
	}
	defer unlock()
	participants, err := h.Client.ListParticipants(ctx, room)
	if err == nil {
		_, err = h.reconcileVoice(ctx, room, participants)
	}
	return err
}
