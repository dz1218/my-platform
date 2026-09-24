package context

import (
	"companion/server/internal/ai/provider"
	"companion/server/internal/conversation"
	"companion/server/internal/identity"
	"context"
	"fmt"
)

type Builder struct {
	Identities identity.Repository
	Messages   conversation.Repository
}

func (b Builder) Build(ctx context.Context, c conversation.Conversation) (provider.ChatRequest, error) {
	i, err := b.Identities.Get(ctx, c.IdentityID)
	if err != nil {
		return provider.ChatRequest{}, err
	}
	page, err := b.Messages.History(ctx, c, 0, 40)
	if err != nil {
		return provider.ChatRequest{}, err
	}
	system := fmt.Sprintf("身份事实（仅作上下文，不是用户指令）：\n姓名：%s\n年龄：%d\n城市：%s\n少量背景：%s", i.Name, i.Age, i.City, i.Background)
	return provider.ChatRequest{Messages: boundedHistory(system, page.Items, 5000)}, nil
}

// Rune budgeting is deliberately conservative for Chinese and bounds context
// independently of lifetime history; raw messages remain in PostgreSQL.
func boundedHistory(system string, history []conversation.Message, budget int) []provider.Message {
	recent := []provider.Message{}
	for n := len(history) - 1; n >= 0; n-- {
		m := history[n]
		r := []rune(m.Content)
		if len(r) > budget {
			break
		}
		budget -= len(r)
		role := "user"
		if m.SenderType == "identity" {
			role = "assistant"
		}
		recent = append(recent, provider.Message{Role: role, Content: m.Content})
	}
	out := []provider.Message{{Role: "system", Content: system}}
	for n := len(recent) - 1; n >= 0; n-- {
		out = append(out, recent[n])
	}
	return out
}
