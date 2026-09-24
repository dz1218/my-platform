package identity

import (
	"companion/server/pkg/response"
	"github.com/gin-gonic/gin"
)

type Handler struct{ Repo Repository }

func (h Handler) Discover(c *gin.Context) {
	items, err := h.Repo.List(c.Request.Context())
	if err != nil {
		response.Fail(c, err)
		return
	}
	c.JSON(200, gin.H{"items": items})
}
