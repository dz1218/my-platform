package httpapi

import (
	"companion/server/internal/ai/provider"
	"companion/server/internal/delivery"
	"context"
	"crypto/subtle"
	"github.com/gin-gonic/gin"
	"net/http"
	"time"
)

func agentRoutes(r *gin.Engine, token string, repo delivery.Repository) {
	group := r.Group("/internal/companion")
	group.Use(func(c *gin.Context) {
		if token == "" || subtle.ConstantTimeCompare([]byte(c.GetHeader("Authorization")), []byte("Bearer "+token)) != 1 {
			c.AbortWithStatus(401)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64*1024)
		c.Next()
	})
	group.POST("/validate", func(c *gin.Context) {
		var run provider.RunContext
		if c.ShouldBindJSON(&run) != nil {
			c.AbortWithStatus(400)
			return
		}
		if repo.ValidateRun(c.Request.Context(), run) != nil {
			c.AbortWithStatus(409)
			return
		}
		c.JSON(200, gin.H{"ok": true})
	})
	group.POST("/search", func(c *gin.Context) {
		var input struct {
			Run    provider.RunContext `json:"run"`
			Query  string              `json:"query"`
			Vector []float64           `json:"vector"`
			Model  string              `json:"model"`
		}
		if c.ShouldBindJSON(&input) != nil {
			c.AbortWithStatus(400)
			return
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), 3*time.Second)
		defer cancel()
		if repo.ValidateRun(ctx, input.Run) != nil {
			c.AbortWithStatus(409)
			return
		}
		items, err := repo.SearchEvidence(ctx, input.Run, input.Query, input.Vector, input.Model)
		if err != nil {
			c.JSON(503, gin.H{"error": "retrieval_unavailable"})
			return
		}
		c.JSON(200, gin.H{"items": items})
	})
}
