package delivery

import (
	"companion/server/internal/behavior"
	"companion/server/internal/conversation"
	"companion/server/pkg/response"
	"context"
	"strings"
	"unicode/utf8"
)

type Service struct {
	Repo     Repository
	Messages conversation.Repository
	Policies behavior.Catalog
}

func (s Service) Send(ctx context.Context, userID, conversationID, requestID, content string) (conversation.Message, error) {
	if strings.TrimSpace(content) == "" || utf8.RuneCountInString(content) > 2000 || len(requestID) < 8 || len(requestID) > 80 {
		return conversation.Message{}, response.BadRequest("消息不能为空、不能超过 2000 字，并需要有效请求编号")
	}
	c, err := s.Messages.Owned(ctx, userID, conversationID)
	if err != nil {
		return conversation.Message{}, err
	}
	return s.Repo.Enqueue(ctx, c, requestID, content, s.Policies.For(c.IdentityID))
}
