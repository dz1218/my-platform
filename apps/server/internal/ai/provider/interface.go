package provider

import "context"

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}
type ChatRequest struct {
	Messages []Message `json:"messages"`
}
type Reply struct {
	Content       string `json:"content"`
	PromptVersion string `json:"promptVersion"`
}
type ChatModel interface {
	Generate(context.Context, ChatRequest) (Reply, error)
}
