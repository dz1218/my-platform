package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
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
	Accessible(context.Context, string, string) (conversation.Conversation, error)
	History(context.Context, conversation.Conversation, int64, int) (conversation.Page, error)
	Send(context.Context, string, string, string, string) (conversation.Message, error)
}

type durableSocketBackend struct{ delivery.Service }

func (b durableSocketBackend) Accessible(ctx context.Context, user, id string) (conversation.Conversation, error) {
	return b.Messages.Accessible(ctx, user, id)
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
		conv, err := chat.Accessible(c.Request.Context(), userID, c.Param("id"))
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
				lastMessageID := int64(0)
				if raw := c.Query("after"); raw != "" {
					var e error
					lastMessageID, e = conversation.Cursor(raw)
					if e != nil {
						return
					}
				}
				resume := lastMessageID > 0
				previousSettings := ""
				lastTyping := time.Time{}
				syncHistory := func() error {
					queryCtx, stop := context.WithTimeout(ctx, 5*time.Second)
					defer stop()
					if _, err := chat.Accessible(queryCtx, userID, conv.ID); err != nil {
						return err
					}
					if backend, ok := chat.(durableSocketBackend); ok {
						settings, err := backend.Repo.Settings(queryCtx, conv.ID, userID)
						if err != nil {
							return err
						}
						encoded, err := json.Marshal(settings)
						if err != nil {
							return err
						}
						if string(encoded) != previousSettings {
							if err = write(gin.H{"type": "auto_reply.settings_updated", "settings": settings}); err != nil {
								return err
							}
							previousSettings = string(encoded)
						}
					}
					page, err := chat.History(queryCtx, conv, 0, 50)
					if err != nil {
						return err
					}
					data, err := json.Marshal(page)
					if err != nil {
						return err
					}
					if string(data) != previous {
						if err = write(gin.H{"type": "history", "page": page}); err != nil {
							return err
						}
					}
					events := page.Items
					if backend, ok := chat.(durableSocketBackend); ok && (previous != "" || resume) {
						// A bounded batch is resumed on the next tick even if the snapshot is unchanged.
						events, err = backend.Messages.After(queryCtx, conv, lastMessageID, 200)
						if err != nil {
							return err
						}
					}
					for _, message := range events {
						id, err := strconv.ParseInt(message.ID, 10, 64)
						if err != nil {
							return err
						}
						if (previous != "" || resume) && id > lastMessageID {
							if err = write(gin.H{"type": "message.created", "message": message}); err != nil {
								return err
							}
						}
						if id > lastMessageID {
							lastMessageID = id
						}
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
						if command.Type == "typing" {
							if time.Since(lastTyping) < 2*time.Second {
								continue
							}
							lastTyping = time.Now()
							if backend, ok := chat.(durableSocketBackend); ok {
								if _, e := backend.Accessible(ctx, userID, conv.ID); e != nil {
									return
								}
								_, e := backend.Repo.DB.Exec(ctx, `INSERT INTO conversation_presence(conversation_id,actor_id,expires_at) VALUES($1,$2,now()+interval '5 seconds') ON CONFLICT(conversation_id,actor_id) DO UPDATE SET expires_at=EXCLUDED.expires_at`, conv.ID, userID)
								if e != nil {
									return
								}
							}
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
