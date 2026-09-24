package context

import (
	"companion/server/internal/conversation"
	"testing"
)

func TestContextKeepsRecentTurnsInOrderWithinBudget(t *testing.T) {
	history := []conversation.Message{{SenderType: "user", Content: "旧消息太长了", Status: "complete"}, {SenderType: "identity", Content: "你好", Status: "complete"}, {SenderType: "user", Content: "失败消息", Status: "failed"}, {SenderType: "user", Content: "最近", Status: "pending"}}
	messages := boundedHistory("identity", history, 8)
	if len(messages) != 4 || messages[0].Role != "system" || messages[1].Role != "assistant" || messages[2].Content != "失败消息" || messages[3].Content != "最近" {
		t.Fatalf("unexpected context: %+v", messages)
	}
}
