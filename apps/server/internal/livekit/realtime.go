package livekit

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"companion/server/internal/auth"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
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
		var memberClaims *liveRoomClaims
		var err error
		if tickets, supplied := c.Request.URL.Query()["ticket"]; supplied {
			if len(tickets) != 1 || c.GetHeader("Origin") != origin {
				err = errors.New("invalid socket ticket")
			} else {
				var session auth.Session
				session, err = h.verifyRoomSocketSession(c.Request.Context(), tickets[0], id, origin)
				userID = session.UserID
				if err == nil && userID != "" {
					h.Auth.Service.BindSession(c, session)
				}
				if err == nil {
					claims := &roomSocketTicketClaims{}
					_, err = jwt.ParseWithClaims(tickets[0], claims, func(*jwt.Token) (any, error) { return h.roomSocketTicketKey(), nil }, jwt.WithValidMethods([]string{"HS256"}), jwt.WithTimeFunc(h.clock))
					memberClaims = claims.Member
				}
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
		if !h.allowRate(c, "ip", c.ClientIP(), h.limit("ip_total")) || !h.allowAccountRate(c, "socket", userID) {
			return
		}
		lease, ok := h.acquireRoomLease(c, userID)
		if !ok {
			return
		}
		defer lease.release()
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
					if err := auth.CheckConnection(c, ctx); err != nil {
						if errors.Is(err, auth.ErrInvalidSession) {
							_ = ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
							_ = websocket.Message.Send(ws, `{"type":"session.invalidated"}`)
						}
						return err
					}
					_ = ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
					return websocket.Message.Send(ws, string(data))
				}
				var previous []byte
				after, _ := strconv.ParseInt(c.Query("after"), 10, 64)
				var previousActivity []byte
				activity := func() error {
					if memberClaims == nil {
						return nil
					}
					r, err := h.loadLifecycle(ctx, id)
					if err != nil {
						return err
					}
					if r == nil {
						return errors.New("room missing")
					}
					g, err := h.loadGovernance(ctx, r)
					if err != nil {
						return err
					}
					view, err := h.activityView(ctx, r, g, memberClaims, after)
					if err != nil {
						return err
					}
					data, err := json.Marshal(view)
					if err != nil {
						return err
					}
					if bytes.Equal(data, previousActivity) {
						return nil
					}
					if err = write(data); err != nil {
						return err
					}
					after = view.Sequence
					previousActivity = data
					return nil
				}
				snapshot := func() error {
					if err := auth.CheckConnection(c, ctx); err != nil {
						return write([]byte(`{"type":"ping"}`))
					}
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
				if activity() != nil {
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
							if activity() != nil {
								return
							}
						}
					case <-heartbeat.C:
						if activity() != nil {
							return
						}
						leaseCtx, stop := context.WithTimeout(ctx, 2*time.Second)
						valid := lease.renew(leaseCtx)
						stop()
						if !valid {
							return
						}
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
