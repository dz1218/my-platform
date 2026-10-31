package livekit

import (
	"cmp"
	"companion/server/pkg/database"
	"context"
	"fmt"
	"github.com/gin-gonic/gin"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf16"
)

func (h Handler) appendLiveMessage(b *roomChatBuffer, m LiveChatMessage) LiveChatMessage {
	b.Sequence = max(b.Sequence+1, h.clock().UnixMicro())
	m.Sequence = b.Sequence
	m.Time = h.clock().UnixMilli()
	m.ID = database.ID()
	b.Messages = append(b.Messages, m)
	return m
}
func recentTimes(values []int64, after int64) []int64 {
	out := values[:0]
	for _, v := range values {
		if v > after {
			out = append(out, v)
		}
	}
	return out
}
func (h Handler) sendLiveMessage(c *gin.Context) {
	var in struct {
		RequestID string `json:"requestId"`
		Text      string `json:"text"`
	}
	if bindLiveInput(c, &in) != nil || !voiceRequestID.MatchString(in.RequestID) {
		fail(c, 400, "无效的消息")
		return
	}
	in.Text = strings.TrimSpace(in.Text)
	if in.Text == "" || len(utf16.Encode([]rune(in.Text))) > 500 {
		fail(c, 400, "消息需要 1–500 个字符")
		return
	}
	h.liveOperation(c, false, true, func(r *roomLifecycle, g *roomGovernance, m *LiveMember, claims *liveRoomClaims) {
		ctx := c.Request.Context()
		b, err := h.loadChatBuffer(ctx, r)
		if upstreamFailed(c, err) {
			return
		}
		key := m.ID + ":" + in.RequestID
		if rejected, ok := b.Rejected[key]; ok {
			if rejected.Hash != liveHash(in.Text) {
				fail(c, 409, "请求编号已用于其他消息")
			} else {
				failRoom(c, rejected.Status, rejected.Code, rejected.Message)
			}
			return
		}
		reject := func(status int, code, message string) {
			b.Rejected[key] = liveRejectedMessage{Hash: liveHash(in.Text), Status: status, Code: code, Message: message, At: h.clock().UnixMilli()}
			if !upstreamFailed(c, h.saveChatBuffer(ctx, r, b)) {
				failRoom(c, status, code, message)
			}
		}
		if old, ok := b.Receipts[key]; ok {
			if old.Text != in.Text {
				fail(c, 409, "请求编号已用于其他消息")
			} else {
				if m.Role == "host" && r.Assistant.Status == "online" {
					if handled, err := h.executeHostCommand(ctx, r, g, b, old); upstreamFailed(c, err) {
						return
					} else if handled && upstreamFailed(c, h.saveChatBuffer(ctx, r, b)) {
						return
					}
				}
				c.JSON(200, gin.H{"message": old})
			}
			return
		}
		now := h.clock().UnixMilli()
		if activeRestriction(m.Mute, now) {
			if g.Settings.AutoModeration && r.Assistant.Status == "online" {
				h.proposeKick(g, m, "禁言期间持续尝试发言", []string{in.Text})
				if upstreamFailed(c, h.saveGovernance(ctx, r, g)) {
					return
				}
			}
			reject(403, "member_muted", "你已被禁言，暂时无法发送消息")
			return
		}
		bucket := b.Buckets[m.ID]
		if bucket == nil {
			bucket = &liveChatBucket{Texts: map[string][]int64{}}
			b.Buckets[m.ID] = bucket
		}
		if m.Role != "host" && g.Settings.SlowSeconds > 0 && bucket.LastAt+int64(g.Settings.SlowSeconds)*1000 > now {
			c.Header("Retry-After", fmt.Sprint((bucket.LastAt+int64(g.Settings.SlowSeconds)*1000-now+999)/1000))
			reject(429, "slow_mode", "慢速模式已开启，请稍后再发言")
			return
		}
		bucket.Sent = recentTimes(bucket.Sent, now-10000)
		for text, at := range bucket.Texts {
			at = recentTimes(at, now-30000)
			if len(at) == 0 {
				delete(bucket.Texts, text)
			} else {
				bucket.Texts[text] = at
			}
		}
		violation := ""
		if m.Role != "host" {
			if len(bucket.Sent) >= 5 {
				violation = "发送过于频繁"
			} else if len(bucket.Texts[in.Text]) >= 2 {
				violation = "重复发送相同消息"
			}
			for _, phrase := range g.Settings.BlockedPhrases {
				if strings.Contains(strings.ToLower(in.Text), strings.ToLower(phrase)) {
					violation = "触发主播设置的拦截词"
					break
				}
			}
		}
		if violation != "" {
			if g.Settings.AutoModeration && r.Assistant.Status == "online" && bucket.WarnedAt > 0 && now-bucket.WarnedAt <= 60000 {
				already := false
				for _, a := range g.Actions {
					if a.MemberID == m.ID && a.Actor == "assistant" && a.Kind == "mute" {
						already = true
					}
				}
				if already {
					h.proposeKick(g, m, "提醒、短时禁言后再次违规", []string{in.Text})
				} else {
					a := &LiveAction{ID: database.ID(), RequestID: in.RequestID, MemberID: m.ID, Name: memberLabel(m), Kind: "mute", Actor: "assistant", Reason: violation, Evidence: []string{in.Text}, Status: "pending", Until: now + 300000, CreatedAt: now}
					g.Actions = append(g.Actions, a)
					h.applyRestriction(g, a)
					if upstreamFailed(c, h.saveGovernance(ctx, r, g)) {
						return
					}
					h.executeLiveAction(ctx, r, g, a)
				}
				if upstreamFailed(c, h.saveGovernance(ctx, r, g)) {
					return
				}
			}
			if bucket.WarnedAt == 0 || now-bucket.WarnedAt > 5000 {
				h.appendLiveMessage(b, LiveChatMessage{Name: "系统", Role: "system", Text: violation + "，请遵守房规。", Destination: m.ID})
				bucket.WarnedAt = now
			}
			c.Header("Retry-After", "10")
			reject(429, "chat_rate_limited", violation+"，请稍后再试")
			return
		}
		bucket.Sent = append(bucket.Sent, now)
		bucket.Texts[in.Text] = append(bucket.Texts[in.Text], now)
		bucket.LastAt = now
		message := h.appendLiveMessage(b, LiveChatMessage{MemberID: m.ID, Name: memberLabel(m), Role: m.Role, Text: in.Text})
		b.Receipts[key] = message
		if upstreamFailed(c, h.saveChatBuffer(ctx, r, b)) {
			return
		}
		if m.Role == "host" && r.Assistant.Status == "online" {
			if handled, err := h.executeHostCommand(ctx, r, g, b, message); err != nil {
				fail(c, 502, "管理指令执行结果尚未确认，请查看管理记录")
				return
			} else if handled {
				if upstreamFailed(c, h.saveChatBuffer(ctx, r, b)) {
					return
				}
			}
		}
		c.JSON(201, gin.H{"message": message})
	})
}
func (h Handler) proposeKick(g *roomGovernance, m *LiveMember, reason string, evidence []string) *LiveAction {
	return h.proposeModeration(g, m, "kick", reason, evidence)
}
func (h Handler) proposeModeration(g *roomGovernance, m *LiveMember, kind, reason string, evidence []string) *LiveAction {
	for _, a := range g.Actions {
		if a.MemberID == m.ID && a.Kind == kind && a.Status == "proposed" {
			return a
		}
	}
	a := &LiveAction{ID: database.ID(), MemberID: m.ID, Name: memberLabel(m), Kind: kind, Actor: "assistant", Reason: reason, Evidence: evidence, Status: "proposed", CreatedAt: h.clock().UnixMilli()}
	g.Actions = append(g.Actions, a)
	return a
}

// Match complete commands against room members, never a substring of a message.
// A nickname is usable only when the command identifies one member and duration.
var hostMuteDirective = regexp.MustCompile(`^(?:请帮我|麻烦帮我|帮我|麻烦|请|给我)?(?:禁言(?:他|她|TA|ta|这个人|这位观众)?|(?:把|给)(?:他|她|TA|ta|这个人|这位观众)禁言)(?:一下)?(?:吧)?$`)

var hostKickDirective = regexp.MustCompile(`^(?:请帮我|麻烦帮我|帮我|麻烦|请|给我)?(?:(?:踢出|踢走|踢掉|移出|踢)(?:他|她|TA|ta|这个人|这位观众)?(?:出去|直播间)?|把(?:他|她|TA|ta|这个人|这位观众)(?:踢出|踢走|踢掉|移出|踢)(?:去|出去|直播间)?)(?:吧)?$`)

func hostMuteTarget(g *roomGovernance, command string) (*LiveMember, int) {
	return hostModerationTarget(g, command, "mute")
}

func hostModerationTarget(g *roomGovernance, command, kind string) (*LiveMember, int) {
	verbs := []string{"禁言"}
	directive := hostMuteDirective
	durations := map[string]int{"": 300, "5分钟": 300, "五分钟": 300, "30分钟": 1800, "三十分钟": 1800, "本场": 0, "本场直播": 0}
	if kind == "kick" {
		verbs = []string{"踢出", "踢人", "踢走", "踢掉", "移出", "踢", "踢出去", "踢出直播间"}
		directive = hostKickDirective
		durations = map[string]int{"": 0}
	}
	compact := func(s string) string { return strings.Join(strings.Fields(s), "") }
	command = strings.TrimRight(compact(command), "。！!")
	for _, prefix := range []string{"请帮我", "麻烦帮我", "帮我", "麻烦", "请"} {
		if strings.HasPrefix(command, prefix) {
			command = strings.TrimPrefix(command, prefix)
			break
		}
	}
	var target *LiveMember
	duration := 300
	for _, member := range g.Members {
		if member.Role != "viewer" {
			continue
		}
		for _, name := range []string{memberLabel(member), member.Name} {
			if strings.TrimSpace(name) == "" {
				continue
			}
			for _, reference := range []string{compact(name), "@" + compact(name)} {
				for suffix, seconds := range durations {
					if !strings.HasSuffix(command, suffix) {
						continue
					}
					body := strings.TrimSuffix(command, suffix)
					matches := false
					for _, verb := range verbs {
						matches = matches || body == verb+reference || body == "把"+reference+verb
					}
					// A mention identifies the object independently of word order:
					// "@观众 禁言他", "@观众 请把他禁言", "禁言他 @观众".
					if strings.HasPrefix(body, reference) {
						instruction := strings.Trim(strings.TrimPrefix(body, reference), "，,:：")
						matches = matches || directive.MatchString(instruction)
					}
					if strings.HasSuffix(body, reference) {
						instruction := strings.Trim(strings.TrimSuffix(body, reference), "，,:：")
						matches = matches || directive.MatchString(instruction)
					}
					if !matches {
						continue
					}
					if target != nil && (target.ID != member.ID || duration != seconds) {
						return nil, 0
					}
					target, duration = member, seconds
				}
			}
		}
	}
	return target, duration
}

// Only deterministic, explicit host commands grant execution authority.
// Chat commands are already authorized: execute or explain, never propose.
func (h Handler) executeHostCommand(ctx context.Context, r *roomLifecycle, g *roomGovernance, b *roomChatBuffer, source LiveChatMessage) (bool, error) {
	for _, m := range b.Messages {
		if m.Role == "system" && m.ReplyTo == source.ID {
			return true, nil
		}
	}
	text := strings.TrimSpace(source.Text)
	if source.Role != "host" || len(text) < 3 || !strings.EqualFold(text[:3], "@AI") {
		return false, nil
	}
	command := strings.TrimSpace(text[3:])
	requestedKind := ""
	if strings.Contains(source.Text, "禁言") {
		requestedKind = "mute"
	} else if strings.Contains(source.Text, "踢") || strings.Contains(source.Text, "移出") {
		requestedKind = "kick"
	}
	if requestedKind == "" {
		return false, nil
	}
	target, duration := hostModerationTarget(g, command, "mute")
	kickTarget, _ := hostModerationTarget(g, command, "kick")
	if target != nil && kickTarget != nil {
		// Multiple interpretations are not authority to choose one silently.
		target = nil
	} else if kickTarget != nil {
		target, duration, requestedKind = kickTarget, 0, "kick"
	} else if target != nil {
		requestedKind = "mute"
	}
	if target == nil {
		detail := "未执行管理指令：无法确定唯一观众或具体操作。请右键 @具体观众并写明要执行的操作。"
		if requestedKind == "mute" {
			detail = "未执行禁言：无法确定唯一观众或禁言时长。请右键 @具体观众并写明禁言；未写时长默认 5 分钟，也支持 30 分钟或本场直播。"
		}
		h.appendLiveMessage(b, LiveChatMessage{Name: "系统", Role: "system", Destination: "host", ReplyTo: source.ID, Text: detail})
		return true, nil
	}
	a, err := h.changeModeration(ctx, r, g, source.MemberID, liveModerationInput{RequestID: source.ID, MemberID: target.ID, Kind: requestedKind, Duration: duration, Reason: "主播通过助手指令管理"})
	if err != nil {
		return true, err
	}
	status := "已执行"
	if a.Status != "applied" {
		status = "已提交，正在确认媒体权限"
	}
	h.appendLiveMessage(b, LiveChatMessage{Name: "系统", Role: "system", Destination: "host", ReplyTo: source.ID, Text: memberLabel(target) + "：" + status + "。可在管理记录查看。"})
	return true, nil
}
func (h Handler) activityView(ctx context.Context, r *roomLifecycle, g *roomGovernance, claims *liveRoomClaims, after int64) (*LiveActivity, error) {
	m, err := h.validateLiveActor(ctx, r, g, claims)
	if err != nil {
		return nil, err
	}
	b, err := h.loadChatBuffer(ctx, r)
	if err != nil {
		return nil, err
	}
	now := h.clock().UnixMilli()
	self := publicMember(m, now)
	view := &LiveActivity{Revision: g.Revision, Type: "room.activity", RoomID: r.ID, RoomSID: r.SID, Sequence: b.Sequence, Self: &self, Settings: g.Settings, Members: []LiveMember{}, Messages: []LiveChatMessage{}, Removed: activeRestriction(m.Ban, now)}
	if m.Role != "host" {
		view.Settings.BlockedPhrases = nil
		view.Settings.FAQ = nil
	}
	if view.Removed || r.State != "open" {
		return view, nil
	}
	for _, person := range g.Members {
		if person.Online || m.Role == "host" {
			v := publicMember(person, now)
			view.Members = append(view.Members, v)
		}
	}
	if m.Role == "host" {
		view.Actions = g.Actions
	}
	slices.SortFunc(view.Members, func(a, b LiveMember) int {
		if a.Role != b.Role {
			if a.Role == "host" {
				return -1
			}
			return 1
		}
		return cmp.Compare(a.ID, b.ID)
	})
	admission := g.Admissions[claims.Subject]
	if !admission.Online {
		// A socket may connect before presence is confirmed. Do not acknowledge
		// buffered messages until they can be delivered, or the next snapshot
		// will skip the history this connection has never received.
		view.Sequence = after
		return view, nil
	}
	for _, message := range b.Messages {
		if message.Time >= admission.JoinedAt && message.Sequence > after && (message.Destination == "" || message.Destination == m.ID || message.Destination == "host" && m.Role == "host") {
			message.Destination = ""
			view.Messages = append(view.Messages, message)
		}
	}
	if after > 0 && after < b.DroppedSequence && admission.JoinedAt <= b.DroppedAt {
		view.Gap = true
	}
	return view, nil
}
func (h Handler) activityHTTP(c *gin.Context) {
	h.liveOperation(c, false, false, func(r *roomLifecycle, g *roomGovernance, _ *LiveMember, claims *liveRoomClaims) {
		view, err := h.activityView(c.Request.Context(), r, g, claims, 0)
		if !upstreamFailed(c, err) {
			c.JSON(200, view)
		}
	})
}

// Existing room maintenance calls this on its bounded schedule. Startup also
// reconciles pending actions; API restarts cannot silently drop a punishment.
func (h Handler) governanceCheckAt(ctx context.Context, r *roomLifecycle) int64 {
	g, err := h.loadGovernance(ctx, r)
	if err != nil {
		return h.clock().Add(5 * time.Second).UnixMilli()
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
	if b, err := h.loadChatBuffer(ctx, r); err == nil && len(b.Messages) > 0 {
		add(b.Messages[0].Time + (30 * time.Minute).Milliseconds() + 1)
	}
	return due
}
