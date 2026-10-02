package livekit

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf16"

	"companion/server/internal/auth"
	"companion/server/pkg/database"
	"github.com/gin-gonic/gin"
)

var roomID = regexp.MustCompile(`^[a-zA-Z0-9_.-]{3,128}$`)

type Handler struct {
	Client *Client
	Auth   auth.Handler
}

func Register(r gin.IRouter, cfg Config, authentication auth.Handler) {
	h := Handler{Client: NewClient(cfg), Auth: authentication}
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
	rooms.Use(authentication.Require)
	rooms.POST("", h.create)
	rooms.DELETE("/:roomId", h.close)
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
		c.JSON(http.StatusOK, gin.H{"items": items})
	}
}
func (h Handler) create(c *gin.Context) {
	b, ok := body(c)
	if !ok {
		return
	}
	id, hasID, validID := field(b, "id", 3, 128, false)
	title, hasTitle, validTitle := field(b, "title", 1, 100, false)
	if !validID || (hasID && !roomID.MatchString(id)) || !validTitle {
		fail(c, 400, "Invalid request body")
		return
	}
	if !hasID {
		id = "room-" + database.ID()[:12]
	}
	if !hasTitle {
		title = "未命名直播间"
	}
	item, err := h.Client.CreateRoom(c.Request.Context(), id, title)
	if !upstreamFailed(c, err) {
		c.JSON(http.StatusCreated, gin.H{"item": item})
	}
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
	// Identity and publish rights come from the session, never the request body.
	raw, _ := c.Cookie(auth.CookieName)
	if value := c.GetHeader("Authorization"); strings.HasPrefix(value, "Bearer ") {
		raw = strings.TrimPrefix(value, "Bearer ")
	}
	identity := "viewer_" + database.ID()
	canPublish := false
	if raw != "" {
		userID, err := h.Auth.Service.Verify(raw)
		if err != nil {
			fail(c, http.StatusUnauthorized, "登录已失效，请重新登录")
			return
		}
		identity = "host_" + userID + "_" + database.ID()[:12]
		canPublish = true
	}
	if !hasName {
		name = identity
	}
	// Joining a missing room would otherwise implicitly create it in LiveKit.
	items, err := h.Client.ListRooms(c.Request.Context())
	if upstreamFailed(c, err) {
		return
	}
	found := false
	for _, item := range items {
		if item.ID == c.Param("roomId") {
			found = true
			break
		}
	}
	if !found {
		fail(c, http.StatusNotFound, "直播间已关闭或不存在")
		return
	}
	token, err := h.Client.JoinToken(c.Param("roomId"), identity, name, canPublish)
	if !upstreamFailed(c, err) {
		c.JSON(http.StatusCreated, gin.H{"token": token, "livekitUrl": h.Client.config.URL, "roomId": c.Param("roomId"), "identity": identity})
	}
}
func (h Handler) close(c *gin.Context) {
	if !upstreamFailed(c, h.Client.DeleteRoom(c.Request.Context(), c.Param("roomId"))) {
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
	item, err := h.Client.CreateDispatch(c.Request.Context(), c.Param("roomId"), agent, metadata)
	if !upstreamFailed(c, err) {
		c.JSON(http.StatusCreated, gin.H{"item": item})
	}
}
func (h Handler) dispatches(c *gin.Context) {
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
	if !upstreamFailed(c, h.Client.DeleteDispatch(c.Request.Context(), c.Param("roomId"), id)) {
		c.JSON(200, gin.H{"ok": true})
	}
}
