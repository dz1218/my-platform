package delivery

import (
	"companion/server/internal/behavior"
	"companion/server/pkg/response"
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
)

// InheritIdentity serializes account and identity claims with match creation.
// The immutable unique row is the authority for both existing and future chats.
func (r Repository) InheritIdentity(ctx context.Context, user, identityID string, policies behavior.Catalog) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var gender *string
	if err = tx.QueryRow(ctx, `SELECT gender FROM users WHERE id=$1 FOR NO KEY UPDATE`, user).Scan(&gender); err != nil {
		return err
	}
	if gender == nil {
		return response.BadRequest("请先设置性别，再选择继承身份")
	}
	var previous string
	err = tx.QueryRow(ctx, `SELECT identity_id FROM identity_inheritances WHERE user_id=$1`, user).Scan(&previous)
	if err == nil {
		if previous == identityID {
			return tx.Commit(ctx)
		}
		return &response.Error{Status: 409, Code: "already_inherited", Message: "每个账号只能继承一个身份"}
	}
	if err != pgx.ErrNoRows {
		return err
	}
	var identityGender string
	if err = tx.QueryRow(ctx, `SELECT gender FROM identities WHERE id=$1 FOR NO KEY UPDATE`, identityID).Scan(&identityGender); err != nil {
		return err
	}
	if identityGender != *gender {
		return &response.Error{Status: 403, Code: "gender_mismatch", Message: "只能继承与账号性别相同的 AI 身份"}
	}
	var claimed bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM identity_inheritances WHERE identity_id=$1)`, identityID).Scan(&claimed); err != nil {
		return err
	}
	if claimed {
		return &response.Error{Status: 409, Code: "identity_unavailable", Message: "这个身份已被其他用户继承，请选择其他身份"}
	}
	// Acquire all conversation locks before publishing ownership. Settings writes,
	// messages and deliveries therefore finish before or after this entire change.
	rows, err := tx.Query(ctx, `SELECT id FROM conversations WHERE identity_id=$1 ORDER BY id FOR UPDATE`, identityID)
	if err != nil {
		return err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO identity_inheritances(identity_id,user_id) VALUES($1,$2)`, identityID, user); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE users SET onboarding_completed=true,updated_at=now() WHERE id=$1`, user); err != nil {
		return err
	}
	for _, id := range ids {
		if _, err = tx.Exec(ctx, `UPDATE conversations SET owner_type='HUMAN',auto_reply_mode='TIMEOUT',reply_delay_seconds=120,settings_version=settings_version+1,updated_at=now() WHERE id=$1`, id); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `UPDATE proactive_preferences SET allow_proactive_ai=false,version=version+1 WHERE conversation_id=$1`, id); err != nil {
			return err
		}
		if err = cancelJobs(ctx, tx, id); err != nil {
			return err
		}
		var trigger string
		err = tx.QueryRow(ctx, `SELECT m.id::text FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.id=$1 AND c.user_id<>$2 AND c.turn_status='OPEN' AND m.sender_type='user' ORDER BY m.id DESC LIMIT 1`, id, user).Scan(&trigger)
		if err != nil && err != pgx.ErrNoRows {
			return err
		}
		if err == nil {
			settings, e := lockConversation(ctx, tx, id)
			if e != nil {
				return e
			}
			if err = dispatch(ctx, tx, id, trigger, settings, policies.For(identityID)); err != nil {
				return err
			}
		}
		details, _ := json.Marshal(map[string]string{"identityId": identityID})
		if _, err = tx.Exec(ctx, `INSERT INTO conversation_audit(conversation_id,actor_id,action,details) VALUES($1,$2,'inherit_identity',$3)`, id, user, details); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
