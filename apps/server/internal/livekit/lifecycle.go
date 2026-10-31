package livekit

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"companion/server/pkg/database"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

const (
	hostJoinLifetime     = time.Minute
	hostPendingLifetime  = 90 * time.Second
	hostRecoveryLifetime = 60 * time.Second
	closedRoomRetention  = 24 * time.Hour
)

// RoomLifecycleEvent is accepted only after the webhook transport verifies it.
// Events are hints: room and participant SIDs are checked against live state.
type RoomLifecycleEvent struct {
	Event, RoomID, RoomSID, ParticipantSID, Identity string
}

type hostAdmission struct {
	AttemptID    string `json:"attemptId"`
	Identity     string `json:"identity"`
	Name         string `json:"name"`
	SID          string `json:"sid,omitempty"`
	IssuedAt     int64  `json:"issuedAt"`
	ExpiresAt    int64  `json:"expiresAt"`
	PendingUntil int64  `json:"pendingUntil"`
}

type roomLifecycle struct {
	ID                string         `json:"id"`
	SID               string         `json:"sid"`
	SessionVersion    int64          `json:"sessionVersion"`
	OwnerID           string         `json:"ownerId"`
	Title             string         `json:"title"`
	Status            string         `json:"status"`
	Viewers           int            `json:"viewers"`
	State             string         `json:"state"`
	Reason            string         `json:"reason,omitempty"`
	HadHost           bool           `json:"hadHost"`
	Host              *hostAdmission `json:"host,omitempty"`
	ClosedAt          int64          `json:"closedAt,omitempty"`
	RetryAt           int64          `json:"retryAt,omitempty"`
	Retries           int            `json:"retries,omitempty"`
	HostConnection    string         `json:"hostConnection,omitempty"`
	ReconnectDeadline int64          `json:"reconnectDeadline,omitempty"`
	CheckAt           int64          `json:"checkAt,omitempty"`
	CheckRetries      int            `json:"checkRetries,omitempty"`
}

// The process fallback is for local fixtures without Redis. Production always
// supplies Redis and database advisory locks, so replicas share admissions.
var localRoomLifecycles = struct {
	sync.Mutex
	items map[string]roomLifecycle
}{items: make(map[string]roomLifecycle)}

func (h Handler) lifecycleKey(id string) string { return h.ownerRoomKey("") + ":lifecycle:" + id }
func (h Handler) lifecycleIndexKey() string     { return h.ownerRoomKey("") + ":active-rooms" }
func (h Handler) clock() time.Time {
	if h.now != nil {
		return h.now()
	}
	return time.Now()
}

func (h Handler) loadLifecycle(ctx context.Context, id string) (*roomLifecycle, error) {
	key := h.lifecycleKey(id)
	var data []byte
	if h.RoomCache == nil {
		localRoomLifecycles.Lock()
		record, ok := localRoomLifecycles.items[key]
		if ok && record.ClosedAt > 0 && h.clock().Unix() >= record.ClosedAt+int64(closedRoomRetention.Seconds()) {
			delete(localRoomLifecycles.items, key)
			ok = false
		}
		// Copy nested admission, not a pointer shared between handlers.
		if ok {
			data, _ = json.Marshal(record)
		}
		localRoomLifecycles.Unlock()
		if !ok {
			return nil, nil
		}
	} else {
		var err error
		data, err = h.RoomCache.Get(ctx, key).Bytes()
		if errors.Is(err, redis.Nil) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
	}
	var record roomLifecycle
	if err := json.Unmarshal(data, &record); err != nil {
		return nil, err
	}
	return &record, nil
}

func (h Handler) saveLifecycle(ctx context.Context, record *roomLifecycle) error {
	if record.State == "open" && record.CheckAt == 0 {
		delay := time.Minute
		if !record.HadHost {
			delay = 10 * time.Minute
		}
		record.CheckAt = h.clock().Add(delay).UnixMilli()
	}
	if record.State == "open" && record.ReconnectDeadline > h.clock().UnixMilli() && record.CheckAt > record.ReconnectDeadline {
		record.CheckAt = record.ReconnectDeadline
	}
	data, err := json.Marshal(record)
	if err != nil {
		return err
	}
	if h.RoomCache == nil {
		var copy roomLifecycle
		_ = json.Unmarshal(data, &copy)
		localRoomLifecycles.Lock()
		localRoomLifecycles.items[h.lifecycleKey(record.ID)] = copy
		localRoomLifecycles.Unlock()
		h.publishLocalRoomUpdate(record.ID)
		return nil
	}
	ttl := time.Duration(0)
	if record.State == "closed" {
		ttl = closedRoomRetention
	}
	_, err = h.RoomCache.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
		pipe.Set(ctx, h.lifecycleKey(record.ID), data, ttl)
		if record.State == "closed" {
			pipe.SRem(ctx, h.lifecycleIndexKey(), record.ID)
		} else {
			pipe.SAdd(ctx, h.lifecycleIndexKey(), record.ID)
		}
		if record.State == "closing" && record.RetryAt > 0 {
			pipe.ZAdd(ctx, h.closeRetryKey(), redis.Z{Score: float64(record.RetryAt), Member: record.ID})
		} else {
			pipe.ZRem(ctx, h.closeRetryKey(), record.ID)
		}
		if record.State == "open" {
			pipe.ZAdd(ctx, h.checkQueueKey(), redis.Z{Score: float64(record.CheckAt), Member: record.ID})
		} else {
			pipe.ZRem(ctx, h.checkQueueKey(), record.ID)
		}
		pipe.Publish(ctx, h.RoomUpdatesChannel(), record.ID)
		return nil
	})
	return err
}

// A browser may join as soon as LiveKit has created the room, before CreateRoom
// returns. Initialize without overwriting an admission established meanwhile.
func (h Handler) initLifecycle(ctx context.Context, item RoomItem) error {
	record := lifecycleForRoom(item)
	record.CheckAt = h.clock().Add(10 * time.Minute).UnixMilli()
	if h.RoomCache == nil {
		localRoomLifecycles.Lock()
		key := h.lifecycleKey(item.ID)
		if _, exists := localRoomLifecycles.items[key]; !exists {
			localRoomLifecycles.items[key] = *record
		}
		localRoomLifecycles.Unlock()
		h.publishLocalRoomUpdate(item.ID)
		return nil
	}
	data, err := json.Marshal(record)
	if err != nil {
		return err
	}
	_, err = h.RoomCache.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
		pipe.SetNX(ctx, h.lifecycleKey(item.ID), data, 0)
		pipe.SAdd(ctx, h.lifecycleIndexKey(), item.ID)
		pipe.ZAddNX(ctx, h.checkQueueKey(), redis.Z{Score: float64(record.CheckAt), Member: item.ID})
		pipe.Publish(ctx, h.RoomUpdatesChannel(), item.ID)
		return nil
	})
	return err
}

func (h Handler) lifecycleRoomIDs(ctx context.Context) ([]string, error) {
	if h.RoomCache != nil {
		return h.RoomCache.SMembers(ctx, h.lifecycleIndexKey()).Result()
	}
	localRoomLifecycles.Lock()
	defer localRoomLifecycles.Unlock()
	var ids []string
	prefix := h.lifecycleKey("")
	for key, r := range localRoomLifecycles.items {
		if strings.HasPrefix(key, prefix) && r.State != "closed" {
			ids = append(ids, r.ID)
		}
	}
	return ids, nil
}

func lifecycleForRoom(item RoomItem) *roomLifecycle {
	return &roomLifecycle{ID: item.ID, SID: item.SID, OwnerID: item.OwnerID, SessionVersion: item.SessionVersion, Title: item.Title, Status: item.Status, Viewers: item.Viewers, State: "open", HostConnection: "waiting"}
}

func (h Handler) hostRestored(r *roomLifecycle) {
	if r.ReconnectDeadline != 0 {
		slog.Info("room host recovered", "room", r.ID)
	}
	r.HadHost, r.HostConnection, r.ReconnectDeadline = true, "connected", 0
	r.Host.PendingUntil = 0
	r.CheckAt = h.clock().Add(time.Minute).UnixMilli()
}

func (h Handler) hostAbsent(r *roomLifecycle) {
	if r.ReconnectDeadline == 0 {
		r.ReconnectDeadline = h.clock().Add(hostRecoveryLifetime).UnixMilli()
		slog.Info("room host recovery started", "room", r.ID, "deadline", r.ReconnectDeadline)
	}
	r.HostConnection = "reconnecting"
	r.CheckAt = r.ReconnectDeadline
}

func (r *roomLifecycle) item() RoomItem {
	status := r.Status
	if status == "" {
		status = "准备中"
	}
	return RoomItem{ID: r.ID, SID: r.SID, OwnerID: r.OwnerID, Title: r.Title, Status: status, Viewers: r.Viewers}
}

func ownerParticipant(p voiceParticipant, owner string) bool {
	return owner != "" && p.online() && p.human() && (p.Identity == "host_"+owner || strings.HasPrefix(p.Identity, "host_"+owner+"_"))
}

func hostConnected(p voiceParticipant) bool {
	// Proto JSON can omit the zero-valued JOINING state. Only ACTIVE proves a
	// completed connection; JOINING/JOINED still reserve the admission slot.
	return string(p.State) == "2" || string(p.State) == `"ACTIVE"`
}

func (h Handler) filterLifecycleRooms(ctx context.Context, items []RoomItem) ([]RoomItem, error) {
	filtered := make([]RoomItem, 0, len(items))
	for _, item := range items {
		record, err := h.loadLifecycle(ctx, item.ID)
		if err != nil {
			return nil, err
		}
		if record != nil && (record.State != "open" || (record.SID != "" && item.SID != record.SID)) {
			continue
		}
		filtered = append(filtered, item)
	}
	return filtered, nil
}

func failRoom(c *gin.Context, status int, code, message string) {
	c.JSON(status, gin.H{"error": gin.H{"code": code, "message": message}})
}

func closedRoom(c *gin.Context) {
	failRoom(c, http.StatusGone, "room_closed", "直播间已结束，请返回直播大厅")
}
func missingRoom(c *gin.Context) {
	failRoom(c, http.StatusNotFound, "room_not_found", "直播间已关闭或不存在")
}
func busyHost(c *gin.Context) {
	failRoom(c, http.StatusConflict, "host_session_in_use", "该直播间已在其他页面或设备打开，请回到原页面继续")
}

// Called with the shared room lock. A token request is not proof of presence.
func (h Handler) admitHost(ctx context.Context, item RoomItem, attempt, name string) (*hostAdmission, error) {
	record, err := h.loadLifecycle(ctx, item.ID)
	if err != nil {
		return nil, err
	}
	if record == nil {
		record = lifecycleForRoom(item)
	}
	if record.State != "open" || (record.SID != "" && record.SID != item.SID) {
		return nil, errRoomClosed
	}
	people, err := h.Client.ListParticipants(ctx, item.ID)
	if err != nil {
		return nil, err
	}
	for _, p := range people {
		if ownerParticipant(p, item.OwnerID) {
			// Adopt a host that joined before this deployment/reservation existed.
			if record.Host == nil || record.Host.Identity == p.Identity {
				if record.Host == nil {
					record.Host = &hostAdmission{Identity: p.Identity}
				}
				record.Host.SID = p.SID
				if hostConnected(p) {
					h.hostRestored(record)
				}
				if err := h.saveLifecycle(ctx, record); err != nil {
					return nil, err
				}
			}
			return nil, errHostBusy
		}
	}
	if record.HadHost {
		h.hostAbsent(record)
		if h.clock().UnixMilli() >= record.ReconnectDeadline {
			return nil, errRoomClosed
		}
	}
	now := h.clock().Unix()
	if current := record.Host; current != nil && now < current.PendingUntil {
		if attempt == current.AttemptID && now < current.ExpiresAt {
			return current, nil
		}
		return nil, &hostPendingError{Until: current.PendingUntil * 1000}
	}
	if attempt == "" {
		attempt = database.ID()
	}
	if name == "" {
		name = "主播"
	}
	admission := &hostAdmission{AttemptID: attempt, Identity: "host_" + item.OwnerID + "_" + database.ID()[:12], Name: name,
		IssuedAt: now, ExpiresAt: now + int64(hostJoinLifetime.Seconds()), PendingUntil: now + int64(hostPendingLifetime.Seconds())}
	if record.HadHost {
		// A lost recovery admission must leave time for another attempt. Initial
		// admission retains its independent 90-second protection.
		admission.ExpiresAt = min(now+10, record.ReconnectDeadline/1000)
		admission.PendingUntil = min(now+15, record.ReconnectDeadline/1000)
	}
	record.Host = admission
	if err := h.saveLifecycle(ctx, record); err != nil {
		return nil, err
	}
	return admission, nil
}

var errHostBusy = errors.New("host session in use")
var errRoomClosed = errors.New("room closed")

type hostPendingError struct{ Until int64 }

func (e *hostPendingError) Error() string { return "host admission pending" }

func (c *Client) hostJoinToken(room string, host *hostAdmission) (string, error) {
	return c.tokenAt(host.Identity, host.Name, map[string]any{"roomJoin": true, "room": room, "canPublish": true, "canSubscribe": true, "canPublishData": true},
		time.Unix(host.IssuedAt, 0), time.Unix(host.ExpiresAt, 0))
}

// ReconcileRoom uses server observations, never browser visibility/heartbeats.
func (h Handler) ReconcileRoom(ctx context.Context, roomID string) error {
	return h.ReconcileRoomEvent(ctx, RoomLifecycleEvent{RoomID: roomID})
}

func (h Handler) ReconcileRoomEvent(ctx context.Context, event RoomLifecycleEvent) error {
	if !roomID.MatchString(event.RoomID) {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	// Normal observations hold only this room's lock. Global creation/owner
	// coordination is acquired only if a close actually needs to be completed.
	unlock, err := h.lockVoice(ctx, event.RoomID)
	if err != nil {
		return err
	}
	err = h.reconcileRoomLocked(ctx, event)
	unlock()
	if errors.Is(err, errCloseRequired) {
		return h.retryRoomClose(ctx, event.RoomID)
	}
	return err
}

func (h Handler) reconcileRoomLocked(ctx context.Context, event RoomLifecycleEvent) error {
	record, err := h.loadLifecycle(ctx, event.RoomID)
	if err != nil {
		return err
	}
	current, err := h.exactRoom(ctx, event.RoomID)
	if err != nil {
		return err
	}
	if event.RoomSID != "" {
		if record != nil && record.SID != "" && event.RoomSID != record.SID {
			// A new event for an ownerless room implicitly recreated by an old
			// token can retire that transport. Old events never touch a new SID.
			if record.State == "open" || current == nil || current.SID != event.RoomSID || current.OwnerID != "" {
				return nil
			}
		}
		if current != nil && current.SID != "" && event.RoomSID != current.SID {
			return nil
		}
	}
	if current == nil {
		if record == nil {
			return nil
		}
		if record.State == "closed" {
			return nil
		}
		return h.queueRoomClose(ctx, record, "room_finished")
	}
	if record == nil {
		record = lifecycleForRoom(*current)
	}
	if record.SID != "" && record.SID != current.SID && record.State == "open" {
		// Never apply a departed session's lifecycle to a different room SID.
		return h.queueRoomClose(ctx, record, "room_finished")
	}
	record.Title, record.Status, record.Viewers = current.Title, current.Status, current.Viewers
	if record.State != "open" {
		// Token-based implicit recreation has no owner metadata. A separately
		// provisioned room with its own owner is not ours to delete by old SID.
		if record.SID != "" && record.SID != current.SID && current.OwnerID != "" {
			return nil
		}
		return h.queueRoomClose(ctx, record, "room_finished")
	}
	if record.OwnerID == "" {
		record.CheckAt = h.clock().Add(time.Minute).UnixMilli()
		return h.saveLifecycle(ctx, record)
	}
	people, err := h.Client.ListParticipants(ctx, event.RoomID)
	if err != nil {
		return err
	}
	// ListRooms aggregates can lag the event that triggered this reconciliation.
	// Participant state/tracks are the same live facts used for host admission.
	record.Viewers, record.Status = 0, "准备中"
	for _, p := range people {
		if !p.online() || p.Permission.Hidden {
			continue
		}
		record.Viewers++
		if len(p.Tracks) > 0 {
			record.Status = "直播中"
		}
	}
	// Deterministic adoption for pre-existing rooms. New admissions always have
	// a reserved identity before the browser receives its credential.
	sort.Slice(people, func(i, j int) bool { return people[i].Identity < people[j].Identity })
	var host *voiceParticipant
	for i := range people {
		p := &people[i]
		if !ownerParticipant(*p, record.OwnerID) {
			continue
		}
		if record.Host == nil {
			record.Host = &hostAdmission{Identity: p.Identity}
		}
		if p.Identity == record.Host.Identity {
			host = p
			continue
		}
		// An expired/replayed admission cannot create a second accepted host.
		if err := h.Client.removeParticipant(ctx, event.RoomID, p.Identity); err != nil {
			return err
		}
	}
	if host != nil {
		joinedEvent := record.Host.SID == "" && event.Event == "participant_joined" && event.Identity == host.Identity && event.ParticipantSID == host.SID
		record.Host.SID = host.SID
		if hostConnected(*host) || joinedEvent {
			h.hostRestored(record)
		} else if record.ReconnectDeadline > 0 && h.clock().UnixMilli() >= record.ReconnectDeadline {
			return h.queueRoomClose(ctx, record, "host_left")
		}
		if err := h.saveLifecycle(ctx, record); err != nil {
			return err
		}
		_, err = h.reconcileVoice(ctx, event.RoomID, people)
		return err
	}
	if event.Identity != "" && record.Host != nil {
		// Ignore delayed events from another admission or an older SDK session.
		if event.Identity != record.Host.Identity || (record.Host.SID != "" && event.ParticipantSID != record.Host.SID) {
			return nil
		}
		if event.ParticipantSID != "" && (event.Event == "participant_joined" || event.Event == "participant_left") {
			// A repeated/out-of-order join for an already observed session is
			// not fresh presence. It must not erase a later recovery deadline.
			if event.Event == "participant_joined" && record.Host.SID != "" {
				return nil
			}
			record.HadHost = true // also covers a short session absent from this RPC
			record.Host.SID = event.ParticipantSID
			record.Host.PendingUntil = 0
			if event.Event == "participant_joined" {
				// A signed join event can precede participant-list visibility.
				// Record the completed join; don't turn that lag into a departure.
				h.hostRestored(record)
				return h.saveLifecycle(ctx, record)
			}
		}
	}
	if record.HadHost {
		h.hostAbsent(record)
		if h.clock().UnixMilli() >= record.ReconnectDeadline {
			slog.Info("room host recovery expired", "room", record.ID)
			return h.queueRoomClose(ctx, record, "host_left")
		}
	}
	if event.Event == "room_finished" {
		return h.queueRoomClose(ctx, record, "room_finished")
	}
	if !record.HadHost && record.Host != nil && h.clock().Unix() >= record.Host.PendingUntil {
		record.Host = nil
	}
	if !record.HadHost && record.CheckAt > 0 && record.CheckAt <= h.clock().UnixMilli() {
		record.CheckAt = h.clock().Add(time.Minute).UnixMilli()
	}
	if err := h.saveLifecycle(ctx, record); err != nil {
		return err
	}
	_, err = h.reconcileVoice(ctx, event.RoomID, people)
	return err
}

func (c *Client) removeParticipant(ctx context.Context, room, identity string) error {
	return c.call(ctx, "RoomService", "RemoveParticipant", adminGrant(room), map[string]string{"room": room, "identity": identity}, nil)
}

// Called with creation and room locks. Persist the intent before upstream
// deletion, keeping joins blocked across lost responses and process restarts.
func (h Handler) deleteLifecycleRoom(ctx context.Context, record *roomLifecycle, reason string) error {
	if err := h.queueRoomClose(ctx, record, reason); !errors.Is(err, errCloseRequired) {
		return err
	}
	return h.attemptCloseLocked(ctx, record)
}

func (h Handler) finishClosedRoom(ctx context.Context, record *roomLifecycle, reason string) error {
	if record.OwnerID != "" {
		if err := h.releaseResources(ctx, record.OwnerID, ownerRoom{ID: record.ID, Title: record.Title}); err != nil {
			return err
		}
	}

	if record.Reason == "" {
		record.Reason = reason
	}
	record.State, record.Host = "closed", nil
	record.RetryAt, record.Retries = 0, 0
	if record.ClosedAt == 0 {
		record.ClosedAt = h.clock().Unix()
	}
	return h.saveLifecycle(ctx, record)
}

func (h Handler) roomDetail(c *gin.Context) {
	snapshot, err := h.CachedRoom(c.Request.Context(), c.Param("roomId"))
	if cachedRoomsFailed(c, err) {
		return
	}
	if snapshot == nil {
		missingRoom(c)
		return
	}
	userID, _ := h.sessionUser(c)
	snapshot.Item.CanManage = userID != "" && snapshot.Item.OwnerID == userID
	c.JSON(http.StatusOK, snapshot)
}

func (h Handler) presence(c *gin.Context) {
	// voiceActor verifies the signed participant identity and the owner's login.
	actor, ok := h.voiceActor(c)
	if !ok {
		return
	}
	if actor.Role != "host" {
		fail(c, http.StatusForbidden, "只有主播可以确认连接")
		return
	}
	if upstreamFailed(c, h.ReconcileRoom(c.Request.Context(), c.Param("roomId"))) {
		return
	}
	record, err := h.loadLifecycle(c.Request.Context(), c.Param("roomId"))
	if upstreamFailed(c, err) {
		return
	}
	if record == nil || record.State != "open" {
		closedRoom(c)
		return
	}
	if record.Host == nil || record.Host.Identity != actor.Subject || record.HostConnection != "connected" {
		failRoom(c, http.StatusConflict, "host_not_connected", "主播连接尚未确认，请稍后重试")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
