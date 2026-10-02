package provider

import "context"

type Message struct {
	ID      string `json:"id,omitempty"`
	Role    string `json:"role"`
	Content string `json:"content"`
	Source  string `json:"source,omitempty"`
}
type ChatRequest struct {
	Kind           string    `json:"kind,omitempty"`
	Messages       []Message `json:"messages"`
	AllowWait      bool      `json:"allowWait"`
	MaxWaitSeconds int       `json:"maxWaitSeconds"`
	PendingSeconds int       `json:"pendingSeconds"`
}
type PlanItem struct {
	ClientItemKey string `json:"clientItemKey"`
	Content       string `json:"content"`
	DelayMs       int    `json:"delayMs"`
}
type MemoryProposal struct {
	SourceMessageID string `json:"sourceMessageId"`
	Kind            string `json:"kind"`
	Content         string `json:"content"`
}
type Reply struct {
	Summary         string           `json:"summary,omitempty"`
	MemoryProposals []MemoryProposal `json:"memoryProposals,omitempty"`

	Messages      []PlanItem `json:"messages,omitempty"`
	Action        string     `json:"action,omitempty"`
	WaitSeconds   int        `json:"waitSeconds,omitempty"`
	Content       string     `json:"content"`
	PromptVersion string     `json:"promptVersion"`
}
type ChatModel interface {
	Generate(context.Context, ChatRequest) (Reply, error)
}
