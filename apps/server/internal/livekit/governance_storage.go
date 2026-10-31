package livekit

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
	"log/slog"
	"strings"
	"sync"
	"time"
)

// Fixture fallback only; production state is shared in PostgreSQL/Redis.
var localGovernance sync.Map
var localLiveChat sync.Map
var localLiveSettings sync.Map

func (h Handler) governanceKey(r *roomLifecycle) string {
	return h.lifecycleKey(r.ID) + ":governance:" + r.SID
}
func (h Handler) loadGovernance(ctx context.Context, r *roomLifecycle) (*roomGovernance, error) {
	g := &roomGovernance{Members: map[string]*LiveMember{}, Admissions: map[string]liveAdmission{}, Actions: []*LiveAction{}, Settings: defaultLiveSettings(), Receipts: map[string]liveReceipt{}}
	var data []byte
	if db := h.Auth.Service.Repo.DB; db != nil {
		err := db.QueryRow(ctx, `SELECT state FROM live_room_governance WHERE room_sid=$1`, r.SID).Scan(&data)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
	} else if v, ok := localGovernance.Load(h.governanceKey(r)); ok {
		data = v.([]byte)
	}
	if len(data) > 0 {
		if err := json.Unmarshal(data, g); err != nil {
			return nil, err
		}
	} else {
		if db := h.Auth.Service.Repo.DB; db != nil {
			var settings []byte
			err := db.QueryRow(ctx, `SELECT settings FROM live_host_settings WHERE owner_id=$1`, r.OwnerID).Scan(&settings)
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return nil, err
			}
			if len(settings) > 0 {
				if err = json.Unmarshal(settings, &g.Settings); err != nil {
					return nil, err
				}
			}
		} else if v, ok := localLiveSettings.Load(h.lifecycleKey(r.OwnerID)); ok {
			_ = json.Unmarshal(v.([]byte), &g.Settings)
		}
	}
	// Retire only the obsolete host-command confirmation records. Never execute a
	// historical command on upgrade. Normalizing on read also prevents stale
	// clients from approving it; the next serialized save persists the change.
	for _, a := range g.Actions {
		if a.Status == "proposed" && a.Actor == "assistant" &&
			a.RequestID != "" && a.Reason == "主播指令需要确认对象与处理方式" {
			a.Status = "dismissed"
			a.Reason = "旧版主播指令未执行，请在聊天中重新发送；无需二次确认。"
		}
	}
	return g, nil
}
func (h Handler) saveGovernance(ctx context.Context, r *roomLifecycle, g *roomGovernance) error {
	g.Revision++
	cutoff := h.clock().Add(-30 * 24 * time.Hour).UnixMilli()
	kept := g.Actions[:0]
	for _, a := range g.Actions {
		if a.CreatedAt >= cutoff || a.Status == "pending" {
			kept = append(kept, a)
		}
	}
	g.Actions = kept
	for k, v := range g.Receipts {
		if v.At < cutoff || strings.HasPrefix(k, "assistant:") && v.At < h.clock().Add(-30*time.Minute).UnixMilli() {
			delete(g.Receipts, k)
		}
	}
	data, err := json.Marshal(g)
	if err != nil {
		return err
	}
	if db := h.Auth.Service.Repo.DB; db != nil {
		_, err = db.Exec(ctx, `INSERT INTO live_room_governance(room_sid,room_id,state) VALUES($1,$2,$3) ON CONFLICT(room_sid) DO UPDATE SET state=excluded.state,updated_at=now()`, r.SID, r.ID, data)
	} else {
		localGovernance.Store(h.governanceKey(r), data)
	}
	if err != nil {
		return err
	}
	var due int64
	add := func(at int64) {
		if at > 0 && (due == 0 || at < due) {
			due = at
		}
	}
	for _, m := range g.Members {
		if m.Mute != nil {
			add(m.Mute.Until)
		}
	}
	for _, a := range g.Actions {
		if a.Status == "pending" {
			add(h.clock().UnixMilli())
		}
		if a.Status == "failed" {
			add(a.RetryAt)
		}
	}
	if due > 0 && (r.CheckAt == 0 || due < r.CheckAt) {
		r.CheckAt = due
		if err = h.saveLifecycle(ctx, r); err != nil {
			return err
		}
	}
	return h.notifyActivity(ctx, r.ID)
}
func (h Handler) saveLiveSettings(ctx context.Context, r *roomLifecycle, s LiveSettings) error {
	data, err := json.Marshal(s)
	if err != nil {
		return err
	}
	if db := h.Auth.Service.Repo.DB; db != nil {
		_, err = db.Exec(ctx, `INSERT INTO live_host_settings(owner_id,settings) VALUES($1,$2) ON CONFLICT(owner_id) DO UPDATE SET settings=excluded.settings,updated_at=now()`, r.OwnerID, data)
		return err
	}
	localLiveSettings.Store(h.lifecycleKey(r.OwnerID), data)
	return nil
}
func (h Handler) notifyActivity(ctx context.Context, id string) error {
	if h.RoomCache != nil {
		return h.RoomCache.Publish(ctx, h.RoomUpdatesChannel(), id).Err()
	}
	h.publishLocalRoomUpdate(id)
	return nil
}
func (h Handler) loadChatBuffer(ctx context.Context, r *roomLifecycle) (*roomChatBuffer, error) {
	b := &roomChatBuffer{Messages: []LiveChatMessage{}, Buckets: map[string]*liveChatBucket{}, Receipts: map[string]LiveChatMessage{}, AutoUserAt: map[string]int64{}, Rejected: map[string]liveRejectedMessage{}}
	var data []byte
	key := h.governanceKey(r) + ":chat"
	if h.RoomCache != nil {
		var err error
		data, err = h.RoomCache.Get(ctx, key).Bytes()
		if err != nil && !errors.Is(err, redis.Nil) {
			return nil, err
		}
	} else if v, ok := localLiveChat.Load(key); ok {
		data = v.([]byte)
	}
	if len(data) > 0 {
		if err := json.Unmarshal(data, b); err != nil {
			return nil, err
		}
	}
	cutoff := h.clock().Add(-30 * time.Minute).UnixMilli()
	originalCount := len(b.Messages)
	kept := b.Messages[:0]
	for _, m := range b.Messages {
		if m.Time >= cutoff {
			kept = append(kept, m)
		} else {
			b.DroppedSequence = max(b.DroppedSequence, m.Sequence)
			b.DroppedAt = max(b.DroppedAt, m.Time)
		}
	}
	b.Messages = kept
	b.pruned = len(kept) != originalCount
	for k, m := range b.Receipts {
		if m.Time < cutoff {
			delete(b.Receipts, k)
		}
	}
	for k, v := range b.Rejected {
		if v.At < cutoff {
			delete(b.Rejected, k)
		}
	}
	for k, v := range b.Buckets {
		if v.LastAt < cutoff {
			delete(b.Buckets, k)
		}
	}
	return b, nil
}
func (h Handler) saveChatBuffer(ctx context.Context, r *roomLifecycle, b *roomChatBuffer) error {
	// Archive before trimming: the assistant must still be able to find messages
	// after they leave the short-lived browser delivery buffer.
	if err := h.archiveLiveChat(ctx, r, b); err != nil {
		return err
	}
	for len(b.Rejected) > 1000 {
		oldestKey := ""
		var oldestAt int64
		for key, v := range b.Rejected {
			if oldestKey == "" || v.At < oldestAt {
				oldestKey = key
				oldestAt = v.At
			}
		}
		delete(b.Rejected, oldestKey)
	}
	if len(b.Messages) > 1000 {
		dropped := b.Messages[len(b.Messages)-1001]
		b.DroppedSequence = dropped.Sequence
		b.DroppedAt = dropped.Time
		b.Messages = b.Messages[len(b.Messages)-1000:]
	}
	retained := map[string]bool{}
	for _, m := range b.Messages {
		retained[m.ID] = true
	}
	for k, m := range b.Receipts {
		if !retained[m.ID] {
			delete(b.Receipts, k)
		}
	}
	data, err := json.Marshal(b)
	if err != nil {
		return err
	}
	key := h.governanceKey(r) + ":chat"
	// Sequences are time-based, so an expired buffer never resets replay cursors.
	if h.RoomCache != nil {
		err = h.RoomCache.Set(ctx, key, data, 30*time.Minute).Err()
	} else {
		localLiveChat.Store(key, data)
	}
	if err != nil {
		return err
	}
	if len(b.Messages) > 0 {
		due := b.Messages[0].Time + (30 * time.Minute).Milliseconds() + 1
		if r.CheckAt == 0 || due < r.CheckAt {
			r.CheckAt = due
			if err = h.saveLifecycle(ctx, r); err != nil {
				return err
			}
		}
	}
	return h.notifyActivity(ctx, r.ID)
}

func (h Handler) runGovernanceRetention(ctx context.Context) {
	if h.Auth.Service.Repo.DB == nil {
		return
	}
	cleanup := func() {
		work, stop := context.WithTimeout(ctx, 10*time.Second)
		defer stop()
		_, err := h.Auth.Service.Repo.DB.Exec(work, `DELETE FROM live_room_governance WHERE updated_at < now() - interval '30 days'`)
		if err != nil && ctx.Err() == nil {
			slog.Warn("live governance retention failed", "error", err)
		}
	}
	cleanup()
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			cleanup()
		}
	}
}
func activeRestriction(v *LiveRestriction, now int64) bool {
	return v != nil && (v.Until == 0 || v.Until > now)
}
func publicMember(m *LiveMember, now int64) LiveMember {
	v := *m
	v.Subjects = nil
	if !activeRestriction(v.Mute, now) {
		v.Mute = nil
	}
	if !activeRestriction(v.Ban, now) {
		v.Ban = nil
	}
	return v
}
