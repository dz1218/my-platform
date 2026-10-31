package auth

import (
	"companion/server/pkg/response"
	"github.com/gin-gonic/gin"
)

func passwordBody(c *gin.Context, value any) bool {
	c.Header("Cache-Control", "no-store")
	if c.ShouldBindJSON(value) != nil {
		response.Fail(c, response.BadRequest("请求格式不正确"))
		return false
	}
	return true
}
func (h Handler) SendPasswordCode(c *gin.Context) {
	var b credentials
	if !passwordBody(c, &b) {
		return
	}
	if err := h.Service.SendPasswordCode(c.Request.Context(), b.Phone); err != nil {
		response.Fail(c, err)
		return
	}
	c.JSON(200, gin.H{"sent": true, "retryAfter": 60})
}
func (h Handler) VerifyPasswordCode(c *gin.Context) {
	var b credentials
	if !passwordBody(c, &b) {
		return
	}
	ticket, err := h.Service.VerifyPasswordCode(c.Request.Context(), b.Phone, b.Code)
	if err != nil {
		response.Fail(c, err)
		return
	}
	c.JSON(200, gin.H{"ticket": ticket})
}
func (h Handler) ResetPassword(c *gin.Context) {
	var b credentials
	if !passwordBody(c, &b) {
		return
	}
	if err := h.Service.ResetPassword(c.Request.Context(), b.Phone, b.Ticket, b.Password); err != nil {
		response.Fail(c, err)
		return
	}
	h.Logout(c)
}
func (h Handler) ChangePassword(c *gin.Context) {
	var b struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if !passwordBody(c, &b) {
		return
	}
	if err := h.Service.ChangePassword(c.Request.Context(), Session{UserID: UserID(c), Version: SessionVersion(c)}, b.CurrentPassword, b.NewPassword); err != nil {
		response.Fail(c, err)
		return
	}
	h.Logout(c)
}
