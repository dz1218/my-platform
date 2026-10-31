package livekit

import (
	"context"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestGovernanceHistorySurvivesReadmission(t *testing.T) {
	for _, tc := range []struct {
		name   string
		userID string
	}{
		{name: "guest"},
		{name: "account", userID: "viewer-account"},
		{name: "host", userID: "test-user"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newGovernanceFixture(t)
			ctx := context.Background()
			now := time.Now().Truncate(time.Second)
			f.handler.now = func() time.Time { return now }
			var cookie *http.Cookie
			admit := func(identity, userID string) (*LiveMember, *liveRoomClaims) {
				t.Helper()
				w := httptest.NewRecorder()
				c, _ := gin.CreateTestContext(w)
				c.Request = httptest.NewRequest(http.MethodPost, "/", nil)
				if cookie != nil {
					c.Request.AddCookie(cookie)
				}
				member, token, err := f.handler.admitLiveMember(c, f.record, identity, userID, "测试成员")
				if err != nil {
					t.Fatal(err)
				}
				for _, value := range w.Result().Cookies() {
					if value.Name == liveGuestCookie {
						cookie = value
					}
				}
				if member.Role == "host" {
					f.record.Host.Identity = identity
				}
				claims, err := f.handler.parseLiveClaims(token, "room")
				if err != nil {
					t.Fatal(err)
				}
				return member, claims
			}
			activity := func(claims *liveRoomClaims, online bool, after int64) *LiveActivity {
				t.Helper()
				g, err := f.handler.loadGovernance(ctx, f.record)
				if err != nil {
					t.Fatal(err)
				}
				a := g.Admissions[claims.Subject]
				a.Online = online
				g.Admissions[claims.Subject] = a
				if err := f.handler.saveGovernance(ctx, f.record, g); err != nil {
					t.Fatal(err)
				}
				view, err := f.handler.activityView(ctx, f.record, g, claims, after)
				if err != nil {
					t.Fatal(err)
				}
				return view
			}
			buffer, err := f.handler.loadChatBuffer(ctx, f.record)
			if err != nil {
				t.Fatal(err)
			}
			f.handler.appendLiveMessage(buffer, LiveChatMessage{Role: "viewer", Text: "首次入场之前"})
			now = now.Add(time.Second)
			first, _ := admit("connection-first", tc.userID)
			now = now.Add(time.Second)
			public := f.handler.appendLiveMessage(buffer, LiveChatMessage{Role: "viewer", Text: "刷新前的公开消息"})
			private := f.handler.appendLiveMessage(buffer, LiveChatMessage{Role: "system", Text: "本人的通知", Destination: first.ID})
			f.handler.appendLiveMessage(buffer, LiveChatMessage{Role: "system", Text: "其他人的通知", Destination: "another-member"})
			hostOnly := f.handler.appendLiveMessage(buffer, LiveChatMessage{Role: "system", Text: "主播通知", Destination: "host"})
			if err := f.handler.saveChatBuffer(ctx, f.record, buffer); err != nil {
				t.Fatal(err)
			}
			want := []string{public.ID, private.ID}
			if tc.name == "host" {
				want = append(want, hostOnly.ID)
			}
			// Retry the same connection, then replace it as a full page reload does.
			for _, identity := range []string{"connection-first", "connection-refreshed"} {
				now = now.Add(time.Second)
				member, claims := admit(identity, tc.userID)
				if member.ID != first.ID {
					t.Fatal("readmission changed the member")
				}
				if view := activity(claims, false, 0); len(view.Messages) != 0 || view.Sequence != 0 {
					t.Fatal("unconfirmed presence exposed or acknowledged unseen history")
				}
				if view := activity(claims, false, public.Sequence); len(view.Messages) != 0 || view.Sequence != public.Sequence {
					t.Fatal("unconfirmed presence advanced the reconnect cursor")
				}
				view := activity(claims, true, 0)
				var got []string
				for _, message := range view.Messages {
					got = append(got, message.ID)
					if message.Destination != "" {
						t.Fatal("private routing data leaked")
					}
				}
				if !slices.Equal(got, want) {
					t.Fatalf("%s lost visible history: got %v, want %v", identity, got, want)
				}
				if view = activity(claims, true, public.Sequence); len(view.Messages) != len(want)-1 {
					t.Fatal("reconnect cursor replayed an already received message")
				}
			}
			// A different account on the same browser must start its own history.
			now = now.Add(time.Second)
			other, claims := admit("connection-other-account", "other-account")
			if other.ID == first.ID || len(activity(claims, true, 0).Messages) != 0 {
				t.Fatal("another account inherited the member's history")
			}
			// A new broadcast under the same room name must not replay the old one.
			f.record.SID += "-next"
			fresh, claims := admit("connection-next-broadcast", tc.userID)
			if fresh.ID == first.ID || len(activity(claims, true, 0).Messages) != 0 {
				t.Fatal("new broadcast inherited old history")
			}
		})
	}
}
