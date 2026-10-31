package provider

import "context"

type Message struct {
	ID      string `json:"id,omitempty"`
	Role    string `json:"role"`
	Content string `json:"content"`
	Source  string `json:"source,omitempty"`
}
type ChatRequest struct {
	ContractVersion int         `json:"contractVersion,omitempty"`
	Run             *RunContext `json:"run,omitempty"`
	Kind            string      `json:"kind,omitempty"`
	Messages        []Message   `json:"messages"`
	AllowWait       bool        `json:"allowWait"`
	MaxWaitSeconds  int         `json:"maxWaitSeconds"`
	PendingSeconds  int         `json:"pendingSeconds"`
}
type PlanItem struct {
	ClientItemKey string `json:"clientItemKey"`
	Content       string `json:"content"`
	DelayMs       int    `json:"delayMs"`
}
type MemoryProposal struct {
	SourceMessageID string  `json:"sourceMessageId"`
	Kind            string  `json:"kind"`
	Content         string  `json:"content"`
	FactKey         string  `json:"factKey,omitempty"`
	SourceQuote     string  `json:"sourceQuote,omitempty"`
	Assertion       string  `json:"assertion,omitempty"`
	ValidUntil      *string `json:"validUntil,omitempty"`
}
type Reply struct {
	Execution       *Execution       `json:"execution,omitempty"`
	Summary         string           `json:"summary,omitempty"`
	MemoryProposals []MemoryProposal `json:"memoryProposals,omitempty"`

	Messages      []PlanItem `json:"messages,omitempty"`
	Action        string     `json:"action,omitempty"`
	WaitSeconds   int        `json:"waitSeconds,omitempty"`
	Content       string     `json:"content"`
	PromptVersion string     `json:"promptVersion"`
}
type RunContext struct {
	ID               string `json:"id"`
	ClaimToken       string `json:"claimToken"`
	ConversationID   string `json:"conversationId"`
	UserID           string `json:"userId"`
	IdentityID       string `json:"identityId"`
	SettingsVersion  int64  `json:"settingsVersion"`
	TurnVersion      int64  `json:"turnVersion"`
	MemoryRevision   int64  `json:"memoryRevision"`
	ThroughMessageID string `json:"throughMessageId"`
	InputHash        string `json:"inputHash"`
	Deadline         string `json:"deadline"`
	MemoryEnabled    bool   `json:"memoryEnabled"`
}
type Evidence struct {
	ID      string `json:"id"`
	Version int64  `json:"version"`
	Hash    string `json:"hash"`
	Kind    string `json:"kind"`
	Content string `json:"content,omitempty"`
}
type Execution struct {
	RunID          string     `json:"runId"`
	InputHash      string     `json:"inputHash"`
	MemoryRevision int64      `json:"memoryRevision"`
	GraphVersion   string     `json:"graphVersion"`
	Model          string     `json:"model,omitempty"`
	IndexVersion   string     `json:"indexVersion,omitempty"`
	ModelCalls     int        `json:"modelCalls"`
	RetrievalCalls int        `json:"retrievalCalls"`
	InputTokens    int        `json:"inputTokens"`
	OutputTokens   int        `json:"outputTokens"`
	Evidence       []Evidence `json:"evidence"`
}
type ChatModel interface {
	Generate(context.Context, ChatRequest) (Reply, error)
}
