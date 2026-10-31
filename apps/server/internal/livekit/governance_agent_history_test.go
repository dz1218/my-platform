package livekit

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestAssistantHistorySurvivesBufferTrimmingAndFiltersPublicMessages(t *testing.T) {
	f := newGovernanceFixture(t)
	ctx := context.Background()
	b, err := f.handler.loadChatBuffer(ctx, f.record)
	if err != nil {
		t.Fatal(err)
	}
	f.handler.now = func() time.Time { return time.Now().Add(-time.Hour) }
	old := f.handler.appendLiveMessage(b, LiveChatMessage{MemberID: "viewer_one", Name: "听众·FE7A", Role: "viewer", Text: "先前的原话 100%_"})
	f.handler.appendLiveMessage(b, LiveChatMessage{Name: "系统", Role: "system", Text: "给主播的私有提示", Destination: "host"})
	f.handler.appendLiveMessage(b, LiveChatMessage{Name: "系统", Role: "system", Text: "给观众的私有提示", Destination: "viewer_one"})
	if err = f.handler.saveChatBuffer(ctx, f.record, b); err != nil {
		t.Fatal(err)
	}
	f.handler.now = time.Now
	b, err = f.handler.loadChatBuffer(ctx, f.record)
	if err != nil || len(b.Messages) != 0 {
		t.Fatal("old delivery messages did not expire", err)
	}
	for i := 0; i < 1005; i++ {
		f.handler.appendLiveMessage(b, LiveChatMessage{MemberID: "viewer_two", Name: "观众二", Role: "viewer", Text: fmt.Sprintf("新消息%04d", i) + strings.Repeat("文", 490)})
	}
	if err = f.handler.saveChatBuffer(ctx, f.record, b); err != nil {
		t.Fatal(err)
	}
	if len(b.Messages) != 1000 {
		t.Fatal("browser delivery window changed")
	}
	// A retry must not duplicate archived messages.
	if err = f.handler.saveChatBuffer(ctx, f.record, b); err != nil {
		t.Fatal(err)
	}
	page, err := f.handler.readRoomHistory(ctx, f.record, roomHistoryQuery{Member: "fe7a", Query: "100%_", Limit: 30})
	if err != nil || len(page.Messages) != 1 || page.Messages[0].ID != old.ID {
		t.Fatal("old speaker history missing", page, err)
	}
	page, err = f.handler.readRoomHistory(ctx, f.record, roomHistoryQuery{Member: "viewer_one", Limit: 30})
	if err != nil || len(page.Messages) != 1 {
		t.Fatal("member ID lookup failed", page, err)
	}
	count := 0
	query := roomHistoryQuery{Limit: 50, Through: b.Sequence}
	for {
		page, err = f.handler.readRoomHistory(ctx, f.record, query)
		if err != nil {
			t.Fatal(err)
		}
		for i, message := range page.Messages {
			if message.Destination != "" {
				t.Fatal("private message leaked")
			}
			if i > 0 && message.Sequence <= page.Messages[i-1].Sequence {
				t.Fatal("history is not chronological")
			}
		}
		count += len(page.Messages)
		if page.NextBefore == nil {
			break
		}
		if query.Before != 0 && *page.NextBefore >= query.Before {
			t.Fatal("pagination did not advance")
		}
		query.Before = *page.NextBefore
	}
	if count != 1006 {
		t.Fatalf("got %d public messages, want 1006", count)
	}
	page, err = f.handler.readRoomHistory(ctx, f.record, roomHistoryQuery{Through: old.Sequence, Limit: 30})
	if err != nil || len(page.Messages) != 1 {
		t.Fatal("history escaped turn snapshot", page, err)
	}
	nextRoom := *f.record
	nextRoom.SID += "_next"
	page, err = f.handler.readRoomHistory(ctx, &nextRoom, roomHistoryQuery{Limit: 30})
	if err != nil || len(page.Messages) != 0 {
		t.Fatal("history crossed room incarnation", page, err)
	}
}

func TestAssistantHistoryRequiresActiveSession(t *testing.T) {
	f := newGovernanceFixture(t)
	cfg := f.handler.Client.config
	cfg.RoomAgentToken = "test-independent-room-agent-credential-123"
	RegisterRoomAgent(f.router, cfg, f.handler.Auth, nil)
	for _, tc := range []struct {
		token, sid, session, query string
		status                     int
	}{
		{"browser-token", f.record.SID, f.record.Assistant.SessionID, "", 401},
		{cfg.RoomAgentToken, "RM_other", f.record.Assistant.SessionID, "", 409},
		{cfg.RoomAgentToken, f.record.SID, "old-session", "", 409},
		{cfg.RoomAgentToken, f.record.SID, f.record.Assistant.SessionID, "?before=invalid", 400},
		{cfg.RoomAgentToken, f.record.SID, f.record.Assistant.SessionID, "?limit=1000", 400},
		{cfg.RoomAgentToken, f.record.SID, f.record.Assistant.SessionID, "", 200},
	} {
		req := httptest.NewRequest("GET", "/internal/live/rooms/room-voice/history"+tc.query, nil)
		req.Header.Set("Authorization", "Bearer "+tc.token)
		req.Header.Set("X-Live-Room-Sid", tc.sid)
		req.Header.Set("X-Live-Assistant-Session", tc.session)
		res := httptest.NewRecorder()
		f.router.ServeHTTP(res, req)
		if res.Code != tc.status {
			t.Fatalf("history got %d want %d: %s", res.Code, tc.status, res.Body.String())
		}
	}
}

func TestAssistantEventsIncludePreJoinHistoryAndStartBoundary(t *testing.T) {
	f := newGovernanceFixture(t)
	ctx := context.Background()
	f.handler.now = func() time.Time { return time.UnixMilli(f.record.Assistant.StartedAt - 1000) }
	b, err := f.handler.loadChatBuffer(ctx, f.record)
	if err != nil {
		t.Fatal(err)
	}
	old := f.handler.appendLiveMessage(b, LiveChatMessage{Role: "viewer", Text: "助手入场前的消息"})
	f.handler.appendLiveMessage(b, LiveChatMessage{Role: "system", Text: "私有通知", Destination: "host"})
	if err = f.handler.saveChatBuffer(ctx, f.record, b); err != nil {
		t.Fatal(err)
	}
	cfg := f.handler.Client.config
	cfg.RoomAgentToken = "test-independent-room-agent-credential-123"
	RegisterRoomAgent(f.router, cfg, f.handler.Auth, nil)
	server := httptest.NewServer(f.router)
	defer server.Close()
	client := server.Client()
	client.Timeout = 3 * time.Second
	req, _ := http.NewRequest("GET", server.URL+"/internal/live/rooms/room-voice/events", nil)
	req.Header.Set("Authorization", "Bearer "+cfg.RoomAgentToken)
	req.Header.Set("X-Live-Room-Sid", f.record.SID)
	req.Header.Set("X-Live-Assistant-Session", f.record.Assistant.SessionID)
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	line, err := bufio.NewReader(res.Body).ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	var event struct {
		Messages  []LiveChatMessage `json:"messages"`
		StartedAt int64             `json:"assistantStartedAt"`
	}
	if err = json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &event); err != nil {
		t.Fatal(err)
	}
	if len(event.Messages) != 1 || event.Messages[0].ID != old.ID || event.StartedAt != f.record.Assistant.StartedAt {
		t.Fatal("assistant history or trigger boundary missing", event)
	}
}
