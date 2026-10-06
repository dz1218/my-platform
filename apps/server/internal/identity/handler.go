package identity

import (
	"companion/server/pkg/response"
	"github.com/gin-gonic/gin"
)

type Handler struct{ Repo Repository }

func (h Handler) Discover(c *gin.Context) {
	filters, err := ParseFilters(c.Request.URL.Query())
	if err != nil {
		response.Fail(c, err)
		return
	}
	page, err := h.Repo.DiscoverPage(c.Request.Context(), c.GetString("userID"), filters)
	if err != nil {
		response.Fail(c, err)
		return
	}
	c.JSON(200, page)
}
