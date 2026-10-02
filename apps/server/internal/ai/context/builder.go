package context

import (
	"companion/server/internal/ai/provider"
	"companion/server/internal/conversation"
	"companion/server/internal/identity"
	"context"
	"encoding/json"
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
	var summary, stage string
	if err = b.Messages.DB.QueryRow(ctx, `SELECT CASE WHEN c.memory_opt_in THEN c.summary ELSE '' END,m.status FROM conversations c JOIN matches m ON m.id=c.match_id WHERE c.id=$1`, c.ID).Scan(&summary, &stage); err != nil {
		return provider.ChatRequest{}, err
	}
	var memories, state []byte
	if err = b.Messages.DB.QueryRow(ctx, `SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM (SELECT kind,content,provenance FROM conversation_memories WHERE conversation_id=$1 AND deleted_at IS NULL AND (SELECT memory_opt_in FROM conversations WHERE id=$1) ORDER BY updated_at DESC LIMIT 12) x`, c.ID).Scan(&memories); err != nil {
		return provider.ChatRequest{}, err
	}
	if err = b.Messages.DB.QueryRow(ctx, `SELECT COALESCE((SELECT jsonb_build_object('fictional',true,'activity',current_activity,'mood',mood,'version',version) FROM identity_daily_state WHERE identity_id=$1 AND NOT paused AND expires_at>now()),'null'::jsonb)`, c.IdentityID).Scan(&state); err != nil {
		return provider.ChatRequest{}, err
	}
	facts, _ := json.Marshal(map[string]any{"identity": system, "relationshipStage": stage, "summary": summary, "memories": json.RawMessage(memories), "fictionalDailyState": json.RawMessage(state)})
	return provider.ChatRequest{Messages: boundedHistory(string(facts), page.Items, 12000)}, nil
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
		recent = append(recent, provider.Message{ID: m.ID, Role: role, Content: m.Content, Source: m.Source})
	}
	out := []provider.Message{{Role: "system", Content: system}}
	for n := len(recent) - 1; n >= 0; n-- {
		out = append(out, recent[n])
	}
	return out
}
