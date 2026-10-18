package livekit

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"strings"
	"sync"
	"time"

	"companion/server/internal/auth"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"
)

const WebhookPath = "/api/v1/livekit/webhook"
const webhookBodyLimit = 1 << 20
const webhookReceiptTTL = 24 * time.Hour

type webhookEnvelope struct {
	ID    string `json:"id"`
	Event string `json:"event"`
	Room  struct {
		Name string `json:"name"`
		SID  string `json:"sid"`
	} `json:"room"`
	Participant struct {
		SID      string `json:"sid"`
		Identity string `json:"identity"`
	} `json:"participant"`
}

type webhookClaims struct {
	jwt.RegisteredClaims
	SHA256 string `json:"sha256"`
}

// LiveKit signs the exact request bytes with an HS256 JWT containing a standard
// base64 SHA-256 checksum. Keep this compatible with protocol/webhook/verifier.go;
// parsing and re-encoding JSON before checking its checksum would reject events.
func verifyWebhook(cfg Config, r *http.Request) (webhookEnvelope, error) {
	var event webhookEnvelope
	data, err := io.ReadAll(io.LimitReader(r.Body, webhookBodyLimit+1))
	if err != nil || len(data) > webhookBodyLimit {
		return event, fmt.Errorf("invalid webhook body")
	}
	claims := &webhookClaims{}
	raw := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	_, err = jwt.ParseWithClaims(raw, claims, func(_ *jwt.Token) (any, error) {
		return []byte(cfg.APISecret), nil
	}, jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer(cfg.APIKey), jwt.WithExpirationRequired())
	if err != nil {
		return event, fmt.Errorf("invalid webhook signature")
	}
	sum := sha256.Sum256(data)
	expected := base64.StdEncoding.EncodeToString(sum[:])
	if subtle.ConstantTimeCompare([]byte(expected), []byte(claims.SHA256)) != 1 {
		return event, fmt.Errorf("invalid webhook checksum")
	}
	if err := json.Unmarshal(data, &event); err != nil || event.ID == "" || len(event.ID) > 128 || event.Event == "" {
		return event, fmt.Errorf("invalid webhook event")
	}
	return event, nil
}

// The in-process receipt store is only used by fixtures without Redis. Production
// receipts are shared across replicas; lifecycle operations are also idempotent
// under their existing database locks if two deliveries arrive simultaneously.
var localWebhookReceipts = struct {
	sync.Mutex
	items map[string]time.Time
}{items: make(map[string]time.Time)}

func (h Handler) webhookReceiptKey(id string) string {
	scope := sha256.Sum256([]byte(h.Client.config.URL + "\x00" + h.Client.config.APIKey))
	return fmt.Sprintf("livekit:webhook:%x:%s", scope[:16], id)
}

func (h Handler) receivedWebhook(ctx context.Context, id string) (bool, error) {
	key := h.webhookReceiptKey(id)
	if h.RoomCache != nil {
		count, err := h.RoomCache.Exists(ctx, key).Result()
		return count > 0, err
	}
	localWebhookReceipts.Lock()
	defer localWebhookReceipts.Unlock()
	return time.Now().Before(localWebhookReceipts.items[key]), nil
}

func (h Handler) saveWebhookReceipt(ctx context.Context, id string) error {
	key := h.webhookReceiptKey(id)
	if h.RoomCache != nil {
		return h.RoomCache.Set(ctx, key, "1", webhookReceiptTTL).Err()
	}
	localWebhookReceipts.Lock()
	defer localWebhookReceipts.Unlock()
	now := time.Now()
	for key, expires := range localWebhookReceipts.items {
		if !now.Before(expires) {
			delete(localWebhookReceipts.items, key)
		}
	}
	localWebhookReceipts.items[key] = now.Add(webhookReceiptTTL)
	return nil
}

func RegisterWebhook(r gin.IRouter, cfg Config, authentication auth.Handler, cache *redis.Client) {
	h := Handler{Client: NewClient(cfg), Auth: authentication, RoomCache: cache}
	r.POST(WebhookPath, h.webhook(h.ReconcileRoomEvent))
}

func (h Handler) webhook(reconcile func(context.Context, RoomLifecycleEvent) error) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !h.Client.config.Enabled() {
			fail(c, http.StatusServiceUnavailable, "LiveKit is not configured")
			return
		}
		mediaType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
		if err != nil || (mediaType != "application/webhook+json" && mediaType != "application/json") {
			fail(c, http.StatusUnsupportedMediaType, "Invalid webhook content type")
			return
		}
		event, err := verifyWebhook(h.Client.config, c.Request)
		if err != nil {
			fail(c, http.StatusUnauthorized, "Invalid LiveKit webhook")
			return
		}
		switch event.Event {
		case "room_started", "room_finished", "participant_joined", "participant_left", "participant_connection_aborted", "track_published", "track_unpublished":
		default:
			// Acknowledge unrelated events without changing room lifecycle state.
			c.Status(http.StatusNoContent)
			return
		}
		roomEvent := event.Event == "room_started" || event.Event == "room_finished"
		if !roomID.MatchString(event.Room.Name) || event.Room.SID == "" ||
			(!roomEvent && (event.Participant.SID == "" || event.Participant.Identity == "")) {
			fail(c, http.StatusBadRequest, "Invalid LiveKit room event")
			return
		}
		ctx := c.Request.Context()
		received, err := h.receivedWebhook(ctx, event.ID)
		if err == nil && !received {
			err = reconcile(ctx, RoomLifecycleEvent{
				Event: event.Event, RoomID: event.Room.Name, RoomSID: event.Room.SID,
				ParticipantSID: event.Participant.SID, Identity: event.Participant.Identity,
			})
			if err == nil {
				err = h.saveWebhookReceipt(ctx, event.ID)
			}
		}
		if err != nil {
			// LiveKit retries failed deliveries. Persisted closing tasks retry
			// known failed closes; observation deadlines repair missed events.
			slog.Warn("LiveKit webhook processing failed", "event", event.Event, "error", err)
			fail(c, http.StatusServiceUnavailable, "Webhook processing is temporarily unavailable")
			return
		}
		c.Status(http.StatusNoContent)
	}
}
