package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"companion/server/internal/auth"
	"companion/server/internal/conversation"
	"companion/server/internal/delivery"
	"companion/server/pkg/response"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"golang.org/x/net/websocket"
)

type chatCommand struct {
	Type      string `json:"type"`
	RequestID string `json:"requestId"`
	Content   string `json:"content"`
}

type socketBackend interface {
	Owned(context.Context, string, string) (conversation.Conversation, error)
	History(context.Context, conversation.Conversation, int64, int) (conversation.Page, error)
	Send(context.Context, string, string, string, string) (conversation.Message, error)
}

type durableSocketBackend struct{ delivery.Service }

func (b durableSocketBackend) Owned(ctx context.Context, user, id string) (conversation.Conversation, error) {
	return b.Messages.Owned(ctx, user, id)
}
func (b durableSocketBackend) History(ctx context.Context, conv conversation.Conversation, before int64, limit int) (conversation.Page, error) {
	return b.Messages.History(ctx, conv, before, limit)
}

func chatSocket(chat delivery.Service, cache *redis.Client, origin string) gin.HandlerFunc {
	limiter := redis.NewScript(`local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n`)
	return socketHandler(durableSocketBackend{chat}, origin, func(ctx context.Context, userID string) error {
		n, err := limiter.Run(ctx, cache, []string{"rate:chat:" + userID}).Int()
		if err != nil {
			return err
		}
		if n > 30 {
			return &response.Error{Status: 429, Code: "rate_limit", Message: "操作太频繁，请稍后再试"}
		}
		return nil
	})
}

func socketHandler(chat socketBackend, origin string, allow func(context.Context, string) error) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := auth.UserID(c)
		conv, err := chat.Owned(c.Request.Context(), userID, c.Param("id"))
		if err != nil {
			response.Fail(c, err)
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
				ws.MaxPayloadBytes = 32 * 1024
				ctx, cancel := context.WithTimeout(c.Request.Context(), time.Hour)
				defer cancel()
				commands := make(chan chatCommand)
				go func() {
					defer cancel()
					for {
						var command chatCommand
						_ = ws.SetReadDeadline(time.Now().Add(60 * time.Second))
						if websocket.JSON.Receive(ws, &command) != nil {
							return
						}
						select {
						case commands <- command:
						case <-ctx.Done():
							return
						}
					}
				}()
				write := func(value any) error {
					_ = ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
					return websocket.JSON.Send(ws, value)
				}
				// The durable database is authoritative across API and worker processes.
				// Send a fresh snapshot on reconnect and whenever persisted state changes.
				previous := ""
				syncHistory := func() error {
					queryCtx, stop := context.WithTimeout(ctx, 5*time.Second)
					defer stop()
					page, err := chat.History(queryCtx, conv, 0, 50)
					if err != nil {
						return err
					}
					data, err := json.Marshal(page)
					if err != nil {
						return err
					}
					if string(data) == previous {
						return nil
					}
					if err = write(gin.H{"type": "history", "page": page}); err != nil {
						return err
					}
					previous = string(data)
					return nil
				}
				if syncHistory() != nil {
					return
				}
				ticker := time.NewTicker(time.Second)
				defer ticker.Stop()
				heartbeat := time.NewTicker(20 * time.Second)
				defer heartbeat.Stop()
				for {
					select {
					case <-ctx.Done():
						return
					case <-ticker.C:
						if syncHistory() != nil {
							return
						}
					case <-heartbeat.C:
						if write(gin.H{"type": "ping"}) != nil {
							return
						}
					case command := <-commands:
						if command.Type == "pong" {
							continue
						}
						if command.Type != "send" {
							return
						}
						sendCtx, stop := context.WithTimeout(ctx, 10*time.Second)
						err := allow(sendCtx, userID)
						if err == nil {
							message, sendErr := chat.Send(sendCtx, userID, conv.ID, command.RequestID, command.Content)
							err = sendErr
							if err == nil {
								err = write(gin.H{"type": "accepted", "requestId": command.RequestID, "message": message})
								if err != nil {
									stop()
									return
								}
							}
						}
						stop()
						if err != nil {
							message := "服务暂时不可用，请稍后重试"
							var public *response.Error
							if errors.As(err, &public) {
								message = public.Message
							}
							if write(gin.H{"type": "error", "requestId": command.RequestID, "message": message}) != nil {
								return
							}
						}
						if syncHistory() != nil {
							return
						}
					}
				}
			},
		}
		server.ServeHTTP(c.Writer, c.Request)
	}
}
