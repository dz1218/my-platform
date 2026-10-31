package httpapi

import (
	"companion/server/internal/auth"
	"companion/server/internal/delivery"
	"companion/server/pkg/response"
	"github.com/gin-gonic/gin"
	"strconv"
	"time"
)

func companionV2Routes(api *gin.RouterGroup, chat delivery.Service) {
	api.GET("/conversations/:id/memory-preferences", func(c *gin.Context) {
		p, err := chat.Repo.MemoryPreferences(c.Request.Context(), c.Param("id"), auth.UserID(c))
		if err != nil {
			response.Fail(c, err)
			return
		}
		c.JSON(200, p)
	})
	api.PATCH("/conversations/:id/memory-preferences", func(c *gin.Context) {
		var p delivery.MemoryPreferences
		if c.ShouldBindJSON(&p) != nil {
			response.Fail(c, response.BadRequest("请求格式不正确"))
			return
		}
		p, err := chat.Repo.SetMemoryPreferences(c.Request.Context(), c.Param("id"), auth.UserID(c), p)
		if err != nil {
			response.Fail(c, err)
			return
		}
		c.JSON(200, p)
	})
	api.POST("/conversations/:id/memories/clear", func(c *gin.Context) {
		var p struct {
			Version int64 `json:"version"`
		}
		if c.ShouldBindJSON(&p) != nil {
			response.Fail(c, response.BadRequest("请求格式不正确"))
			return
		}
		if err := chat.Repo.ClearMemories(c.Request.Context(), c.Param("id"), auth.UserID(c), p.Version); err != nil {
			response.Fail(c, err)
			return
		}
		c.JSON(200, gin.H{"ok": true})
	})
	api.POST("/conversations/:id/memory-proposals/:proposalId/resolve", func(c *gin.Context) {
		var p struct {
			Version int64 `json:"version"`
			Accept  bool  `json:"accept"`
		}
		if c.ShouldBindJSON(&p) != nil {
			response.Fail(c, response.BadRequest("请求格式不正确"))
			return
		}
		if err := chat.Repo.ResolveMemory(c.Request.Context(), c.Param("id"), auth.UserID(c), c.Param("proposalId"), p.Version, p.Accept); err != nil {
			response.Fail(c, err)
			return
		}
		c.JSON(200, gin.H{"ok": true})
	})
	api.GET("/conversations/:id/preferences", func(c *gin.Context) {
		p, err := chat.Repo.Preferences(c.Request.Context(), c.Param("id"), auth.UserID(c))
		if err != nil {
			response.Fail(c, err)
			return
		}
		c.JSON(200, p)
	})
	for _, route := range []struct {
		path    string
		manager bool
	}{{"/conversations/:id/preferences", false}, {"/conversations/:id/proactive-policy", true}} {
		manager := route.manager
		api.PATCH(route.path, func(c *gin.Context) {
			var p delivery.Preferences
			if c.ShouldBindJSON(&p) != nil {
				response.Fail(c, response.BadRequest("请求格式不正确"))
				return
			}
			if err := chat.Repo.SavePreferences(c.Request.Context(), c.Param("id"), auth.UserID(c), p, manager); err != nil {
				response.Fail(c, err)
				return
			}
			c.JSON(200, gin.H{"ok": true})
		})
	}
	api.POST("/conversations/:id/followups", func(c *gin.Context) {
		var p struct {
			SourceMessageID string    `json:"sourceMessageId"`
			Topic           string    `json:"topic"`
			DueAt           time.Time `json:"dueAt"`
			ExpiresAt       time.Time `json:"expiresAt"`
		}
		if c.ShouldBindJSON(&p) != nil {
			response.Fail(c, response.BadRequest("请求格式不正确"))
			return
		}
		if err := chat.Repo.AddOpportunity(c.Request.Context(), c.Param("id"), auth.UserID(c), p.SourceMessageID, p.Topic, p.DueAt, p.ExpiresAt); err != nil {
			response.Fail(c, err)
			return
		}
		c.JSON(200, gin.H{"ok": true})
	})
	api.GET("/conversations/:id/memories", func(c *gin.Context) {
		cursor, err := strconv.Atoi(c.DefaultQuery("cursor", "0"))
		if err != nil {
			response.Fail(c, response.BadRequest("无效的记忆分页"))
			return
		}
		page, err := chat.Repo.MemoryCollection(c.Request.Context(), c.Param("id"), auth.UserID(c), cursor)
		if err != nil {
			response.Fail(c, err)
			return
		}
		c.JSON(200, page)
	})
	api.POST("/conversations/:id/memories", func(c *gin.Context) {
		var m delivery.Memory
		if c.ShouldBindJSON(&m) != nil {
			response.Fail(c, response.BadRequest("请求格式不正确"))
			return
		}
		if err := chat.Repo.SaveMemory(c.Request.Context(), c.Param("id"), auth.UserID(c), m, false); err != nil {
			response.Fail(c, err)
			return
		}
		c.JSON(200, gin.H{"ok": true})
	})
	api.POST("/conversations/:id/memories/:memoryId/delete", func(c *gin.Context) {
		var p struct {
			Version int64 `json:"version"`
		}
		if c.ShouldBindJSON(&p) != nil {
			response.Fail(c, response.BadRequest("请求格式不正确"))
			return
		}
		if err := chat.Repo.SaveMemory(c.Request.Context(), c.Param("id"), auth.UserID(c), delivery.Memory{ID: c.Param("memoryId"), Version: p.Version}, true); err != nil {
			response.Fail(c, err)
			return
		}
		c.JSON(200, gin.H{"ok": true})
	})
	api.GET("/conversations/:id/daily-state", func(c *gin.Context) {
		state, err := chat.Repo.DailyState(c.Request.Context(), c.Param("id"), auth.UserID(c))
		if err != nil {
			response.Fail(c, err)
			return
		}
		c.JSON(200, state)
	})
	api.PATCH("/conversations/:id/daily-state", func(c *gin.Context) {
		var state delivery.DailyState
		if c.ShouldBindJSON(&state) != nil {
			response.Fail(c, response.BadRequest("请求格式不正确"))
			return
		}
		if err := chat.Repo.SaveDailyState(c.Request.Context(), c.Param("id"), auth.UserID(c), state); err != nil {
			response.Fail(c, err)
			return
		}
		c.JSON(200, gin.H{"ok": true})
	})
}
