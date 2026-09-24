package provider

import "context"

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}
type ChatRequest struct{ Messages []Message }
type StreamHandler func(string) error
type ChatModel interface {
	Stream(context.Context, ChatRequest, StreamHandler) error
}
