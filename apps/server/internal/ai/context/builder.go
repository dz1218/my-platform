package context

import (
	"companion/server/internal/ai/provider"
	"companion/server/internal/conversation"
	"companion/server/internal/identity"
	"context"
	"encoding/json"
	"errors"
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
	return assembleRequest(i, stage, summary, memories, state, page.Items)
}

// Leave room under the Agent's 64 KiB transport limit for scheduling metadata
// and a proactive follow-up's original user message (at most 2000 runes).
const requestBudget = 48 * 1024

func assembleRequest(i identity.Identity, stage, summary string, memories, state json.RawMessage, history []conversation.Message) (provider.ChatRequest, error) {
	if len(memories) == 0 {
		memories = json.RawMessage(`[]`)
	}
	if len(state) == 0 {
		state = json.RawMessage(`null`)
	}
	facts := map[string]any{
		"identity": map[string]any{
			"id": i.ID, "name": i.Name, "age": i.Age, "gender": i.Gender,
			"city": i.City, "background": i.Background,
			"occupationCode": i.OccupationCode, "occupation": i.Occupation,
			"persona": i.Persona, "personaVersion": i.PersonaVersion, "fictional": true,
		},
		"relationshipStage": stage, "summary": summary,
		"memories": memories, "fictionalDailyState": state,
	}
	encoded, err := json.Marshal(facts)
	if err != nil {
		return provider.ChatRequest{}, err
	}
	request := provider.ChatRequest{Messages: boundedHistory(string(encoded), history, 12000)}
	return BoundRequest(request)
}

// BoundRequest also applies to enrichment, which replaces the initial history
// with messages up to its leased cursor after Build has returned.
func BoundRequest(request provider.ChatRequest) (provider.ChatRequest, error) {
	if len(request.Messages) == 0 || request.Messages[0].Role != "system" {
		return provider.ChatRequest{}, errors.New("missing identity context")
	}
	var facts map[string]json.RawMessage
	if err := json.Unmarshal([]byte(request.Messages[0].Content), &facts); err != nil {
		return provider.ChatRequest{}, err
	}
	for {
		body, err := json.Marshal(request)
		if err != nil {
			return provider.ChatRequest{}, err
		}
		if len(body) <= requestBudget && len(request.Messages) <= 41 {
			return request, nil
		}
		// Keep the complete current message and identity. Optional older context
		// is discarded first, including JSON escaping in the byte accounting.
		if len(request.Messages) > 2 {
			request.Messages = append(request.Messages[:1], request.Messages[2:]...)
			continue
		}
		if len(facts["summary"]) > 0 && string(facts["summary"]) != `""` {
			facts["summary"] = json.RawMessage(`""`)
		} else if len(facts["memories"]) > 0 && string(facts["memories"]) != "[]" {
			facts["memories"] = json.RawMessage(`[]`)
		} else if len(facts["fictionalDailyState"]) > 0 && string(facts["fictionalDailyState"]) != "null" {
			facts["fictionalDailyState"] = json.RawMessage(`null`)
		} else {
			return provider.ChatRequest{}, errors.New("identity and current message exceed context budget")
		}
		encoded, err := json.Marshal(facts)
		if err != nil {
			return provider.ChatRequest{}, err
		}
		request.Messages[0].Content = string(encoded)
	}
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
