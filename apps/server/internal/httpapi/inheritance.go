package httpapi

import (
	"companion/server/internal/auth"
	"companion/server/internal/delivery"
	"companion/server/internal/identity"
	"companion/server/pkg/response"
	"github.com/gin-gonic/gin"
)

func inheritanceRoutes(api *gin.RouterGroup, ids identity.Repository, chat delivery.Service) {
	state := func(c *gin.Context) {
		s, err := ids.Inheritance(c.Request.Context(), auth.UserID(c))
		if err != nil {
			response.Fail(c, err)
			return
		}
		c.JSON(200, s)
	}
	api.GET("/identity-inheritance", state)
	api.POST("/identity-inheritance", func(c *gin.Context) {
		var b struct {
			IdentityID string `json:"identityId"`
		}
		if c.ShouldBindJSON(&b) != nil || b.IdentityID == "" {
			response.Fail(c, response.BadRequest("请选择要继承的身份"))
			return
		}
		if err := chat.Repo.InheritIdentity(c.Request.Context(), auth.UserID(c), b.IdentityID, chat.Policies); err != nil {
			response.Fail(c, err)
			return
		}
		state(c)
	})
	api.POST("/identity-inheritance/skip", func(c *gin.Context) {
		if err := ids.SkipInheritance(c.Request.Context(), auth.UserID(c)); err != nil {
			response.Fail(c, err)
			return
		}
		c.JSON(200, gin.H{"ok": true})
	})
	api.POST("/identity-inheritance/gender", func(c *gin.Context) {
		var b struct {
			Gender string `json:"gender"`
		}
		if c.ShouldBindJSON(&b) != nil {
			response.Fail(c, response.BadRequest("请选择你的性别"))
			return
		}
		if err := ids.SetGender(c.Request.Context(), auth.UserID(c), b.Gender); err != nil {
			response.Fail(c, err)
			return
		}
		c.JSON(200, gin.H{"ok": true})
	})
}
