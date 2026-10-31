package livekit

import (
	"companion/server/pkg/database"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"log/slog"
	"slices"
	"strings"
	"time"
	"unicode/utf16"
)

type liveModerationInput struct {
	RequestID string `json:"requestId"`
	MemberID  string `json:"memberId"`
	Kind      string `json:"kind"`
	Duration  int    `json:"duration"`
	Reason    string `json:"reason"`
	ActionID  string `json:"actionId"`
}

func (h Handler) registerGovernance(rooms *gin.RouterGroup) {
	rooms.GET("/:roomId/activity", h.activityHTTP)
	rooms.POST("/:roomId/messages", h.sendLiveMessage)
	rooms.PATCH("/:roomId/members/me", h.renameLiveMember)
	rooms.POST("/:roomId/moderation", h.moderateLiveMember)
	rooms.PATCH("/:roomId/settings", h.updateLiveSettings)
}
func (h Handler) liveReceipt(c *gin.Context, g *roomGovernance, actor, id string, input any) (string, bool) {
	if !voiceRequestID.MatchString(id) {
		fail(c, 400, "无效的请求编号")
		return "", false
	}
	key := actor + ":" + id
	if receipt, ok := g.Receipts[key]; ok {
		if receipt.Hash != liveHash(input) {
			fail(c, 409, "请求编号已用于其他操作")
		} else {
			c.Data(200, "application/json", receipt.Result)
		}
		return key, false
	}
	return key, true
}
func (h Handler) finishLiveMutation(c *gin.Context, r *roomLifecycle, g *roomGovernance, key string, input, result any) {
	data, _ := json.Marshal(result)
	g.Receipts[key] = liveReceipt{Hash: liveHash(input), At: h.clock().UnixMilli(), Result: data}
	if !upstreamFailed(c, h.saveGovernance(c.Request.Context(), r, g)) {
		c.Data(200, "application/json", data)
	}
}
func (h Handler) moderateLiveMember(c *gin.Context) {
	var in liveModerationInput
	if bindLiveInput(c, &in) != nil {
		fail(c, 400, "无效的管理操作")
		return
	}
	h.liveOperation(c, true, true, func(r *roomLifecycle, g *roomGovernance, actor *LiveMember, _ *liveRoomClaims) {
		key, ok := h.liveReceipt(c, g, actor.ID, in.RequestID, in)
		if !ok {
			return
		}
		a, err := h.changeModeration(c.Request.Context(), r, g, actor.ID, in)
		if err != nil {
			fail(c, 400, err.Error())
			return
		}
		h.finishLiveMutation(c, r, g, key, in, gin.H{"action": a})
	})
}
func (h Handler) changeModeration(ctx context.Context, r *roomLifecycle, g *roomGovernance, actor string, in liveModerationInput) (*LiveAction, error) {
	if receipt, ok := g.Receipts[actor+":"+in.RequestID]; ok {
		if receipt.Hash != liveHash(in) {
			return nil, errors.New("请求编号已用于其他操作")
		}
		var result struct {
			Action *LiveAction `json:"action"`
		}
		if json.Unmarshal(receipt.Result, &result) == nil && result.Action != nil {
			for _, a := range g.Actions {
				if a.ID == result.Action.ID {
					return a, nil
				}
			}
		}
	}
	now := h.clock().UnixMilli()
	var a *LiveAction
	if in.ActionID != "" {
		for _, item := range g.Actions {
			if item.ID == in.ActionID {
				a = item
				break
			}
		}
		if a == nil {
			return nil, errors.New("管理记录不存在")
		}
	}
	if in.Kind == "retry" || in.Kind == "approve" || in.Kind == "dismiss" || in.Kind == "revoke" {
		if a == nil {
			return nil, errors.New("请选择具体的管理记录")
		}
		switch in.Kind {
		case "dismiss":
			if a.Status != "proposed" {
				return nil, errors.New("建议已处理")
			}
			a.Status = "dismissed"
		case "approve":
			if a.Status != "proposed" {
				return nil, errors.New("建议已处理")
			}
			targetID := a.MemberID
			if targetID == "" {
				targetID = in.MemberID
			}
			target := g.Members[targetID]
			if target == nil || target.Role != "viewer" {
				return nil, errors.New("请选择需要管理的观众")
			}
			a.MemberID = target.ID
			a.Name = memberLabel(target)
			a.Status = "pending"
			a.Actor = actor
			if a.Kind == "mute" {
				a.Until = now + 300000
			}
			h.applyRestriction(g, a)
		case "retry":
			if a.Status != "failed" && a.Status != "pending" {
				return nil, errors.New("操作无需重试")
			}
			a.Status = "pending"
		case "revoke":
			m := g.Members[a.MemberID]
			if m == nil {
				return nil, errors.New("成员不存在")
			}
			if a.Status == "proposed" || a.Status == "dismissed" {
				return nil, errors.New("尚未执行的建议不能撤销")
			}
			for _, target := range g.Members {
				if a.Kind == "mute" && target.Mute != nil && target.Mute.ActionID == a.ID {
					target.Mute = nil
				}
				if a.Kind == "kick" && target.Ban != nil && target.Ban.ActionID == a.ID {
					target.Ban = nil
				}
			}
			a.Status = "revoked"
			a.RetryAt = 0
			// Expired/old sanctions never clear a newer sanction. Unmuting never grants media.
		}
	} else {
		m := g.Members[in.MemberID]
		if m == nil || m.Role != "viewer" {
			return nil, errors.New("只能管理观众")
		}
		if in.Kind != "mute" && in.Kind != "kick" {
			return nil, errors.New("不支持的管理操作")
		}
		if in.Duration != 0 && in.Duration != 300 && in.Duration != 1800 {
			return nil, errors.New("请选择 5 分钟、30 分钟或本场直播")
		}
		reason := strings.TrimSpace(in.Reason)
		if reason == "" {
			reason = "主播管理"
		}
		if len(utf16.Encode([]rune(reason))) > 200 {
			return nil, errors.New("原因不能超过 200 个字符")
		}
		a = &LiveAction{ID: database.ID(), RequestID: in.RequestID, MemberID: m.ID, Name: memberLabel(m), Kind: in.Kind, Actor: actor, Reason: reason, Evidence: []string{}, Status: "pending", CreatedAt: now}
		if in.Kind == "mute" && in.Duration > 0 {
			a.Until = now + int64(in.Duration)*1000
		}
		g.Actions = append(g.Actions, a)
		h.applyRestriction(g, a)
	}
	// The durable desired state is committed BEFORE changing LiveKit. A retry of
	// this request recovers the same action even if either response is lost.
	result, _ := json.Marshal(gin.H{"action": a})
	g.Receipts[actor+":"+in.RequestID] = liveReceipt{Hash: liveHash(in), At: now, Result: result}
	if err := h.saveGovernance(ctx, r, g); err != nil {
		return nil, err
	}
	if a.Status == "pending" {
		h.executeLiveAction(ctx, r, g, a)
	}
	if err := h.saveGovernance(ctx, r, g); err != nil {
		return nil, err
	}
	return a, nil
}
func (h Handler) applyRestriction(g *roomGovernance, a *LiveAction) {
	m := g.Members[a.MemberID]
	if m == nil {
		return
	}
	restriction := &LiveRestriction{ActionID: a.ID, Until: a.Until, Reason: a.Reason}
	for _, target := range g.Members {
		if target.Role != "viewer" {
			continue
		}
		affected := target.ID == m.ID
		for _, subject := range m.Subjects {
			if slices.Contains(target.Subjects, subject) {
				affected = true
			}
		}
		if !affected {
			continue
		}
		if a.Kind == "kick" {
			target.Ban = restriction
		} else if a.Kind == "mute" {
			target.Mute = restriction
		}
	}
}
func (h Handler) executeLiveAction(ctx context.Context, r *roomLifecycle, g *roomGovernance, a *LiveAction) {
	m := g.Members[a.MemberID]
	if m == nil || m.Role != "viewer" {
		a.Status = "failed"
		a.Error = "成员不存在"
		return
	}
	stillActive := false
	for _, target := range g.Members {
		restriction := target.Mute
		if a.Kind == "kick" {
			restriction = target.Ban
		}
		if restriction != nil && restriction.ActionID == a.ID && activeRestriction(restriction, h.clock().UnixMilli()) {
			stillActive = true
			break
		}
	}
	if !stillActive {
		a.Status = "revoked"
		a.RetryAt = 0
		return
	}
	people, err := h.Client.ListParticipants(ctx, r.ID)
	if err == nil {
		for _, p := range people {
			target := g.Members[g.Admissions[p.Identity].MemberID]
			if target == nil || !p.online() {
				continue
			}
			targetRestriction := target.Mute
			if a.Kind == "kick" {
				targetRestriction = target.Ban
			}
			if targetRestriction == nil || targetRestriction.ActionID != a.ID {
				continue
			}
			if a.Kind == "kick" {
				err = h.Client.removeGovernedParticipant(ctx, r.ID, p.Identity)
			} else {
				request := p.request()
				request.Status = "ended"
				_, err = h.Client.updateVoice(ctx, r.ID, p, request)
			}
			if err != nil {
				break
			}
		}
	}
	if err != nil {
		a.Status = "failed"
		a.Error = "媒体权限尚未确认，将自动重试"
		a.RetryAt = h.clock().Add(5 * time.Second).UnixMilli()
		slog.Warn("live moderation pending", "room", r.ID, "action", a.ID, "error", err)
	} else {
		a.Status = "applied"
		a.Error = ""
		a.RetryAt = 0
	}
}
func (c *Client) removeGovernedParticipant(ctx context.Context, room, identity string) error {
	return c.call(ctx, "RoomService", "RemoveParticipant", adminGrant(room), map[string]any{"room": room, "identity": identity, "revokeTokenTs": time.Now().Unix()}, nil)
}

func memberLabel(m *LiveMember) string {
	if strings.HasSuffix(m.Name, m.Code) {
		return m.Name
	}
	return m.Name + "·" + m.Code
}
func (h Handler) renameLiveMember(c *gin.Context) {
	var in struct {
		RequestID string `json:"requestId"`
		Name      string `json:"name"`
	}
	if bindLiveInput(c, &in) != nil {
		fail(c, 400, "无效的昵称")
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if len(utf16.Encode([]rune(in.Name))) < 1 || len(utf16.Encode([]rune(in.Name))) > 40 {
		fail(c, 400, "昵称需要 1–40 个字符")
		return
	}
	h.liveOperation(c, false, true, func(r *roomLifecycle, g *roomGovernance, m *LiveMember, _ *liveRoomClaims) {
		key, ok := h.liveReceipt(c, g, m.ID, in.RequestID, in)
		if !ok {
			return
		}
		m.Name = in.Name
		if upstreamFailed(c, h.saveGovernance(c.Request.Context(), r, g)) {
			return
		}
		people, err := h.Client.ListParticipants(c.Request.Context(), r.ID)
		if upstreamFailed(c, err) {
			return
		}
		for _, p := range people {
			if g.Admissions[p.Identity].MemberID == m.ID {
				if upstreamFailed(c, h.Client.call(c.Request.Context(), "RoomService", "UpdateParticipant", adminGrant(r.ID), map[string]any{"room": r.ID, "identity": p.Identity, "name": memberLabel(m)}, nil)) {
					return
				}
			}
		}
		h.finishLiveMutation(c, r, g, key, in, gin.H{"member": publicMember(m, h.clock().UnixMilli())})
	})
}
func validateLiveSettings(s LiveSettings) error {
	if s.SlowSeconds != 0 && s.SlowSeconds != 5 && s.SlowSeconds != 10 && s.SlowSeconds != 30 {
		return errors.New("无效的慢速模式")
	}
	if len([]rune(s.Rules)) > 2000 || len([]rune(s.Announcement)) > 500 || len(s.FAQ) > 20 || len(s.BlockedPhrases) > 50 {
		return errors.New("设置内容过长")
	}
	for _, q := range s.FAQ {
		if strings.TrimSpace(q.Question) == "" || strings.TrimSpace(q.Answer) == "" || len([]rune(q.Question)) > 200 || len(utf16.Encode([]rune(q.Answer))) > 500 {
			return errors.New("问答需要填写问题和答案，答案最多 500 个字符")
		}
	}
	for _, p := range s.BlockedPhrases {
		if strings.TrimSpace(p) == "" || len([]rune(p)) > 100 {
			return errors.New("无效的拦截词")
		}
	}
	return nil
}
func (h Handler) updateLiveSettings(c *gin.Context) {
	var in struct {
		RequestID string       `json:"requestId"`
		Settings  LiveSettings `json:"settings"`
	}
	if bindLiveInput(c, &in) != nil {
		fail(c, 400, "无效的设置")
		return
	}
	if in.Settings.FAQ == nil {
		in.Settings.FAQ = []LiveFAQ{}
	}
	if in.Settings.BlockedPhrases == nil {
		in.Settings.BlockedPhrases = []string{}
	}
	if err := validateLiveSettings(in.Settings); err != nil {
		fail(c, 400, err.Error())
		return
	}
	h.liveOperation(c, true, true, func(r *roomLifecycle, g *roomGovernance, m *LiveMember, _ *liveRoomClaims) {
		key, ok := h.liveReceipt(c, g, m.ID, in.RequestID, in)
		if !ok {
			return
		}
		if upstreamFailed(c, h.saveLiveSettings(c.Request.Context(), r, in.Settings)) {
			return
		}
		g.Settings = in.Settings
		h.finishLiveMutation(c, r, g, key, in, gin.H{"settings": g.Settings})
	})
}

// Executed under the same room lock by webhook reconciliation and maintenance.
func (h Handler) reconcileGovernance(ctx context.Context, r *roomLifecycle, people []voiceParticipant) error {
	g, err := h.loadGovernance(ctx, r)
	if err != nil {
		return err
	}
	buffer, err := h.loadChatBuffer(ctx, r)
	if err != nil {
		return err
	}
	if buffer.pruned {
		if err = h.saveChatBuffer(ctx, r, buffer); err != nil {
			return err
		}
	}
	now := h.clock().UnixMilli()
	changed := false
	online := map[string]bool{}
	identities := map[string]bool{}
	for _, p := range people {
		if p.online() {
			identities[p.Identity] = true
			online[g.Admissions[p.Identity].MemberID] = true
		}
	}
	for id, admission := range g.Admissions {
		if admission.Online != identities[id] {
			admission.Online = identities[id]
			g.Admissions[id] = admission
			changed = true
		}
	}
	for _, m := range g.Members {
		if m.Online != online[m.ID] {
			m.Online = online[m.ID]
			changed = true
		}
		if m.Mute != nil && !activeRestriction(m.Mute, now) {
			m.Mute = nil
			changed = true
		}
	}
	for _, a := range g.Actions {
		if a.Status == "pending" || (a.Status == "failed" && a.RetryAt <= now) {
			h.executeLiveAction(ctx, r, g, a)
			changed = true
		}
	}
	for _, p := range people {
		if !p.human() || !p.online() {
			continue
		}
		m := g.Members[g.Admissions[p.Identity].MemberID]
		if m == nil {
			if err = h.Client.removeGovernedParticipant(ctx, r.ID, p.Identity); err != nil {
				return err
			}
			continue
		}
		if activeRestriction(m.Ban, now) {
			if err = h.Client.removeGovernedParticipant(ctx, r.ID, p.Identity); err != nil {
				return err
			}
		} else if activeRestriction(m.Mute, now) && (p.Permission.CanPublish || p.request().occupies()) {
			request := p.request()
			request.Status = "ended"
			if _, err = h.Client.updateVoice(ctx, r.ID, p, request); err != nil {
				return err
			}
		}
	}
	if changed {
		return h.saveGovernance(ctx, r, g)
	}
	return nil
}
func (h Handler) liveVoiceBlocked(ctx context.Context, r *roomLifecycle, identity string) error {
	if r == nil {
		return errors.New("房间已关闭，请重新进入")
	}
	g, err := h.loadGovernance(ctx, r)
	if err != nil {
		return err
	}
	m := g.Members[g.Admissions[identity].MemberID]
	if m == nil || activeRestriction(m.Mute, h.clock().UnixMilli()) || activeRestriction(m.Ban, h.clock().UnixMilli()) {
		return fmt.Errorf("你已被禁言，暂时无法连麦")
	}
	return nil
}
