package auth

import (
	"companion/server/pkg/response"
	"github.com/gin-gonic/gin"
	"net/http"
	"strings"
)

type Handler struct {
	Service      Service
	SecureCookie bool
}
type credentials struct {
	Email    string `json:"email"`
	Name     string `json:"name"`
	Password string `json:"password"`
	Consent  bool   `json:"consent"`
}

func (h Handler) Register(c *gin.Context) {
	var b credentials
	if err := c.ShouldBindJSON(&b); err != nil {
		response.Fail(c, response.BadRequest("请求格式不正确"))
		return
	}
	u, err := h.Service.Register(c.Request.Context(), b.Email, b.Name, b.Password, b.Consent)
	h.session(c, u, err, 201)
}
func (h Handler) Login(c *gin.Context) {
	var b credentials
	if err := c.ShouldBindJSON(&b); err != nil {
		response.Fail(c, response.BadRequest("请求格式不正确"))
		return
	}
	u, err := h.Service.Login(c.Request.Context(), b.Email, b.Password)
	h.session(c, u, err, 200)
}
func (h Handler) session(c *gin.Context, u User, err error, status int) {
	if err != nil {
		response.Fail(c, err)
		return
	}
	token, err := h.Service.Token(u.ID)
	if err != nil {
		response.Fail(c, err)
		return
	}
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(CookieName, token, 7*24*3600, "/", "", h.SecureCookie, true)
	c.JSON(status, gin.H{"user": u})
}
func (h Handler) Logout(c *gin.Context) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(CookieName, "", -1, "/", "", h.SecureCookie, true)
	c.Status(204)
}
func (h Handler) Require(c *gin.Context) {
	raw, _ := c.Cookie(CookieName)
	if v := c.GetHeader("Authorization"); strings.HasPrefix(v, "Bearer ") {
		raw = strings.TrimPrefix(v, "Bearer ")
	}
	id, err := h.Service.Verify(raw)
	if err != nil {
		c.AbortWithStatusJSON(401, gin.H{"error": gin.H{"code": "unauthorized", "message": "请先登录"}})
		return
	}
	c.Set("userID", id)
	c.Next()
}
func UserID(c *gin.Context) string { return c.GetString("userID") }
func (h Handler) Me(c *gin.Context) {
	u, err := h.Service.Repo.ByID(c.Request.Context(), UserID(c))
	if err != nil {
		response.Fail(c, err)
		return
	}
	c.JSON(200, gin.H{"user": u})
}
