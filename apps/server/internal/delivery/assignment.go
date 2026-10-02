package delivery

import (
	"context"
	"encoding/json"

	"companion/server/internal/behavior"
	"companion/server/internal/matching"
	"companion/server/pkg/response"
	"github.com/jackc/pgx/v5"
)

type Assignment struct {
	matching.Match
	ParticipantName string `json:"participantName"`
}

func (r Repository) Assignments(ctx context.Context, actor string) ([]Assignment, error) {
	rows, err := r.DB.Query(ctx, `SELECT c.match_id,c.id,i.id,i.name,i.age,i.avatar_url,COALESCE(NULLIF(u.name,''),'聊天用户')
 FROM conversation_takeovers t JOIN conversations c ON c.id=t.conversation_id JOIN identities i ON i.id=c.identity_id JOIN users u ON u.id=c.user_id
 WHERE t.operator_id=$1 AND c.user_id<>$1 ORDER BY c.updated_at DESC`, actor)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Assignment{}
	for rows.Next() {
		var item Assignment
		if err = rows.Scan(&item.ID, &item.ConversationID, &item.Identity.ID, &item.Identity.Name, &item.Identity.Age, &item.Identity.AvatarURL, &item.ParticipantName); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// AssignOperator is an administrative operation exposed ONLY by cmd/takeover.
// Possession of server/database access is the authority; actor identifies the
// administrator for audit, and is never taken from a public HTTP request.
// An empty operatorID revokes the assignment and restores AI ownership.
func (r Repository) AssignOperator(ctx context.Context, id, operatorID, actor string, policies behavior.Catalog) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	s, err := lockConversation(ctx, tx, id)
	if err != nil {
		return err
	}
	var user, identityID string
	if err = tx.QueryRow(ctx, `SELECT user_id,identity_id FROM conversations WHERE id=$1`, id).Scan(&user, &identityID); err != nil {
		return err
	}
	if operatorID == user {
		return response.BadRequest("聊天用户不能接管对方身份")
	}
	var previous string
	err = tx.QueryRow(ctx, `SELECT operator_id FROM conversation_takeovers WHERE conversation_id=$1`, id).Scan(&previous)
	if err != nil && err != pgx.ErrNoRows {
		return err
	}
	if previous == operatorID {
		return tx.Commit(ctx)
	}
	if operatorID == "" {
		_, err = tx.Exec(ctx, `DELETE FROM conversation_takeovers WHERE conversation_id=$1`, id)
	} else {
		_, err = tx.Exec(ctx, `INSERT INTO conversation_takeovers(conversation_id,operator_id) VALUES($1,$2) ON CONFLICT(conversation_id) DO UPDATE SET operator_id=EXCLUDED.operator_id,created_at=now()`, id, operatorID)
	}
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE proactive_preferences SET allow_proactive_ai=false,version=version+1 WHERE conversation_id=$1`, id); err != nil {
		return err
	}
	s.OwnerType = "AI"
	s.Mode = "NEVER"
	s.Version++
	if _, err = tx.Exec(ctx, `UPDATE conversations SET owner_type='AI',auto_reply_mode='NEVER',settings_version=$2,updated_at=now() WHERE id=$1`, id, s.Version); err != nil {
		return err
	}
	if err = cancelJobs(ctx, tx, id); err != nil {
		return err
	}
	var trigger string
	err = tx.QueryRow(ctx, `SELECT id::text FROM messages WHERE conversation_id=$1 AND sender_type='user' AND id=(SELECT max(id) FROM messages WHERE conversation_id=$1)`, id).Scan(&trigger)
	if err != nil && err != pgx.ErrNoRows {
		return err
	}
	if err == nil {
		if err = dispatch(ctx, tx, id, trigger, s, policies.For(identityID)); err != nil {
			return err
		}
	}
	details, _ := json.Marshal(map[string]any{"previousOperatorId": previous, "operatorId": operatorID, "settingsVersion": s.Version})
	if _, err = tx.Exec(ctx, `INSERT INTO conversation_audit(conversation_id,actor_id,action,details) VALUES($1,$2,'assignment',$3)`, id, actor, details); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
