package httpapi

import (
	"companion/server/internal/auth"
	"companion/server/internal/delivery"
	"companion/server/pkg/response"
	"github.com/gin-gonic/gin"
)

func autopilotRoutes(api *gin.RouterGroup, chat delivery.Service) {
	api.GET("/operator/conversations", func(c *gin.Context) {
		items, err := chat.Repo.Assignments(c.Request.Context(), auth.UserID(c))
		if err != nil {
			response.Fail(c, err)
			return
		}
		c.JSON(200, gin.H{"items": items})
	})
	api.GET("/conversations/:id/auto-reply", func(c *gin.Context) {
		s, err := chat.Repo.Settings(c.Request.Context(), c.Param("id"), auth.UserID(c))
		if err != nil {
			response.Fail(c, err)
			return
		}
		c.JSON(200, s)
	})
	api.PATCH("/conversations/:id/auto-reply", func(c *gin.Context) {
		var b struct {
			Mode         string `json:"mode"`
			DelaySeconds int    `json:"delaySeconds"`
		}
		if c.ShouldBindJSON(&b) != nil {
			response.Fail(c, response.BadRequest("请求格式不正确"))
			return
		}
		conv, err := chat.Messages.Accessible(c.Request.Context(), auth.UserID(c), c.Param("id"))
		if err != nil {
			response.Fail(c, err)
			return
		}
		s, err := chat.Repo.Configure(c.Request.Context(), conv.ID, auth.UserID(c), b.Mode, b.DelaySeconds, "", chat.Policies.For(conv.IdentityID))
		if err != nil {
			response.Fail(c, err)
			return
		}
		c.JSON(200, s)
	})
	api.POST("/conversations/:id/takeover", func(c *gin.Context) {
		var b struct {
			OwnerType string `json:"ownerType"`
		}
		if c.ShouldBindJSON(&b) != nil || (b.OwnerType != "AI" && b.OwnerType != "HUMAN") {
			response.Fail(c, response.BadRequest("无效的接管状态"))
			return
		}
		conv, err := chat.Messages.Accessible(c.Request.Context(), auth.UserID(c), c.Param("id"))
		if err != nil {
			response.Fail(c, err)
			return
		}
		s, err := chat.Repo.Configure(c.Request.Context(), conv.ID, auth.UserID(c), "", 0, b.OwnerType, chat.Policies.For(conv.IdentityID))
		if err != nil {
			response.Fail(c, err)
			return
		}
		c.JSON(200, s)
	})
}
