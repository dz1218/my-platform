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
	inherited, err := h.Repo.Inherited(c.Request.Context(), c.GetString("userID"))
	if err != nil {
		response.Fail(c, err)
		return
	}
	if inherited != nil {
		filtered := []Identity{}
		for _, i := range items {
			if i.ID != inherited.ID {
				filtered = append(filtered, i)
			}
		}
		items = filtered
	}
	c.JSON(200, gin.H{"items": items})
}
