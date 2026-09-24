package httpapi

import (
	"companion/server/internal/auth"
	"companion/server/internal/behavior"
	"companion/server/internal/config"
	"companion/server/internal/conversation"
	"companion/server/internal/delivery"
	"companion/server/internal/identity"
	"companion/server/internal/matching"
	"companion/server/pkg/response"
	"context"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"net/http"
	"time"
)

func New(cfg config.Config, db *pgxpool.Pool, cache *redis.Client, policies behavior.Catalog) *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery())
	_ = r.SetTrustedProxies(nil)
	r.Use(func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("Cache-Control", "no-store")
		origin := c.GetHeader("Origin")
		if origin != "" && origin != cfg.WebOrigin {
			c.AbortWithStatusJSON(403, gin.H{"error": gin.H{"code": "origin", "message": "请求来源不允许"}})
			return
		}
		if origin != "" {
			c.Header("Access-Control-Allow-Origin", cfg.WebOrigin)
			c.Header("Vary", "Origin")
			c.Header("Access-Control-Allow-Credentials", "true")
			c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")
			c.Header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		}
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32*1024)
		c.Next()
	})
	r.GET("/health", func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		defer cancel()
		if db.Ping(ctx) != nil || cache.Ping(ctx).Err() != nil {
			c.JSON(503, gin.H{"ok": false})
			return
		}
		c.JSON(200, gin.H{"ok": true, "service": "companion"})
	})
	ah := auth.Handler{Service: auth.Service{Repo: auth.Repository{DB: db}, Secret: cfg.JWTSecret}, SecureCookie: cfg.SecureCookie}
	ids := identity.Repository{DB: db}
	messages := conversation.Repository{DB: db}
	mh := matching.Handler{Service: matching.Service{Repo: matching.Repository{DB: db}, Identities: ids}}
	chat := delivery.Service{Repo: delivery.Repository{DB: db}, Messages: messages, Policies: policies}
	api := r.Group("/api/v1")
	api.POST("/auth/register", rateLimit(cache, "auth", 60, false), ah.Register)
	api.POST("/auth/login", rateLimit(cache, "auth", 60, false), ah.Login)
	api.POST("/auth/logout", ah.Logout)
	api.Use(ah.Require)
	api.GET("/me", ah.Me)
	api.GET("/discover", identity.Handler{Repo: ids}.Discover)
	api.GET("/matches", mh.List)
	api.POST("/matches", mh.Create)
	api.GET("/matches/:id", mh.Get)
	api.GET("/conversations/:id/messages", func(c *gin.Context) {
		conv, err := messages.Owned(c.Request.Context(), auth.UserID(c), c.Param("id"))
		if err != nil {
			response.Fail(c, err)
			return
		}
		before, err := conversation.Cursor(c.Query("before"))
		if err != nil {
			response.Fail(c, err)
			return
		}
		page, err := messages.History(c.Request.Context(), conv, before, 50)
		if err != nil {
			response.Fail(c, err)
			return
		}
		c.JSON(200, page)
	})
	api.POST("/conversations/:id/messages", rateLimit(cache, "chat", 30, true), func(c *gin.Context) {
		var b struct {
			Content   string `json:"content"`
			RequestID string `json:"requestId"`
		}
		if err := c.ShouldBindJSON(&b); err != nil {
			response.Fail(c, response.BadRequest("请求格式不正确"))
			return
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
		defer cancel()
		message, err := chat.Send(ctx, auth.UserID(c), c.Param("id"), b.RequestID, b.Content)
		if err != nil {
			response.Fail(c, err)
			return
		}
		c.JSON(http.StatusAccepted, gin.H{"message": message})
	})
	return r
}

func rateLimit(cache *redis.Client, scope string, limit int, byUser bool) gin.HandlerFunc {
	script := redis.NewScript(`local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n`)
	return func(c *gin.Context) {
		key := c.ClientIP()
		if byUser {
			key = auth.UserID(c)
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		defer cancel()
		n, err := script.Run(ctx, cache, []string{"rate:" + scope + ":" + key}).Int()
		if err != nil {
			c.Abort()
			response.Fail(c, &response.Error{Status: 503, Code: "unavailable", Message: "服务暂时不可用"})
			return
		}
		if n > limit {
			c.Header("Retry-After", "60")
			c.Abort()
			response.Fail(c, &response.Error{Status: 429, Code: "rate_limit", Message: "操作太频繁，请稍后再试"})
			return
		}
		c.Next()
	}
}
