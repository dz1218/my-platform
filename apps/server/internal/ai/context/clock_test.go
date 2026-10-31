package context

import (
	"companion/server/internal/identity"
	"encoding/json"
	"testing"
	"time"
)

func TestClockUsesConversationTimezoneAndSurvivesMissingMemory(t *testing.T) {
	now := time.Date(2026, 10, 30, 17, 0, 0, 0, time.UTC)
	for _, tc := range []struct{ zone, date, weekday, period, resolved string }{
		{"Asia/Shanghai", "2026-10-31", "星期六", "凌晨", "Asia/Shanghai"},
		{"America/Los_Angeles", "2026-10-30", "星期五", "上午", "America/Los_Angeles"},
		{"invalid", "2026-10-31", "星期六", "凌晨", "Asia/Shanghai"},
		{"", "2026-10-31", "星期六", "凌晨", "Asia/Shanghai"},
	} {
		t.Run(tc.zone, func(t *testing.T) {
			r, err := assembleRequestAt(identity.Identity{ID: "i", Name: "林晚"}, "matched", "", nil, nil, nil, now, tc.zone)
			if err != nil {
				t.Fatal(err)
			}
			var facts struct {
				Clock clockContext `json:"clock"`
			}
			if err := json.Unmarshal([]byte(r.Messages[0].Content), &facts); err != nil {
				t.Fatal(err)
			}
			want := clockContext{tc.date, tc.weekday, tc.resolved, tc.period}
			if facts.Clock != want {
				t.Fatalf("got %+v, want %+v", facts.Clock, want)
			}
		})
	}
}

func TestClockKeepsRetrySnapshotStableWithinPeriod(t *testing.T) {
	now := time.Date(2026, 10, 31, 13, 18, 0, 0, time.UTC)
	if conversationClock(now, "Asia/Shanghai") != conversationClock(now.Add(90*time.Second), "Asia/Shanghai") {
		t.Fatal("clock changes on every task retry")
	}
	if conversationClock(now, "Asia/Shanghai") == conversationClock(now.Add(24*time.Hour), "Asia/Shanghai") {
		t.Fatal("clock failed to advance to the next day")
	}
}
