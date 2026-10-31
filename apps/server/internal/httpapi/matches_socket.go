package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"

	"companion/server/internal/auth"
	"companion/server/internal/matching"

	"github.com/gin-gonic/gin"
	"golang.org/x/net/websocket"
)

type matchListBackend interface {
	List(context.Context, string) ([]matching.Match, error)
}

type matchSubscriptions interface {
	Subscribe(string) (<-chan struct{}, func())
}

func matchesSocket(matches matchListBackend, updates matchSubscriptions, origin string) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := auth.UserID(c)
		if userID == "" {
			c.AbortWithStatus(http.StatusUnauthorized)
			return
		}
		server := websocket.Server{
			Handshake: func(_ *websocket.Config, req *http.Request) error {
				if req.Header.Get("Origin") != origin {
					return errors.New("invalid origin")
				}
				return nil
			},
			Handler: func(ws *websocket.Conn) {
				defer ws.Close()
				ws.MaxPayloadBytes = 1024
				ctx, cancel := context.WithTimeout(c.Request.Context(), time.Hour)
				defer cancel()
				changes, unsubscribe := updates.Subscribe(userID)
				defer unsubscribe()
				go func() {
					defer cancel()
					for {
						var command struct {
							Type string `json:"type"`
						}
						_ = ws.SetReadDeadline(time.Now().Add(60 * time.Second))
						if websocket.JSON.Receive(ws, &command) != nil || command.Type != "pong" {
							return
						}
					}
				}()
				write := func(value any) error {
					if err := auth.CheckConnection(c, ctx); err != nil {
						if errors.Is(err, auth.ErrInvalidSession) {
							_ = ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
							_ = websocket.JSON.Send(ws, gin.H{"type": "session.invalidated"})
						}
						return err
					}
					_ = ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
					return websocket.JSON.Send(ws, value)
				}
				heartbeat := time.NewTicker(20 * time.Second)
				defer heartbeat.Stop()
				for {
					select {
					case <-ctx.Done():
						return
					case _, open := <-changes:
						if !open {
							return
						}
						if err := auth.CheckConnection(c, ctx); err != nil {
							_ = write(gin.H{"type": "ping"})
							return
						}
						queryCtx, stop := context.WithTimeout(ctx, 5*time.Second)
						items, err := matches.List(queryCtx, userID)
						stop()
						if err != nil {
							return
						}
						if items == nil {
							items = []matching.Match{}
						}
						if write(gin.H{"type": "matches.updated", "items": items}) != nil {
							return
						}
					case <-heartbeat.C:
						if write(gin.H{"type": "ping"}) != nil {
							return
						}
					}
				}
			},
		}
		server.ServeHTTP(c.Writer, c.Request)
	}
}
