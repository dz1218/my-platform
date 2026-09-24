package response

import (
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"log/slog"
	"net/http"
)

type Error struct {
	Status        int
	Code, Message string
}

func (e *Error) Error() string { return e.Message }
func Fail(c *gin.Context, err error) {
	var e *Error
	if errors.As(err, &e) {
		c.JSON(e.Status, gin.H{"error": gin.H{"code": e.Code, "message": e.Message}})
		return
	}
	if errors.Is(err, pgx.ErrNoRows) {
		c.JSON(404, gin.H{"error": gin.H{"code": "not_found", "message": "内容不存在或无权访问"}})
		return
	}
	slog.Error("request failed", "path", c.FullPath(), "error", err)
	c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "internal", "message": "服务暂时不可用，请稍后重试"}})
}
func BadRequest(message string) error { return &Error{400, "invalid_request", message} }
