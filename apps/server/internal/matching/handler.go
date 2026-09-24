package matching

import (
	"companion/server/internal/auth"
	"companion/server/pkg/response"
	"github.com/gin-gonic/gin"
)

type Handler struct{ Service Service }

func (h Handler) Create(c *gin.Context) {
	var b struct {
		IdentityID string `json:"identityId" binding:"required"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		response.Fail(c, response.BadRequest("请选择想认识的人"))
		return
	}
	m, err := h.Service.Meet(c.Request.Context(), auth.UserID(c), b.IdentityID)
	if err != nil {
		response.Fail(c, err)
		return
	}
	c.JSON(200, m)
}
func (h Handler) List(c *gin.Context) {
	items, err := h.Service.Repo.List(c.Request.Context(), auth.UserID(c))
	if err != nil {
		response.Fail(c, err)
		return
	}
	c.JSON(200, gin.H{"items": items})
}
func (h Handler) Get(c *gin.Context) {
	m, err := h.Service.Repo.Get(c.Request.Context(), auth.UserID(c), c.Param("id"))
	if err != nil {
		response.Fail(c, err)
		return
	}
	c.JSON(200, m)
}
