package delivery

import (
	"companion/server/internal/ai/provider"
	"strings"
	"testing"
	"time"
)

func TestTypingPacingBoundsAndElapsedTime(t *testing.T) {
	now := time.Unix(1700000000, 0)
	for _, tc := range []struct {
		name        string
		content     string
		userChars   int
		elapsed     time.Duration
		first, next int
	}{
		{"short", "好", 1, 0, 1800, 1200},
		{"unicode", "😀你好世界😀你好世界", 0, 0, 1900, 1500},
		{"input reading", "好的", 100, 0, 2380, 1200},
		{"deduct generation", "好的", 100, time.Second, 1380, 1200},
		{"already waited", "好的", 100, 10 * time.Second, 0, 1200},
		{"clock skew", "好的", 0, -time.Second, 1800, 1200},
		{"maximum", strings.Repeat("长", 160), 2000, 0, 8000, 5000},
	} {
		t.Run(tc.name, func(t *testing.T) {
			items := []provider.PlanItem{{ClientItemKey: "1", Content: tc.content, DelayMs: 9999}, {ClientItemKey: "2", Content: tc.content}, {ClientItemKey: "3", Content: tc.content}}
			paced := typingPacedItems(items, tc.userChars, now.Add(-tc.elapsed), now)
			if paced[0].DelayMs != tc.first || paced[1].DelayMs != tc.next || paced[2].DelayMs != tc.next {
				t.Fatalf("unexpected pacing: %+v", paced)
			}
			if items[0].DelayMs != 9999 {
				t.Fatal("mutated candidate")
			}
			if err := provider.ValidatePlan(provider.Reply{Action: "REPLY", Messages: paced}); err != nil {
				t.Fatal(err)
			}
		})
	}
}
