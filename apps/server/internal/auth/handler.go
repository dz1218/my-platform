package auth

import (
	"companion/server/pkg/response"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

type Handler struct {
	Service      Service
	SecureCookie bool
}
type credentials struct {
	Phone    string `json:"phone"`
	Ticket   string `json:"ticket"`
	Code     string `json:"code"`
	Name     string `json:"name"`
	Password string `json:"password"`
	Consent  bool   `json:"consent"`
	Gender   string `json:"gender"`
}

func (h Handler) Register(c *gin.Context) {
	var b credentials
	if err := c.ShouldBindJSON(&b); err != nil {
		response.Fail(c, response.BadRequest("请求格式不正确"))
		return
	}
	u, err := h.Service.Register(c.Request.Context(), b.Phone, b.Name, b.Password, b.Consent, b.Gender, b.Ticket)
	h.session(c, u, err, 201)
}
func (h Handler) Login(c *gin.Context) {
	var b credentials
	if err := c.ShouldBindJSON(&b); err != nil {
		response.Fail(c, response.BadRequest("请求格式不正确"))
		return
	}
	u, err := h.Service.Login(c.Request.Context(), b.Phone, b.Password)
	h.session(c, u, err, 200)
}
func (h Handler) session(c *gin.Context, u User, err error, status int) {
	if err != nil {
		response.Fail(c, err)
		return
	}
	token, err := h.Service.Token(u.ID, u.SessionVersion)
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

// Optional keeps public browsing available without a valid session while
// preserving account-specific catalog filtering for signed-in users.
func (h Handler) Optional(c *gin.Context) {
	raw, _ := c.Cookie(CookieName)
	if v := c.GetHeader("Authorization"); strings.HasPrefix(v, "Bearer ") {
		raw = strings.TrimPrefix(v, "Bearer ")
	}
	if session, err := h.Service.Authenticate(c.Request.Context(), raw); err == nil {
		h.Service.BindSession(c, session)
	}
	c.Next()
}
func (h Handler) Require(c *gin.Context) {
	raw, _ := c.Cookie(CookieName)
	if v := c.GetHeader("Authorization"); strings.HasPrefix(v, "Bearer ") {
		raw = strings.TrimPrefix(v, "Bearer ")
	}
	session, err := h.Service.Authenticate(c.Request.Context(), raw)
	if err != nil {
		response.Fail(c, err)
		c.Abort()
		return
	}
	h.Service.BindSession(c, session)
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

func (h Handler) SendCode(c *gin.Context) {
	var b credentials
	if c.ShouldBindJSON(&b) != nil {
		response.Fail(c, response.BadRequest("请求格式不正确"))
		return
	}
	if err := h.Service.SendCode(c.Request.Context(), b.Phone); err != nil {
		response.Fail(c, err)
		return
	}
	c.JSON(200, gin.H{"sent": true, "retryAfter": 60})
}
func (h Handler) VerifyCode(c *gin.Context) {
	var b credentials
	if c.ShouldBindJSON(&b) != nil {
		response.Fail(c, response.BadRequest("请求格式不正确"))
		return
	}
	ticket, err := h.Service.VerifyCode(c.Request.Context(), b.Phone, b.Code)
	if err != nil {
		response.Fail(c, err)
		return
	}
	c.JSON(200, gin.H{"ticket": ticket})
}
