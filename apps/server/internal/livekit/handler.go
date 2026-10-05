package livekit

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"unicode"
	"unicode/utf16"

	"companion/server/internal/auth"
	"companion/server/pkg/database"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

// Serializes room creation in deployments without a database.
var roomCreationMu sync.Mutex

var roomID = regexp.MustCompile(`^[a-zA-Z0-9_.-]{3,128}$`)

type Handler struct {
	Client    *Client
	Auth      auth.Handler
	RoomCache *redis.Client
}

func Register(r gin.IRouter, cfg Config, authentication auth.Handler, cache ...*redis.Client) {
	h := Handler{Client: NewClient(cfg), Auth: authentication}
	if len(cache) > 0 {
		h.RoomCache = cache[0]
	}
	rooms := r.Group("/rooms")
	rooms.Use(func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		if !cfg.Enabled() {
			fail(c, http.StatusServiceUnavailable, "LiveKit is not configured")
			c.Abort()
			return
		}
		if id := c.Param("roomId"); id != "" && !roomID.MatchString(id) {
			fail(c, http.StatusBadRequest, "Invalid room id")
			c.Abort()
			return
		}
		c.Next()
	})
	rooms.GET("", h.list)
	rooms.POST("/:roomId/join", h.join)
	rooms.GET("/:roomId/voice", h.voice("state"))
	rooms.POST("/:roomId/voice/request", h.voice("request"))
	rooms.DELETE("/:roomId/voice/request", h.voice("cancel"))
	rooms.POST("/:roomId/voice/requests/:requestId/approve", h.voice("approve"))
	rooms.POST("/:roomId/voice/requests/:requestId/reject", h.voice("reject"))
	rooms.POST("/:roomId/voice/end", h.voice("end"))
	rooms.Use(authentication.Require)
	rooms.POST("", h.create)
	rooms.DELETE("/:roomId", h.requireOwner, h.close)
	rooms.POST("/:roomId/agent/dispatch", h.dispatch)
	rooms.GET("/:roomId/agent/dispatch", h.dispatches)
	rooms.DELETE("/:roomId/agent/dispatch/:dispatchId", h.deleteDispatch)
}

func fail(c *gin.Context, status int, message string) {
	c.JSON(status, gin.H{"error": gin.H{"code": http.StatusText(status), "message": message}})
}
func upstreamFailed(c *gin.Context, err error) bool {
	if err == nil {
		return false
	}
	slog.Warn("LiveKit request failed", "path", c.FullPath(), "error", err)
	fail(c, http.StatusBadGateway, "LiveKit service is unavailable")
	return true
}
func body(c *gin.Context) (map[string]json.RawMessage, bool) {
	var b map[string]json.RawMessage
	decoder := json.NewDecoder(c.Request.Body)
	err := decoder.Decode(&b)
	var extra any
	if err != nil || b == nil || decoder.Decode(&extra) != io.EOF {
		fail(c, http.StatusBadRequest, "Invalid request body")
		return nil, false
	}
	return b, true
}
func field(b map[string]json.RawMessage, key string, min, max int, trim bool) (string, bool, bool) {
	raw, exists := b[key]
	if !exists {
		return "", false, true
	}
	var s string
	if string(raw) == "null" || json.Unmarshal(raw, &s) != nil {
		return "", true, false
	}
	if trim {
		s = strings.TrimFunc(s, func(r rune) bool { return unicode.IsSpace(r) || r == '\ufeff' })
	}
	// JavaScript validation counts UTF-16 code units, including surrogate pairs.
	n := len(utf16.Encode([]rune(s)))
	return s, true, n >= min && n <= max
}
func (h Handler) list(c *gin.Context) {
	items, err := h.Client.ListRooms(c.Request.Context())
	if !upstreamFailed(c, err) {
		userID, _ := h.sessionUser(c)
		items, err = h.includeOwnerRoom(c.Request.Context(), userID, items)
		if upstreamFailed(c, err) {
			return
		}
		for i := range items {
			items[i].CanManage = userID != "" && items[i].OwnerID == userID
		}
		c.JSON(http.StatusOK, gin.H{"items": items})
	}
}

func (h Handler) sessionUser(c *gin.Context) (string, error) {
	raw, _ := c.Cookie(auth.CookieName)
	if value := c.GetHeader("Authorization"); strings.HasPrefix(value, "Bearer ") {
		raw = strings.TrimPrefix(value, "Bearer ")
	}
	if raw == "" {
		return "", nil
	}
	return h.Auth.Service.Verify(raw)
}

func (h Handler) ownsRoom(c *gin.Context, userID string) bool {
	items, err := h.Client.ListRooms(c.Request.Context(), c.Param("roomId"))
	if upstreamFailed(c, err) {
		return false
	}
	for _, item := range items {
		if item.ID != c.Param("roomId") {
			continue
		}
		if userID != "" && item.OwnerID == userID {
			return true
		}
		fail(c, http.StatusForbidden, "只有直播间创建者可以执行此操作")
		return false
	}
	fail(c, http.StatusNotFound, "直播间已关闭或不存在")
	return false
}

func (h Handler) requireOwner(c *gin.Context) {
	if !h.ownsRoom(c, auth.UserID(c)) {
		c.Abort()
		return
	}
	c.Next()
}
func (h Handler) create(c *gin.Context) {
	b, ok := body(c)
	if !ok {
		return
	}
	id, hasID, validID := field(b, "id", 3, 128, false)
	title, hasTitle, validTitle := field(b, "title", 1, 100, true)
	if !validID || (hasID && !roomID.MatchString(id)) {
		fail(c, 400, "Invalid request body")
		return
	}
	if !hasTitle || !validTitle {
		fail(c, 400, "请输入 1–100 个字符的房间名称")
		return
	}
	if !hasID {
		id = "room-" + database.ID()[:12]
	}
	unlock, err := h.lockRoomCreation(c.Request.Context())
	if upstreamFailed(c, err) {
		return
	}
	defer unlock()
	ctx := c.Request.Context()
	owner := auth.UserID(c)
	reserved, err := h.loadOwnerRoom(ctx, owner)
	if upstreamFailed(c, err) {
		return
	}
	if reserved.ID != "" {
		current, err := h.exactRoom(ctx, reserved.ID)
		if upstreamFailed(c, err) {
			return
		}
		if current != nil {
			if current.OwnerID != owner {
				fail(c, 409, "房间状态正在确认，请稍后重试")
				return
			}
			if upstreamFailed(c, h.saveOwnerRoom(ctx, owner, ownerRoom{ID: current.ID, Title: current.Title})) {
				return
			}
			roomAlreadyOwned(c, *current)
			return
		}
		if reserved.Pending {
			// Retrying an uncertain create must reuse its room name, even when
			// the caller supplies a different ID/title. Never open a second room.
			id, title = reserved.ID, reserved.Title
		}
	}
	items, err := h.Client.ListRooms(ctx)
	if upstreamFailed(c, err) {
		return
	}
	// Adopt rooms created before reservations were introduced. Confirm each
	// match by name so a stale global entry cannot block a closed room forever.
	for _, existing := range items {
		if existing.OwnerID != owner {
			continue
		}
		current, err := h.exactRoom(ctx, existing.ID)
		if upstreamFailed(c, err) {
			return
		}
		if current != nil && current.OwnerID == owner {
			if upstreamFailed(c, h.saveOwnerRoom(ctx, owner, ownerRoom{ID: current.ID, Title: current.Title})) {
				return
			}
			roomAlreadyOwned(c, *current)
			return
		}
	}
	for _, existing := range items {
		if existing.OwnerID == owner {
			continue
		}
		if strings.EqualFold(strings.TrimSpace(existing.Title), title) {
			fail(c, http.StatusConflict, "这个房间名称已被使用，请换一个名称")
			return
		}
		if existing.ID == id {
			fail(c, http.StatusConflict, "该直播间已存在，请创建新的直播间")
			return
		}
	}
	// A custom ID may also be missing from the global list; never overwrite it.
	current, err := h.exactRoom(ctx, id)
	if upstreamFailed(c, err) {
		return
	}
	if current != nil {
		fail(c, 409, "该直播间已存在，请创建新的直播间")
		return
	}
	if upstreamFailed(c, h.saveOwnerRoom(ctx, owner, ownerRoom{ID: id, Title: title, Pending: true})) {
		return
	}
	item, err := h.Client.CreateRoom(ctx, id, title, owner)
	if !upstreamFailed(c, err) {
		if item.ID != id || item.OwnerID != owner {
			// An incomplete success response must not erase the reservation.
			fail(c, http.StatusBadGateway, "直播间创建结果尚未确认，请重试")
			return
		}
		if upstreamFailed(c, h.saveOwnerRoom(ctx, owner, ownerRoom{ID: item.ID, Title: item.Title})) {
			return
		}
		item.CanManage = true
		c.JSON(http.StatusCreated, gin.H{"item": item})
	}
}

func roomAlreadyOwned(c *gin.Context, item RoomItem) {
	item.CanManage = true
	c.JSON(http.StatusConflict, gin.H{
		"error": gin.H{"code": "room_already_exists", "message": "你已有一个直播间，请先关闭后再创建"},
		"item":  item,
	})
}
func (h Handler) join(c *gin.Context) {
	b, ok := body(c)
	if !ok {
		return
	}
	name, hasName, validName := field(b, "name", 1, 80, true)
	if !validName {
		fail(c, 400, "Invalid request body")
		return
	}
	// Only the room creator becomes the host, including for logged-in viewers.
	userID, err := h.sessionUser(c)
	if err != nil {
		fail(c, http.StatusUnauthorized, "登录已失效，请重新登录")
		return
	}
	identity := "viewer_" + database.ID()
	canPublish := false
	hostUserID := ""
	// Joining a missing room would otherwise implicitly create it in LiveKit.
	// Cloud's unfiltered room listing can lag behind CreateRoom. Resolve this
	// room by name so its creator can join immediately with the correct role.
	items, err := h.Client.ListRooms(c.Request.Context(), c.Param("roomId"))
	if upstreamFailed(c, err) {
		return
	}
	found := false
	roomNotice := ""
	for _, item := range items {
		if item.ID == c.Param("roomId") {
			found = true
			if item.OwnerID != "" && item.OwnerID == userID {
				identity = "host_" + userID + "_" + database.ID()[:12]
				canPublish = true
				hostUserID = userID
			} else if item.OwnerID == "" && userID != "" {
				roomNotice = "此旧直播间未记录主播身份，请重新创建直播间后开播。"
			}
			break
		}
	}
	if !found {
		fail(c, http.StatusNotFound, "直播间已关闭或不存在")
		return
	}
	if !hasName {
		name = identity
	}
	token, err := h.Client.JoinToken(c.Param("roomId"), identity, name, canPublish)
	if upstreamFailed(c, err) {
		return
	}
	voiceToken, err := h.Client.VoiceToken(c.Param("roomId"), identity, hostUserID)
	if !upstreamFailed(c, err) {
		role := "viewer"
		if canPublish {
			role = "host"
		}
		c.JSON(http.StatusCreated, gin.H{"token": token, "voiceToken": voiceToken, "role": role, "notice": roomNotice, "livekitUrl": h.Client.config.URL, "roomId": c.Param("roomId"), "identity": identity})
	}
}
func (h Handler) close(c *gin.Context) {
	unlock, err := h.lockRoomCreation(c.Request.Context(), c.Param("roomId"))
	if upstreamFailed(c, err) {
		return
	}
	defer unlock()
	if !upstreamFailed(c, h.Client.DeleteRoom(c.Request.Context(), c.Param("roomId"))) {
		reserved, err := h.loadOwnerRoom(c.Request.Context(), auth.UserID(c))
		if upstreamFailed(c, err) {
			return
		}
		if reserved.ID == c.Param("roomId") && upstreamFailed(c, h.saveOwnerRoom(c.Request.Context(), auth.UserID(c), ownerRoom{})) {
			return
		}
		c.JSON(200, gin.H{"ok": true})
	}
}
func (h Handler) dispatch(c *gin.Context) {
	b, ok := body(c)
	if !ok {
		return
	}
	agent, hasAgent, valid := field(b, "agentName", 1, 80, true)
	if !valid {
		fail(c, 400, "Invalid request body")
		return
	}
	if !hasAgent {
		agent = h.Client.config.AgentName
		if agent == "" {
			agent = "room-assistant"
		}
	}
	metadata := ""
	if raw, exists := b["metadata"]; exists {
		var object map[string]json.RawMessage
		if json.Unmarshal(raw, &object) != nil || object == nil {
			fail(c, 400, "Invalid request body")
			return
		}
		compact, _ := json.Marshal(object)
		metadata = string(compact)
	}
	if !h.ownsRoom(c, auth.UserID(c)) {
		return
	}
	item, err := h.Client.CreateDispatch(c.Request.Context(), c.Param("roomId"), agent, metadata)
	if !upstreamFailed(c, err) {
		c.JSON(http.StatusCreated, gin.H{"item": item})
	}
}
func (h Handler) dispatches(c *gin.Context) {
	if !h.ownsRoom(c, auth.UserID(c)) {
		return
	}
	items, err := h.Client.ListDispatches(c.Request.Context(), c.Param("roomId"))
	if !upstreamFailed(c, err) {
		c.JSON(200, gin.H{"items": items})
	}
}
func (h Handler) deleteDispatch(c *gin.Context) {
	id := strings.TrimSpace(c.Param("dispatchId"))
	if id == "" {
		fail(c, 400, "Invalid dispatch id")
		return
	}
	if !h.ownsRoom(c, auth.UserID(c)) {
		return
	}
	if !upstreamFailed(c, h.Client.DeleteDispatch(c.Request.Context(), c.Param("roomId"), id)) {
		c.JSON(200, gin.H{"ok": true})
	}
}
