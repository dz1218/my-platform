package provider

import "context"

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}
type ChatRequest struct {
	Messages       []Message `json:"messages"`
	AllowWait      bool      `json:"allowWait"`
	MaxWaitSeconds int       `json:"maxWaitSeconds"`
	PendingSeconds int       `json:"pendingSeconds"`
}
type Reply struct {
	Action        string `json:"action,omitempty"`
	WaitSeconds   int    `json:"waitSeconds,omitempty"`
	Content       string `json:"content"`
	PromptVersion string `json:"promptVersion"`
}
type ChatModel interface {
	Generate(context.Context, ChatRequest) (Reply, error)
}
