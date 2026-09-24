package runtime

import (
	aicontext "companion/server/internal/ai/context"
	"companion/server/internal/ai/provider"
	"companion/server/internal/conversation"
	"companion/server/pkg/response"
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"
)

type Runtime struct {
	Messages conversation.Repository
	Builder  aicontext.Builder
	Model    provider.ChatModel
	Enabled  bool
}
type Turn struct {
	Conversation  conversation.Conversation
	UserMessageID string
	Unlock        func()
}

func (r Runtime) Prepare(ctx context.Context, userID, conversationID, requestID, content string) (Turn, error) {
	if !r.Enabled {
		return Turn{}, &response.Error{Status: 503, Code: "chat_unavailable", Message: "暂时无法回复，请稍后再来"}
	}
	if strings.TrimSpace(content) == "" || utf8.RuneCountInString(content) > 2000 || len(requestID) < 8 || len(requestID) > 80 {
		return Turn{}, response.BadRequest("消息不能为空、不能超过 2000 字，并需要有效请求编号")
	}
	c, err := r.Messages.Owned(ctx, userID, conversationID)
	if err != nil {
		return Turn{}, err
	}
	unlock, err := r.Messages.Lock(ctx, c.ID)
	if err != nil {
		return Turn{}, err
	}
	id, err := r.Messages.BeginMessage(ctx, c, requestID, content)
	if err != nil {
		unlock()
		return Turn{}, err
	}
	return Turn{Conversation: c, UserMessageID: id, Unlock: unlock}, nil
}
func (r Runtime) Reply(ctx context.Context, turn Turn, handler provider.StreamHandler) (conversation.Message, error) {
	defer turn.Unlock()
	complete := false
	defer func() {
		if !complete {
			cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = r.Messages.Fail(cleanup, turn.UserMessageID)
		}
	}()
	request, err := r.Builder.Build(ctx, turn.Conversation)
	if err != nil {
		return conversation.Message{}, err
	}
	var content strings.Builder
	err = r.Model.Stream(ctx, request, func(delta string) error {
		if content.Len()+len(delta) > 32000 {
			return errors.New("reply exceeds limit")
		}
		content.WriteString(delta)
		return handler(delta)
	})
	if err != nil {
		return conversation.Message{}, err
	}
	if strings.TrimSpace(content.String()) == "" {
		return conversation.Message{}, errors.New("empty model reply")
	}
	// Once upstream completes, persist even if the browser disconnected at the end.
	save, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	m, err := r.Messages.Complete(save, turn.Conversation, turn.UserMessageID, content.String())
	complete = err == nil
	return m, err
}
