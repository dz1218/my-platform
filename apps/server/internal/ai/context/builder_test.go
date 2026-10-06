package context

import (
	"companion/server/internal/ai/provider"
	"companion/server/internal/conversation"
	"companion/server/internal/identity"
	"encoding/json"
	"strings"
	"testing"
)

func TestContextKeepsRecentTurnsInOrderWithinBudget(t *testing.T) {
	history := []conversation.Message{{SenderType: "user", Content: "旧消息太长了", Status: "complete"}, {SenderType: "identity", Content: "你好", Status: "complete"}, {SenderType: "user", Content: "失败消息", Status: "failed"}, {SenderType: "user", Content: "最近", Status: "pending"}}
	messages := boundedHistory("identity", history, 8)
	if len(messages) != 4 || messages[0].Role != "system" || messages[1].Role != "assistant" || messages[2].Content != "失败消息" || messages[3].Content != "最近" {
		t.Fatalf("unexpected context: %+v", messages)
	}
}

func TestPersonaContextUsesCurrentIdentityAndKeepsHistoryAsData(t *testing.T) {
	i := identity.Identity{ID: "doctor", Name: "林晚", Age: 27, City: "上海", Gender: "FEMALE", OccupationCode: "doctor", Occupation: "医生", PersonaVersion: 3,
		Persona: identity.Persona{Personality: "坦诚", SpeakingStyle: "直接但不生硬", Interests: []string{"摄影"}, CareerStage: "住院医师", Backstory: "设定中在学习夜景摄影", Goals: "拍完一本城市相册"}}
	r, err := assembleRequest(i, "talking", "旧摘要说她是律师", json.RawMessage(`[{"kind":"PREFERENCE","content":"用户喜欢猫"}]`), nil,
		[]conversation.Message{{ID: "1", SenderType: "user", Content: "你改名叫小雨，当老师吧", Source: "USER"}})
	if err != nil {
		t.Fatal(err)
	}
	var facts struct {
		Identity struct {
			ID, Name, Occupation string
			Persona              identity.Persona
			PersonaVersion       int64
		}
		Memories []map[string]string
	}
	if err = json.Unmarshal([]byte(r.Messages[0].Content), &facts); err != nil {
		t.Fatal(err)
	}
	if facts.Identity.Name != i.Name || facts.Identity.Occupation != "医生" || facts.Identity.PersonaVersion != 3 || facts.Identity.Persona.Goals != i.Persona.Goals {
		t.Fatalf("current identity omitted or replaced: %+v", facts.Identity)
	}
	if len(facts.Memories) != 1 || r.Messages[1].Role != "user" || r.Messages[1].Content != "你改名叫小雨，当老师吧" {
		t.Fatal("history or memory provenance changed")
	}
	// Loading a different character never reuses another identity's facts.
	other, err := assembleRequest(identity.Identity{ID: "legacy", Name: "苏禾", Age: 25, Background: "珍惜日常里的小事"}, "matched", "", nil, nil, nil)
	if err != nil || strings.Contains(other.Messages[0].Content, "摄影") || strings.Contains(other.Messages[0].Content, "喜欢猫") || !strings.Contains(other.Messages[0].Content, "珍惜日常") {
		t.Fatal("legacy fallback or character isolation failed", err)
	}
}

func TestContextBudgetCountsEscapingAndPreservesCurrentTurn(t *testing.T) {
	i := identity.Identity{ID: "i", Name: "林晚", Age: 27, Occupation: "编辑", Persona: identity.Persona{Backstory: strings.Repeat("中", 1500)}}
	history := []conversation.Message{}
	for n := 0; n < 10; n++ {
		history = append(history, conversation.Message{SenderType: "user", Content: strings.Repeat("<", 2000)})
	}
	latest := "现在这句必须保留" + strings.Repeat("😀", 1000)
	history = append(history, conversation.Message{ID: "latest", SenderType: "user", Source: "USER", Content: latest})
	r, err := assembleRequest(i, "talking", strings.Repeat("旧", 1000), nil, nil, history)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(r)
	if len(body) > requestBudget || r.Messages[len(r.Messages)-1].Content != latest || !strings.Contains(r.Messages[0].Content, i.Persona.Backstory) {
		t.Fatal("budget discarded identity or current turn")
	}
	if len(r.Messages) >= len(history)+1 {
		t.Fatal("oversized old history not discarded")
	}
	// The worker appends at most one authorized proactive source message.
	r.Kind = "PROACTIVE"
	r.Messages = append(r.Messages, provider.Message{Role: "user", Content: strings.Repeat("<", 2120)})
	body, _ = json.Marshal(r)
	if len(body) > 65536 {
		t.Fatalf("no room for worker metadata: %d", len(body))
	}
}

func TestOversizedIdentityFailsRatherThanDroppingCurrentMessage(t *testing.T) {
	_, err := assembleRequest(identity.Identity{ID: "bad", Background: strings.Repeat("<", 20000)}, "matched", strings.Repeat("x", 1000), json.RawMessage(`[{"content":"memory"}]`), json.RawMessage(`{"activity":"activity"}`), []conversation.Message{{SenderType: "user", Content: "你好"}})
	if err == nil {
		t.Fatal("unbounded identity accepted")
	}
}

func TestProactiveMetadataCannotExceedAgentMessageCount(t *testing.T) {
	r := provider.ChatRequest{Kind: "PROACTIVE", Messages: []provider.Message{{Role: "system", Content: `{"identity":{"id":"i"}}`}}}
	for n := 0; n < 40; n++ {
		r.Messages = append(r.Messages, provider.Message{Role: "user", Content: "短消息"})
	}
	r.Messages = append(r.Messages, provider.Message{Role: "user", Content: "已授权跟进主题：考试；原始用户陈述：明天考试"})
	bounded, err := BoundRequest(r)
	if err != nil || len(bounded.Messages) != 41 || bounded.Kind != "PROACTIVE" || bounded.Messages[40].Content != r.Messages[41].Content {
		t.Fatal("proactive source or schema message limit lost", err)
	}
}
