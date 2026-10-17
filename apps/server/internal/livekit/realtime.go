package livekit

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"companion/server/internal/auth"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"golang.org/x/net/websocket"
)

const RoomSocketPath = "/api/v1/rooms/socket"

type roomSnapshotSource interface {
	CachedRooms(context.Context) ([]RoomItem, error)
	CachedRoom(context.Context, string) (*RoomSnapshot, error)
	SubscribeRoomUpdates(context.Context) (<-chan string, error)
}

// RegisterRealtime exposes public snapshots. Management permissions are computed
// for this connection; no user-specific data is placed on the shared bus.
func RegisterRealtime(r gin.IRouter, cfg Config, authentication auth.Handler, cache *redis.Client, origin string) {
	h := Handler{Client: NewClient(cfg), Auth: authentication, RoomCache: cache}
	r.POST(RoomSocketTicketPath, h.roomSocketTicket(origin))
	r.GET(RoomSocketPath, h.roomSocket(h, origin))
}

func (h Handler) roomSocket(source roomSnapshotSource, origin string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !h.Client.config.Enabled() {
			fail(c, http.StatusServiceUnavailable, "LiveKit is not configured")
			return
		}
		id := c.Query("roomId")
		if id != "" && !roomID.MatchString(id) {
			fail(c, http.StatusBadRequest, "Invalid room id")
			return
		}
		var userID string
		var err error
		if tickets, supplied := c.Request.URL.Query()["ticket"]; supplied {
			if len(tickets) != 1 || c.GetHeader("Origin") != origin {
				err = errors.New("invalid socket ticket")
			} else {
				userID, err = h.verifyRoomSocketTicket(tickets[0], id, origin)
			}
			if err != nil {
				failRoom(c, http.StatusUnauthorized, "socket_ticket_invalid", "连接凭据已失效，请重新连接")
				return
			}
		} else {
			userID, err = h.sessionUser(c)
		}
		if err != nil {
			fail(c, http.StatusUnauthorized, "登录已失效，请重新登录")
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
				// Subscribe before reading, so updates racing with the initial
				// snapshot always leave a notification to consume afterwards.
				changes, err := source.SubscribeRoomUpdates(ctx)
				if err != nil {
					return
				}
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
				write := func(data []byte) error {
					_ = ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
					return websocket.Message.Send(ws, string(data))
				}
				var previous []byte
				snapshot := func() error {
					readCtx, stop := context.WithTimeout(ctx, 5*time.Second)
					defer stop()
					var event any
					if id == "" {
						items, err := source.CachedRooms(readCtx)
						if err != nil {
							return err
						}
						// Copy before personalizing even if a source shares memory.
						items = append([]RoomItem{}, items...)
						for i := range items {
							items[i].CanManage = userID != "" && items[i].OwnerID == userID
						}
						event = gin.H{"type": "rooms.updated", "items": items}
					} else {
						detail, err := source.CachedRoom(readCtx, id)
						if err != nil {
							return err
						}
						if detail == nil {
							event = gin.H{"type": "room.missing", "roomId": id}
						} else {
							copy := *detail
							copy.Item.CanManage = userID != "" && copy.Item.OwnerID == userID
							event = gin.H{"type": "room.updated", "detail": copy}
						}
					}
					data, err := json.Marshal(event)
					if err != nil || bytes.Equal(data, previous) {
						return err
					}
					if err := write(data); err != nil {
						return err
					}
					previous = data
					return nil
				}
				if snapshot() != nil {
					return
				}
				heartbeat := time.NewTicker(20 * time.Second)
				defer heartbeat.Stop()
				for {
					select {
					case <-ctx.Done():
						return
					case changed, open := <-changes:
						if !open {
							return
						}
						if id == "" || changed == "" || changed == id {
							if snapshot() != nil {
								return
							}
						}
					case <-heartbeat.C:
						if write([]byte(`{"type":"ping"}`)) != nil {
							return
						}
					}
				}
			},
		}
		server.ServeHTTP(c.Writer, c.Request)
	}
}
