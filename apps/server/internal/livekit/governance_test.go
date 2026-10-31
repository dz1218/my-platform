package livekit

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type governanceFixture struct {
	*voiceFixture
	record     *roomLifecycle
	roomTokens map[string]string
}

func newGovernanceFixture(t *testing.T) *governanceFixture {
	t.Helper()
	v := newVoiceFixture(t)
	f := &governanceFixture{voiceFixture: v, roomTokens: map[string]string{}}
	r := &roomLifecycle{ID: "room-voice", SID: "RM_governance", OwnerID: "test-user", State: "open", Host: &hostAdmission{Identity: "host_test-user"}, HadHost: true, HostConnection: "connected", Assistant: AssistantState{Status: "online", SessionID: "assistant-session-123", StartedAt: time.Now().Add(-time.Minute).UnixMilli()}}
	f.record = r
	if err := v.handler.saveLifecycle(context.Background(), r); err != nil {
		t.Fatal(err)
	}
	g, err := v.handler.loadGovernance(context.Background(), r)
	if err != nil {
		t.Fatal(err)
	}
	for id := range v.people {
		role := "viewer"
		if strings.HasPrefix(id, "host_") {
			role = "host"
		}
		m := &LiveMember{ID: id, Name: id, Code: "1234", Role: role, Online: true, Subjects: []string{"g:" + id}}
		g.Members[id] = m
		g.Admissions[id] = liveAdmission{MemberID: id, Online: true, JoinedAt: time.Now().Add(-time.Second).UnixMilli(), ExpiresAt: time.Now().Add(time.Hour).UnixMilli()}
		f.roomTokens[id], err = v.handler.signLiveClaims(liveRoomClaims{RegisteredClaims: jwt.RegisteredClaims{Subject: id}, RoomID: r.ID, RoomSID: r.SID, MemberID: id}, "room", time.Hour)
		if err != nil {
			t.Fatal(err)
		}
	}
	if err = v.handler.saveGovernance(context.Background(), r, g); err != nil {
		t.Fatal(err)
	}
	return f
}
func (f *governanceFixture) request(t *testing.T, actor, method, path string, body any, status int) map[string]json.RawMessage {
	t.Helper()
	data, _ := json.Marshal(body)
	req := httptest.NewRequest(method, "/rooms/room-voice/"+path, strings.NewReader(string(data)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Live-Room-Token", f.roomTokens[actor])
	res := httptest.NewRecorder()
	f.router.ServeHTTP(res, req)
	if res.Code != status {
		t.Fatalf("%s %s: got %d want %d: %s", method, path, res.Code, status, res.Body.String())
	}
	var result map[string]json.RawMessage
	_ = json.Unmarshal(res.Body.Bytes(), &result)
	return result
}
func TestGovernanceMuteBlocksChatAndCohostAndStaleUndo(t *testing.T) {
	f := newGovernanceFixture(t)
	ctx := context.Background()
	f.request(t, "viewer_one", "POST", "moderation", liveModerationInput{RequestID: "request-denied-123", MemberID: "viewer_two", Kind: "mute", Duration: 300}, 403)
	result := f.request(t, "host_test-user", "POST", "moderation", liveModerationInput{RequestID: "request-mute-one1", MemberID: "viewer_one", Kind: "mute", Duration: 300}, 200)
	var first LiveAction
	json.Unmarshal(result["action"], &first)
	f.request(t, "viewer_one", "POST", "messages", map[string]string{"requestId": "message-muted-123", "text": "绕过输入框"}, 403)
	voiceResult(t, f.call("viewer_one", "POST", voiceBase+"/request", "muted-voice-req-123"), 403)
	if f.permissions["viewer_one"]["canPublishData"] != false || f.permissions["viewer_one"]["canPublish"] != false {
		t.Fatal("mute did not revoke media and data")
	}
	result = f.request(t, "host_test-user", "POST", "moderation", liveModerationInput{RequestID: "request-mute-two2", MemberID: "viewer_one", Kind: "mute", Duration: 1800}, 200)
	var second LiveAction
	json.Unmarshal(result["action"], &second)
	f.request(t, "host_test-user", "POST", "moderation", liveModerationInput{RequestID: "request-revoke-11", Kind: "revoke", ActionID: first.ID}, 200)
	g, _ := f.handler.loadGovernance(ctx, f.record)
	if g.Members["viewer_one"].Mute.ActionID != second.ID {
		t.Fatal("stale undo removed newer restriction")
	}
	f.request(t, "host_test-user", "POST", "moderation", liveModerationInput{RequestID: "request-revoke-22", Kind: "revoke", ActionID: second.ID}, 200)
	f.request(t, "viewer_one", "POST", "messages", map[string]string{"requestId": "message-unmuted-1", "text": "恢复发言"}, 201)
	if f.people["viewer_one"].Permission.CanPublish {
		t.Fatal("unmute must not open microphone")
	}
}
func TestGovernanceMessagesIdentityReplayAndSlowMode(t *testing.T) {
	f := newGovernanceFixture(t)
	input := map[string]string{"requestId": "message-once-1234", "text": "你好", "memberId": "host_test-user", "name": "主播"}
	first := f.request(t, "viewer_one", "POST", "messages", input, 201)
	second := f.request(t, "viewer_one", "POST", "messages", input, 200)
	if string(first["message"]) != string(second["message"]) {
		t.Fatal("message duplicated")
	}
	var message LiveChatMessage
	json.Unmarshal(first["message"], &message)
	if message.Role != "viewer" || message.MemberID != "viewer_one" {
		t.Fatal("forged author accepted")
	}
	input["text"] = "changed"
	f.request(t, "viewer_one", "POST", "messages", input, 409)
	g, _ := f.handler.loadGovernance(context.Background(), f.record)
	g.Settings.SlowSeconds = 10
	f.handler.saveGovernance(context.Background(), f.record, g)
	f.request(t, "viewer_one", "POST", "messages", map[string]string{"requestId": "message-slow-1234", "text": "太快"}, 429)
	f.request(t, "host_test-user", "POST", "messages", map[string]string{"requestId": "message-host-1234", "text": "主播不受慢速限制"}, 201)
	claims, _ := f.handler.parseLiveClaims(f.roomTokens["viewer_two"], "room")
	a := g.Admissions["viewer_two"]
	a.JoinedAt = time.Now().Add(time.Second).UnixMilli()
	g.Admissions["viewer_two"] = a
	view, err := f.handler.activityView(context.Background(), f.record, g, claims, 0)
	if err != nil || len(view.Messages) != 0 {
		t.Fatal("new arrival received prior chat", err)
	}
	for _, m := range view.Members {
		if len(m.Subjects) != 0 {
			t.Fatal("private identity leaked")
		}
	}
}
func TestGovernanceRulesMuteOnceAndProposeKick(t *testing.T) {
	f := newGovernanceFixture(t)
	for i, id := range []string{"repeat-message-001", "repeat-message-002", "repeat-message-003", "repeat-message-004"} {
		status := 201
		if i >= 2 {
			status = 429
		}
		f.request(t, "viewer_one", "POST", "messages", map[string]string{"requestId": id, "text": "重复内容"}, status)
		if i == 2 {
			f.request(t, "viewer_one", "POST", "messages", map[string]string{"requestId": id, "text": "重复内容"}, 429)
			g, _ := f.handler.loadGovernance(context.Background(), f.record)
			if g.Members["viewer_one"].Mute != nil {
				t.Fatal("replayed rejection counted as second violation")
			}
		}
	}
	g, _ := f.handler.loadGovernance(context.Background(), f.record)
	m := g.Members["viewer_one"]
	if m.Mute == nil || m.Mute.Until-time.Now().UnixMilli() > 300000 {
		t.Fatal("automatic short mute missing or too long")
	}
	until := m.Mute.Until
	f.request(t, "viewer_one", "POST", "messages", map[string]string{"requestId": "repeat-after-mute", "text": "继续刷屏"}, 403)
	g, _ = f.handler.loadGovernance(context.Background(), f.record)
	if g.Members["viewer_one"].Mute.Until != until || g.Members["viewer_one"].Ban != nil {
		t.Fatal("assistant extended mute or kicked automatically")
	}
	if len(g.Actions) != 2 || g.Actions[1].Status != "proposed" {
		t.Fatal("missing host confirmation proposal")
	}
}
func TestGovernancePendingFailureIsDurableAndIdempotent(t *testing.T) {
	f := newGovernanceFixture(t)
	f.failUpdate = true
	in := liveModerationInput{RequestID: "durable-mute-1234", MemberID: "viewer_one", Kind: "mute", Duration: 300}
	f.request(t, "host_test-user", "POST", "moderation", in, 200)
	g, _ := f.handler.loadGovernance(context.Background(), f.record)
	if len(g.Actions) != 1 || g.Actions[0].Status != "failed" || g.Members["viewer_one"].Mute == nil {
		t.Fatal("failed RPC lost desired restriction")
	}
	f.request(t, "host_test-user", "POST", "moderation", in, 200)
	g, _ = f.handler.loadGovernance(context.Background(), f.record)
	if len(g.Actions) != 1 {
		t.Fatal("duplicate action")
	}
	f.request(t, "host_test-user", "POST", "moderation", liveModerationInput{RequestID: "retry-durable-1234", Kind: "retry", ActionID: g.Actions[0].ID}, 200)
	g, _ = f.handler.loadGovernance(context.Background(), f.record)
	if g.Actions[0].Status != "applied" {
		t.Fatal("retry failed")
	}
}
func TestGovernanceGuestCookieAndRoomBoundary(t *testing.T) {
	f := newLifecycleFixture(t)
	r, _ := f.h.loadLifecycle(context.Background(), "room-host")
	f.h.saveLifecycle(context.Background(), r)
	call := func(cookie *http.Cookie, identity, user string) (*LiveMember, *http.Cookie) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest("POST", "/", nil)
		if cookie != nil {
			c.Request.AddCookie(cookie)
		}
		m, _, err := f.h.admitLiveMember(c, r, identity, user, "观众")
		if err != nil {
			t.Fatal(err)
		}
		cookies := w.Result().Cookies()
		if len(cookies) > 0 {
			cookie = cookies[0]
		}
		return m, cookie
	}
	first, cookie := call(nil, "viewer_first", "")
	again, _ := call(cookie, "viewer_second", "")
	other, _ := call(nil, "viewer_third", "")
	if first.ID != again.ID || first.Name != again.Name || other.Name == first.Name || !cookie.HttpOnly || cookie.MaxAge != 30*24*3600 {
		t.Fatal("unstable or unsafe guest identity")
	}
	// A browser cookie can carry restrictions, never another account's host role.
	host, _ := call(cookie, "host_current", "test-user")
	guest, _ := call(cookie, "viewer_after_logout", "")
	if host.Role != "host" || guest.Role != "viewer" || host.ID == guest.ID {
		t.Fatal("guest inherited host authority")
	}
}

func TestGovernanceAssistantToolsRequireHostConfirmationAndCurrentSession(t *testing.T) {
	f := newGovernanceFixture(t)
	cfg := f.handler.Client.config
	cfg.RoomAgentToken = "test-independent-room-agent-credential-123"
	RegisterRoomAgent(f.router, cfg, f.handler.Auth, nil)
	result := f.request(t, "viewer_one", "POST", "messages", map[string]string{"requestId": "tool-source-message1", "text": "公开的测试证据"}, 201)
	var source LiveChatMessage
	json.Unmarshal(result["message"], &source)
	call := func(token, session string, in roomAgentOutput, status int) {
		t.Helper()
		data, _ := json.Marshal(in)
		req := httptest.NewRequest("POST", "/internal/live/rooms/room-voice/output", bytes.NewReader(data))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("X-Live-Room-Sid", f.record.SID)
		req.Header.Set("X-Live-Assistant-Session", session)
		res := httptest.NewRecorder()
		f.router.ServeHTTP(res, req)
		if res.Code != status {
			t.Fatalf("agent got %d want %d: %s", res.Code, status, res.Body.String())
		}
	}
	in := roomAgentOutput{RequestID: "assistant-tool-req1", Kind: "suggest", SourceID: source.ID, MemberID: source.MemberID, ActionKind: "kick", Text: "需要主播判断"}
	call("browser-token", f.record.Assistant.SessionID, in, 401)
	call(cfg.RoomAgentToken, "old-session", in, 409)
	call(cfg.RoomAgentToken, f.record.Assistant.SessionID, in, 200)
	in.RequestID = "assistant-tool-req2"
	call(cfg.RoomAgentToken, f.record.Assistant.SessionID, in, 200)
	g, _ := f.handler.loadGovernance(context.Background(), f.record)
	if len(g.Actions) != 1 || g.Members[source.MemberID].Ban != nil || g.Actions[0].Status != "proposed" {
		t.Fatal("tool executed a kick or duplicated proposal")
	}
	kick := g.Actions[0].ID
	in.ActionKind = "mute"
	call(cfg.RoomAgentToken, f.record.Assistant.SessionID, in, 200)
	g, _ = f.handler.loadGovernance(context.Background(), f.record)
	if len(g.Actions) != 2 || g.Actions[0].Kind != "kick" {
		t.Fatal("mute proposal overwrote pending kick")
	}
	in.MemberID = "host_test-user"
	in.RequestID = "assistant-tool-req3"
	call(cfg.RoomAgentToken, f.record.Assistant.SessionID, in, 403)
	f.request(t, "host_test-user", "POST", "moderation", liveModerationInput{RequestID: "host-confirm-kick1", Kind: "approve", ActionID: kick}, 200)
	g, _ = f.handler.loadGovernance(context.Background(), f.record)
	if g.Members[source.MemberID].Ban == nil {
		t.Fatal("host confirmation did not apply")
	}
	f.request(t, "viewer_one", "GET", "activity", nil, 403)
}

func TestGovernanceExpirySharedConnectionsAndTokenIncarnation(t *testing.T) {
	f := newGovernanceFixture(t)
	ctx := context.Background()
	g, _ := f.handler.loadGovernance(ctx, f.record)
	g.Members["viewer_two"].Subjects = append(g.Members["viewer_two"].Subjects, g.Members["viewer_one"].Subjects...)
	f.handler.saveGovernance(ctx, f.record, g)
	f.request(t, "host_test-user", "POST", "moderation", liveModerationInput{RequestID: "multi-connect-mute", Kind: "mute", MemberID: "viewer_one", Duration: 300}, 200)
	g, _ = f.handler.loadGovernance(ctx, f.record)
	if g.Members["viewer_two"].Mute == nil || f.permissions["viewer_two"]["canPublishData"] != false {
		t.Fatal("related connection escaped sanction")
	}
	f.handler.now = func() time.Time { return time.Now().Add(301 * time.Second) }
	people, _ := f.handler.Client.ListParticipants(ctx, f.record.ID)
	if err := f.handler.reconcileGovernance(ctx, f.record, people); err != nil {
		t.Fatal(err)
	}
	g, _ = f.handler.loadGovernance(ctx, f.record)
	if g.Members["viewer_one"].Mute != nil || g.Members["viewer_two"].Mute != nil {
		t.Fatal("expiry did not clear restriction")
	}
	claims, _ := f.handler.parseLiveClaims(f.roomTokens["viewer_one"], "room")
	other := *f.record
	other.SID = "RM_new-incarnation"
	if _, err := f.handler.validateLiveActor(ctx, &other, g, claims); err == nil {
		t.Fatal("old room credential accepted")
	}
	other.ID = "another-room"
	other.SID = f.record.SID
	if _, err := f.handler.validateLiveActor(ctx, &other, g, claims); err == nil {
		t.Fatal("cross-room credential accepted")
	}
}

func TestGovernanceReplayGapOnlyWhenMessagesWereDropped(t *testing.T) {
	f := newGovernanceFixture(t)
	ctx := context.Background()
	b, _ := f.handler.loadChatBuffer(ctx, f.record)
	first := f.handler.appendLiveMessage(b, LiveChatMessage{Text: "first", Role: "viewer"})
	f.handler.now = func() time.Time { return time.Now().Add(time.Second) }
	f.handler.appendLiveMessage(b, LiveChatMessage{Text: "second", Role: "viewer"})
	f.handler.saveChatBuffer(ctx, f.record, b)
	g, _ := f.handler.loadGovernance(ctx, f.record)
	claims, _ := f.handler.parseLiveClaims(f.roomTokens["viewer_one"], "room")
	view, _ := f.handler.activityView(ctx, f.record, g, claims, first.Sequence)
	if view.Gap || len(view.Messages) != 1 {
		t.Fatal("time-based sequence was mistaken for data loss")
	}
	for i := 0; i < 1001; i++ {
		f.handler.appendLiveMessage(b, LiveChatMessage{Text: "bounded", Role: "viewer"})
	}
	f.handler.saveChatBuffer(ctx, f.record, b)
	view, _ = f.handler.activityView(ctx, f.record, g, claims, first.Sequence)
	if !view.Gap || len(view.Messages) != 1000 {
		t.Fatal("buffer overflow not marked")
	}
}

func TestGovernanceExplicitMuteCommandsExecuteWithoutConfirmation(t *testing.T) {
	for _, command := range []string{
		"@AI 把听众·FE7A禁言", "@AI 禁言 听众·FE7A", "@AI 禁言 听众·FE7A 5分钟",
		"@ai请帮我把听众·FE7A禁言！", "@AI @听众·FE7A 禁言他", "@AI @听众·FE7A 禁言",
		"@AI @听众·FE7A 请把他禁言", "@AI 禁言他 @听众·FE7A", "@AI @听众·FE7A，麻烦帮我禁言一下",
	} {
		t.Run(command, func(t *testing.T) {
			f := newGovernanceFixture(t)
			g, _ := f.handler.loadGovernance(context.Background(), f.record)
			g.Members["viewer_one"].Name = "听众"
			g.Members["viewer_one"].Code = "FE7A"
			if err := f.handler.saveGovernance(context.Background(), f.record, g); err != nil {
				t.Fatal(err)
			}
			input := map[string]string{"requestId": "explicit-mute-command", "text": command}
			f.request(t, "host_test-user", "POST", "messages", input, 201)
			f.request(t, "host_test-user", "POST", "messages", input, 200)
			g, _ = f.handler.loadGovernance(context.Background(), f.record)
			if len(g.Actions) != 1 || g.Actions[0].Status != "applied" || g.Actions[0].Actor != "host_test-user" || g.Actions[0].Until-g.Actions[0].CreatedAt != 300000 {
				t.Fatalf("expected one immediate 5-minute host mute, got %+v", g.Actions)
			}
			if g.Members["viewer_one"].Mute == nil || g.Members["viewer_two"].Mute != nil {
				t.Fatal("command did not mute only the named member")
			}
			f.request(t, "viewer_one", "POST", "messages", map[string]string{"requestId": "muted-command-followup", "text": "不能发送"}, 403)
		})
	}
}

func TestGovernanceExplicitKickCommandsExecuteWithoutConfirmation(t *testing.T) {
	for _, command := range []string{
		"@AI 踢出 viewer_one·1234", "@AI 踢出 @viewer_one·1234",
		"@AI @viewer_one·1234 踢出他", "@AI @viewer_one·1234 把他踢出去",
		"@AI 请把 @viewer_one·1234 移出", "@AI @viewer_one·1234 移出他",
	} {
		t.Run(command, func(t *testing.T) {
			f := newGovernanceFixture(t)
			input := map[string]string{"requestId": "explicit-kick-command", "text": command}
			f.request(t, "host_test-user", "POST", "messages", input, 201)
			f.request(t, "host_test-user", "POST", "messages", input, 200)
			g, _ := f.handler.loadGovernance(context.Background(), f.record)
			if len(g.Actions) != 1 || g.Actions[0].Kind != "kick" || g.Actions[0].Status != "applied" || g.Actions[0].MemberID != "viewer_one" || g.Actions[0].Actor != "host_test-user" {
				t.Fatalf("expected one immediate host kick, got %+v", g.Actions)
			}
			if g.Members["viewer_one"].Ban == nil || g.Members["viewer_two"].Ban != nil {
				t.Fatal("command did not kick only the named member")
			}
		})
	}
}

func TestHostMuteTargetRequiresUnambiguousExplicitCommand(t *testing.T) {
	g := &roomGovernance{Members: map[string]*LiveMember{
		"one":   {ID: "one", Name: "听众", Code: "FE7A", Role: "viewer"},
		"two":   {ID: "two", Name: "听众", Code: "ABCD", Role: "viewer"},
		"three": {ID: "three", Name: "小 明", Code: "EFGH", Role: "viewer"},
		"host":  {ID: "host", Name: "主播", Code: "HOST", Role: "host"},
	}}
	for _, tc := range []struct {
		command  string
		id       string
		duration int
	}{
		{"禁言 听众·FE7A 30 分钟", "one", 1800},
		{"把听众·FE7A禁言本场直播", "one", 0},
		{"禁言 @小 明 五分钟", "three", 300},
		{"@听众·FE7A 禁言他30分钟", "one", 1800},
		{"@听众·FE7A 把他禁言本场直播", "one", 0},
		{"@听众·FE7A 不要禁言他", "", 0},
		{"@听众·FE7A 禁言他吗？", "", 0},
		{"@听众·FE7A 禁言他10分钟", "", 0},
		{"@听众·FE7A @听众·ABCD 禁言他们", "", 0},
		{"禁言听众", "", 0},
		{"禁言主播", "", 0},
		{"不要把听众·FE7A禁言", "", 0},
		{"把听众·FE7A禁言吗？", "", 0},
		{"把听众·FE7A禁言10分钟", "", 0},
		{"把听众·FE7A和听众·ABCD禁言", "", 0},
		{"帮我禁言那个刷屏的人", "", 0},
	} {
		t.Run(tc.command, func(t *testing.T) {
			m, duration := hostMuteTarget(g, tc.command)
			if tc.id == "" {
				if m != nil {
					t.Fatalf("ambiguous command selected %s", m.ID)
				}
			} else if m == nil || m.ID != tc.id || duration != tc.duration {
				t.Fatalf("unexpected target/duration: %+v %d", m, duration)
			}
		})
	}
}

func TestGovernanceViewerMuteCommandHasNoAuthority(t *testing.T) {
	f := newGovernanceFixture(t)
	f.request(t, "viewer_one", "POST", "messages", map[string]string{"requestId": "viewer-mute-command", "text": "@AI 把viewer_two·1234禁言"}, 201)
	g, _ := f.handler.loadGovernance(context.Background(), f.record)
	if len(g.Actions) != 0 || g.Members["viewer_two"].Mute != nil {
		t.Fatal("viewer command acquired host authority")
	}
}

func TestGovernanceUnresolvedHostCommandsNeverCreateConfirmation(t *testing.T) {
	for _, command := range []string{
		"@AI 帮我禁言那个刷屏的人", "@AI @不存在的观众 禁言他",
		"@AI @viewer_one·1234 不要禁言他", "@AI @viewer_one·1234 禁言他10分钟",
		"@AI @viewer_one·1234 @viewer_two·1234 禁言他们",
		"@AI 踢出那个刷屏的人", "@AI @不存在的观众 踢出他", "@AI @viewer_one·1234 不要踢出他",
	} {
		t.Run(command, func(t *testing.T) {
			f := newGovernanceFixture(t)
			input := map[string]string{"requestId": "unresolved-command1", "text": command}
			f.request(t, "host_test-user", "POST", "messages", input, 201)
			f.request(t, "host_test-user", "POST", "messages", input, 200)
			g, _ := f.handler.loadGovernance(context.Background(), f.record)
			if len(g.Actions) != 0 || g.Members["viewer_one"].Mute != nil || g.Members["viewer_two"].Mute != nil {
				t.Fatal("unresolved command must not create a punishment or confirmation record")
			}
			b, _ := f.handler.loadChatBuffer(context.Background(), f.record)
			notices := 0
			for _, m := range b.Messages {
				if m.Role == "system" && m.Destination == "host" && strings.Contains(m.Text, "未执行") {
					notices++
				}
			}
			if notices != 1 {
				t.Fatalf("expected one inline explanation, got %d", notices)
			}
		})
	}
}

func TestGovernanceRetiresOnlyLegacyHostCommandConfirmations(t *testing.T) {
	f := newGovernanceFixture(t)
	ctx := context.Background()
	g, _ := f.handler.loadGovernance(ctx, f.record)
	legacy := &LiveAction{ID: "old-host-mute", RequestID: "old-host-message", Kind: "mute", Actor: "assistant", Reason: "主播指令需要确认对象与处理方式", Status: "proposed", CreatedAt: time.Now().UnixMilli()}
	suggested := &LiveAction{ID: "assistant-suggestion", Kind: "mute", Actor: "assistant", Reason: "疑似违规", Status: "proposed", CreatedAt: time.Now().UnixMilli()}
	kick := &LiveAction{ID: "host-kick", RequestID: "old-kick-message", Kind: "kick", Actor: "assistant", Reason: legacy.Reason, Status: "proposed", CreatedAt: time.Now().UnixMilli()}
	g.Actions = append(g.Actions, legacy, suggested, kick)
	if err := f.handler.saveGovernance(ctx, f.record, g); err != nil {
		t.Fatal(err)
	}
	g, _ = f.handler.loadGovernance(ctx, f.record)
	if g.Actions[0].Status != "dismissed" || g.Actions[1].Status != "proposed" || g.Actions[2].Status != "dismissed" {
		t.Fatal("legacy migration changed unrelated moderation")
	}
	f.request(t, "host_test-user", "POST", "moderation", liveModerationInput{RequestID: "stale-approve-attempt", Kind: "approve", ActionID: legacy.ID, MemberID: "viewer_one"}, 400)
	if g.Members["viewer_one"].Mute != nil {
		t.Fatal("historical command executed during migration")
	}
}

func TestGovernanceAgentStreamOutlivesHTTPResponseTimeout(t *testing.T) {
	f := newGovernanceFixture(t)
	cfg := f.handler.Client.config
	cfg.RoomAgentToken = "test-independent-room-agent-credential-123"
	RegisterRoomAgent(f.router, cfg, f.handler.Auth, nil)
	server := httptest.NewUnstartedServer(f.router)
	server.Config.WriteTimeout = 50 * time.Millisecond
	server.Start()
	defer server.Close()
	client := server.Client()
	client.Timeout = 3 * time.Second
	req, _ := http.NewRequest("GET", server.URL+"/internal/live/rooms/room-voice/events", nil)
	req.Header.Set("Authorization", "Bearer "+cfg.RoomAgentToken)
	req.Header.Set("X-Live-Room-Sid", f.record.SID)
	req.Header.Set("X-Live-Assistant-Session", f.record.Assistant.SessionID)
	response, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatal(response.StatusCode)
	}
	reader := bufio.NewReader(response.Body)
	readEvent := func() {
		t.Helper()
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				t.Fatal("stream interrupted:", err)
			}
			if strings.HasPrefix(line, "data: ") {
				return
			}
		}
	}
	readEvent()
	time.Sleep(150 * time.Millisecond)
	f.handler.publishLocalRoomUpdate(f.record.ID)
	readEvent()
}
