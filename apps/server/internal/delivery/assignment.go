package delivery

import (
	"context"
	"strings"

	"companion/server/internal/behavior"
	"companion/server/internal/conversation"
	"companion/server/internal/matching"
	"companion/server/pkg/response"
)

type Assignment struct {
	matching.Match
	ParticipantName string `json:"participantName"`
}

func (r Repository) Assignments(ctx context.Context, actor string) ([]Assignment, error) {
	rows, err := r.DB.Query(ctx, `SELECT c.match_id,c.id,i.id,i.name,i.age,i.avatar_url,i.gender,COALESCE(NULLIF(u.name,''),'聊天用户')
 FROM conversations c JOIN identities i ON i.id=c.identity_id JOIN users u ON u.id=c.user_id
 WHERE `+strings.ReplaceAll(conversation.ManageSQL, "$2", "$1")+` ORDER BY c.updated_at DESC`, actor)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Assignment{}
	for rows.Next() {
		var item Assignment
		if err = rows.Scan(&item.ID, &item.ConversationID, &item.Identity.ID, &item.Identity.Name, &item.Identity.Age, &item.Identity.AvatarURL, &item.Identity.Gender, &item.ParticipantName); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// AssignOperator is retained only to give the retired administrative command a
// clear error. Inheritance cannot be assigned, transferred, or revoked per chat.
func (r Repository) AssignOperator(ctx context.Context, id, operatorID, actor string, policies behavior.Catalog) error {
	return response.BadRequest("按会话分配身份已停用，请用户登录后在身份选择页自行继承；已继承身份不能转让或撤销")
}
