package httpapi

import (
	"companion/server/internal/auth"
	"companion/server/internal/delivery"
	"companion/server/internal/identity"
	"companion/server/pkg/response"
	"github.com/gin-gonic/gin"
	"strconv"
)

func inheritanceRoutes(api *gin.RouterGroup, ids identity.Repository, chat delivery.Service) {
	state := func(c *gin.Context) {
		includeItems := true
		if raw, ok := c.GetQuery("includeItems"); ok {
			parsed, err := strconv.ParseBool(raw)
			if err != nil {
				response.Fail(c, response.BadRequest("includeItems 必须为 true 或 false"))
				return
			}
			includeItems = parsed
		}
		selectedID := c.Query("selectedId")
		if len(selectedID) > 96 {
			response.Fail(c, response.BadRequest("所选身份无效"))
			return
		}
		s, err := ids.InheritanceState(c.Request.Context(), auth.UserID(c), includeItems, selectedID)
		if err != nil {
			response.Fail(c, err)
			return
		}
		c.JSON(200, s)
	}
	api.GET("/identity-inheritance", state)
	api.GET("/identity-inheritance/options", func(c *gin.Context) {
		filters, err := identity.ParseFilters(c.Request.URL.Query())
		if err != nil {
			response.Fail(c, err)
			return
		}
		page, err := ids.InheritancePage(c.Request.Context(), auth.UserID(c), filters)
		if err != nil {
			response.Fail(c, err)
			return
		}
		c.JSON(200, page)
	})
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
