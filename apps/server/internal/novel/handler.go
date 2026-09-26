package novel

import (
	"companion/server/internal/auth"
	"companion/server/pkg/response"
	"github.com/gin-gonic/gin"
)

type Handler struct {
	Repo Repository
	Auth auth.Service
}

func (h Handler) viewer(c *gin.Context) string {
	raw, _ := c.Cookie(auth.CookieName)
	id, err := h.Auth.Verify(raw)
	if err != nil {
		return ""
	}
	return id
}
func (h Handler) List(c *gin.Context) {
	items, err := h.Repo.List(c.Request.Context())
	if err != nil {
		response.Fail(c, err)
		return
	}
	c.JSON(200, gin.H{"items": items})
}
func (h Handler) Get(c *gin.Context) {
	n, err := h.Repo.Get(c.Request.Context(), c.Param("id"), h.viewer(c))
	if err != nil {
		response.Fail(c, err)
		return
	}
	c.JSON(200, n)
}
func (h Handler) Chapter(c *gin.Context) {
	chapter, err := h.Repo.ReadChapter(c.Request.Context(), c.Param("id"), c.Param("chapterId"), h.viewer(c))
	if err != nil {
		response.Fail(c, err)
		return
	}
	c.JSON(200, chapter)
}
func (h Handler) Write(operation string) gin.HandlerFunc {
	return func(c *gin.Context) {
		var b Input
		if err := c.ShouldBindJSON(&b); err != nil {
			response.Fail(c, response.BadRequest("请求格式不正确或内容过长"))
			return
		}
		id, err := h.Repo.Mutate(c.Request.Context(), auth.UserID(c), c.Param("id"), c.Param("chapterId"), operation, b)
		if err != nil {
			response.Fail(c, err)
			return
		}
		c.JSON(200, gin.H{"id": id})
	}
}
