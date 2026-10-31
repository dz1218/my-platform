package livekit

import (
	"companion/server/internal/auth"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"
)

func DeriveRoomAgentToken(base string) string {
	if len(base) < 32 {
		return ""
	}
	mac := hmac.New(sha256.New, []byte(base))
	mac.Write([]byte("live-room-agent:v1"))
	return hex.EncodeToString(mac.Sum(nil))
}
func RegisterRoomAgent(router gin.IRouter, cfg Config, authentication auth.Handler, cache *redis.Client) {
	h := Handler{Client: NewClient(cfg), Auth: authentication, RoomCache: cache}
	group := router.Group("/internal/live/rooms/:roomId")
	group.Use(func(c *gin.Context) {
		if len(cfg.RoomAgentToken) < 32 || subtle.ConstantTimeCompare([]byte(c.GetHeader("Authorization")), []byte("Bearer "+cfg.RoomAgentToken)) != 1 {
			c.AbortWithStatus(401)
			return
		}
		if !roomID.MatchString(c.Param("roomId")) {
			c.AbortWithStatus(400)
			return
		}
		c.Next()
	})
	group.GET("/events", h.roomAgentEvents)
	group.GET("/history", h.roomAgentHistory)
	group.POST("/output", h.roomAgentOutput)
}
func (h Handler) activeRoomAgent(ctx context.Context, c *gin.Context) (*roomLifecycle, error) {
	r, err := h.loadLifecycle(ctx, c.Param("roomId"))
	if err != nil {
		return nil, err
	}
	if r == nil || r.State != "open" || r.SID != c.GetHeader("X-Live-Room-Sid") || r.Assistant.SessionID != c.GetHeader("X-Live-Assistant-Session") || (r.Assistant.Status != "starting" && r.Assistant.Status != "online") {
		return nil, errors.New("inactive assistant session")
	}
	return r, nil
}
func (h Handler) roomAgentEvents(c *gin.Context) {
	r, err := h.activeRoomAgent(c.Request.Context(), c)
	if err != nil {
		c.AbortWithStatus(409)
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 50*time.Minute)
	defer cancel()
	changes, err := h.SubscribeRoomUpdates(ctx)
	if err != nil {
		c.AbortWithStatus(503)
		return
	}
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-store")
	c.Header("X-Accel-Buffering", "no")
	stream := http.NewResponseController(c.Writer)
	after, _ := strconv.ParseInt(c.Query("after"), 10, 64)
	send := func() bool {
		r, err := h.activeRoomAgent(ctx, c)
		if err != nil {
			return false
		}
		g, err := h.loadGovernance(ctx, r)
		if err != nil {
			return false
		}
		b, err := h.loadChatBuffer(ctx, r)
		if err != nil {
			return false
		}
		messages := []LiveChatMessage{}
		for _, m := range b.Messages {
			if m.Sequence > after && m.Destination == "" {
				messages = append(messages, m)
			}
		}
		members := []LiveMember{}
		for _, m := range g.Members {
			if m.Online {
				members = append(members, publicMember(m, h.clock().UnixMilli()))
			}
		}
		body, _ := json.Marshal(gin.H{"roomId": r.ID, "roomSid": r.SID, "title": r.Title, "sessionId": r.Assistant.SessionID, "assistantStartedAt": r.Assistant.StartedAt, "sequence": b.Sequence, "settings": g.Settings, "members": members, "messages": messages})
		// The API has a 20s response deadline; bound each stream write instead.
		_ = stream.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if _, err = fmt.Fprintf(c.Writer, "data: %s\n\n", body); err != nil {
			return false
		}
		if err = stream.Flush(); err != nil {
			return false
		}
		_ = stream.SetWriteDeadline(time.Time{})
		after = b.Sequence
		return true
	}
	if !send() {
		return
	}
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case id, ok := <-changes:
			if !ok {
				return
			}
			if id == r.ID || id == "" {
				if !send() {
					return
				}
			}
		case <-ticker.C:
			if !send() {
				return
			}
		}
	}
}

type roomAgentOutput struct {
	RequestID  string `json:"requestId"`
	Kind       string `json:"kind"`
	Text       string `json:"text"`
	SourceID   string `json:"sourceId"`
	MemberID   string `json:"memberId"`
	ActionKind string `json:"actionKind"`
}

func (h Handler) roomAgentOutput(c *gin.Context) {
	var in roomAgentOutput
	if bindLiveInput(c, &in) != nil || !voiceRequestID.MatchString(in.RequestID) {
		fail(c, 400, "Invalid output")
		return
	}
	in.Text = strings.TrimSpace(in.Text)
	if len(utf16.Encode([]rune(in.Text))) > 500 {
		fail(c, 400, "Output too long")
		return
	}
	unlock, err := h.lockVoice(c.Request.Context(), c.Param("roomId"))
	if upstreamFailed(c, err) {
		return
	}
	defer unlock()
	ctx := c.Request.Context()
	r, err := h.activeRoomAgent(ctx, c)
	if err != nil {
		c.AbortWithStatus(409)
		return
	}
	g, err := h.loadGovernance(ctx, r)
	if upstreamFailed(c, err) {
		return
	}
	b, err := h.loadChatBuffer(ctx, r)
	if upstreamFailed(c, err) {
		return
	}
	key := "assistant:" + r.Assistant.SessionID + ":" + in.RequestID
	// A replayed source cannot produce a second reply or proposal after a worker restart.
	if in.Kind == "reply" || in.Kind == "suggest" {
		key = "assistant:" + r.Assistant.SessionID + ":" + in.Kind + ":" + in.SourceID + ":" + in.ActionKind
	}
	if old, ok := b.Receipts[key]; ok {
		c.JSON(200, gin.H{"message": old})
		return
	}
	var source *LiveChatMessage
	for i := range b.Messages {
		if b.Messages[i].ID == in.SourceID && b.Messages[i].Time >= r.Assistant.StartedAt && b.Messages[i].Destination == "" && (b.Messages[i].Role == "host" || b.Messages[i].Role == "viewer") {
			source = &b.Messages[i]
			break
		}
	}
	if in.Kind != "welcome" && source == nil {
		fail(c, 409, "Source message no longer available")
		return
	}
	now := h.clock().UnixMilli()
	if source != nil {
		m := g.Members[source.MemberID]
		if m == nil || activeRestriction(m.Mute, now) || activeRestriction(m.Ban, now) {
			fail(c, 409, "Source member is restricted")
			return
		}
	}
	if in.Kind == "suggest" {
		if !g.Settings.AutoModeration {
			fail(c, 403, "Automatic moderation disabled")
			return
		}
		m := g.Members[in.MemberID]
		if m == nil || m.Role != "viewer" || source.MemberID != m.ID {
			fail(c, 403, "Invalid target")
			return
		}
		if in.ActionKind != "kick" && in.ActionKind != "mute" {
			fail(c, 400, "Invalid action")
			return
		}
		if receipt, ok := g.Receipts[key]; ok {
			c.Data(200, "application/json", receipt.Result)
			return
		}
		for _, a := range g.Actions {
			if a.RequestID == key {
				c.JSON(200, gin.H{"action": a})
				return
			}
		}
		a := h.proposeModeration(g, m, in.ActionKind, in.Text, []string{source.Text})
		if a.RequestID == "" {
			a.RequestID = key
		}
		result, _ := json.Marshal(gin.H{"action": a})
		g.Receipts[key] = liveReceipt{At: now, Result: result}
		if !upstreamFailed(c, h.saveGovernance(ctx, r, g)) {
			c.JSON(200, gin.H{"action": a})
		}
		return
	}
	if in.Text == "" {
		fail(c, 400, "Empty output")
		return
	}
	message := LiveChatMessage{MemberID: r.Assistant.Identity, Name: "AI 助手", Role: "assistant", Text: in.Text}
	switch in.Kind {
	case "reply":
		explicit := strings.HasPrefix(strings.ToUpper(strings.TrimSpace(source.Text)), "@AI")
		if !explicit {
			if !g.Settings.AutoReply {
				fail(c, 403, "Automatic replies disabled")
				return
			}
			if now-b.AutoReplyAt < 30000 || now-b.AutoUserAt[source.MemberID] < 60000 {
				fail(c, 429, "Automatic reply cooldown")
				return
			}
			b.AutoReplyAt = now
			b.AutoUserAt[source.MemberID] = now
		}
		message.ReplyTo = source.ID
	case "notice":
		message.Destination = source.MemberID
		message.ReplyTo = source.ID
	case "welcome":
		if !g.Settings.Welcome || now-b.WelcomeAt < 30000 {
			fail(c, 429, "Welcome disabled or cooling down")
			return
		}
		b.WelcomeAt = now
	default:
		fail(c, 400, "Unknown output kind")
		return
	}
	message = h.appendLiveMessage(b, message)
	b.Receipts[key] = message
	if !upstreamFailed(c, h.saveChatBuffer(ctx, r, b)) {
		latency := int64(0)
		if source != nil {
			latency = max(0, now-source.Time)
		}
		slog.Info("live assistant output", "room", r.ID, "session", r.Assistant.SessionID, "kind", in.Kind, "latency_ms", latency)
		c.JSON(http.StatusCreated, gin.H{"message": message})
	}
}
