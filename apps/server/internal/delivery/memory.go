package delivery

import (
	"companion/server/internal/conversation"
	"companion/server/pkg/database"
	"companion/server/pkg/response"
	"context"
	"strings"
	"time"
)

type Memory struct {
	ID              string `json:"id"`
	Kind            string `json:"kind"`
	Content         string `json:"content"`
	SourceMessageID string `json:"sourceMessageId"`
	Provenance      string `json:"provenance"`
	Version         int64  `json:"version"`
}

func (r Repository) Memories(ctx context.Context, id, actor string) ([]Memory, error) {
	var ok bool
	if err := r.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM conversations WHERE id=$1 AND user_id=$2)`, id, actor).Scan(&ok); err != nil {
		return nil, err
	}
	if !ok {
		return nil, forbidden()
	}
	rows, err := r.DB.Query(ctx, `SELECT id,kind,content,source_message_id::text,provenance,version FROM conversation_memories WHERE conversation_id=$1 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 100`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Memory{}
	for rows.Next() {
		var m Memory
		if err = rows.Scan(&m.ID, &m.Kind, &m.Content, &m.SourceMessageID, &m.Provenance, &m.Version); err != nil {
			return nil, err
		}
		items = append(items, m)
	}
	return items, rows.Err()
}
func (r Repository) SaveMemory(ctx context.Context, id, actor string, m Memory, remove bool) error {
	if !remove && (strings.TrimSpace(m.Content) == "" || len([]rune(m.Content)) > 300 || (m.Kind != "FACT" && m.Kind != "PREFERENCE" && m.Kind != "EXPERIENCE" && m.Kind != "BOUNDARY")) {
		return response.BadRequest("无效的记忆内容")
	}
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = lockConversation(ctx, tx, id); err != nil {
		return err
	}
	var allowed bool
	if err = tx.QueryRow(ctx, `SELECT user_id=$2 AND (memory_opt_in OR $3) FROM conversations WHERE id=$1`, id, actor, remove).Scan(&allowed); err != nil {
		return err
	}
	if !allowed {
		return forbidden()
	}
	if remove {
		// Rejecting a pending proposal creates a tombstone as well.
		if _, err = tx.Exec(ctx, `INSERT INTO conversation_memories(id,conversation_id,source_message_id,kind,content,provenance,deleted_at) SELECT id,conversation_id,source_message_id,kind,'[deleted]',provenance,now() FROM memory_proposals WHERE id=$1 AND conversation_id=$2 ON CONFLICT DO NOTHING`, m.ID, id); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `DELETE FROM memory_proposals WHERE id=$1 AND conversation_id=$2`, m.ID, id); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE conversation_memories SET deleted_at=now(),content='[deleted]',version=version+1 WHERE id=$1 AND conversation_id=$2 AND deleted_at IS NULL`, m.ID, id)
	} else if m.ID != "" {
		tag, e := tx.Exec(ctx, `UPDATE conversation_memories SET content=$3,kind=$4,version=version+1,updated_at=now() WHERE id=$1 AND conversation_id=$2 AND version=$5 AND deleted_at IS NULL`, m.ID, id, m.Content, m.Kind, m.Version)
		err = e
		if err == nil && tag.RowsAffected() != 1 {
			return &response.Error{Status: 409, Code: "version_conflict", Message: "记忆已更新或删除"}
		}
	} else {
		var provenance string
		err = tx.QueryRow(ctx, `SELECT CASE WHEN sender_type='user' THEN 'USER_ASSERTED' WHEN driver_type='human' THEN 'HUMAN_AUTHORED' ELSE 'AI_FICTIONAL' END FROM messages WHERE conversation_id=$1 AND id::text=$2`, id, m.SourceMessageID).Scan(&provenance)
		if err != nil {
			return err
		}
		// Tombstones and uniqueness prevent a deleted memory from being recreated by stale proposals.
		_, err = tx.Exec(ctx, `INSERT INTO conversation_memories(id,conversation_id,kind,content,source_message_id,provenance) VALUES($1,$2,$3,$4,$5::bigint,$6) ON CONFLICT DO NOTHING`, database.ID(), id, m.Kind, m.Content, m.SourceMessageID, provenance)
	}
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM memory_proposals p WHERE p.conversation_id=$1 AND EXISTS(SELECT 1 FROM conversation_memories m WHERE m.conversation_id=p.conversation_id AND m.source_message_id=p.source_message_id AND m.kind=p.kind)`, id); err != nil {
		return err
	}
	// Cancel candidates which might still contain the old/deleted memory.
	if _, err = tx.Exec(ctx, `UPDATE conversations SET settings_version=settings_version+1,summary='' WHERE id=$1`, id); err != nil {
		return err
	}
	if err = cancelJobs(ctx, tx, id); err != nil {
		return err
	}
	if err = refreshPendingOpen(ctx, tx, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

type DailyState struct {
	Fictional       bool      `json:"fictional"`
	CurrentActivity string    `json:"currentActivity"`
	Mood            string    `json:"mood"`
	Paused          bool      `json:"paused"`
	Version         int64     `json:"version"`
	ExpiresAt       time.Time `json:"expiresAt"`
}

func (r Repository) DailyState(ctx context.Context, id, actor string) (DailyState, error) {
	var d DailyState
	err := r.DB.QueryRow(ctx, `SELECT s.fictional,s.current_activity,s.mood,s.paused,s.version,s.expires_at FROM identity_daily_state s JOIN conversations c ON c.identity_id=s.identity_id WHERE c.id=$1 AND `+conversation.AccessSQL, id, actor).Scan(&d.Fictional, &d.CurrentActivity, &d.Mood, &d.Paused, &d.Version, &d.ExpiresAt)
	return d, err
}
func (r Repository) SaveDailyState(ctx context.Context, id, actor string, d DailyState) error {
	if !d.Fictional || strings.TrimSpace(d.CurrentActivity) == "" || len([]rune(d.CurrentActivity)) > 300 || len([]rune(d.Mood)) > 80 || !d.ExpiresAt.After(time.Now()) || d.ExpiresAt.After(time.Now().Add(48*time.Hour)) {
		return response.BadRequest("虚拟状态需要有效内容和 48 小时内的到期时间")
	}
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// Identity is shared. Lock every affected conversation in a stable order, so
	// editing invalidates candidates for all users of this identity atomically.
	rows, err := tx.Query(ctx, `SELECT c.id FROM conversations c WHERE c.identity_id=(SELECT identity_id FROM conversations WHERE id=$1) ORDER BY c.id FOR UPDATE`, id)
	if err != nil {
		return err
	}
	var ids []string
	for rows.Next() {
		var cid string
		if err = rows.Scan(&cid); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, cid)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	ok, err := operator(ctx, tx, id, actor)
	if err != nil {
		return err
	}
	if !ok {
		return forbidden()
	}
	var identity string
	if err = tx.QueryRow(ctx, `SELECT identity_id FROM conversations WHERE id=$1`, id).Scan(&identity); err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `INSERT INTO identity_daily_state(identity_id,current_activity,mood,paused,expires_at,editor_id)
 SELECT $1,$2,$3,$4,$5,$6 WHERE $7::bigint=0
 ON CONFLICT DO NOTHING`, identity, d.CurrentActivity, d.Mood, d.Paused, d.ExpiresAt, actor, d.Version)
	if err != nil {
		return err
	}
	if d.Version != 0 {
		tag, err = tx.Exec(ctx, `UPDATE identity_daily_state SET current_activity=$2,mood=$3,paused=$4,expires_at=$5,editor_id=$6,version=version+1 WHERE identity_id=$1 AND version=$7`, identity, d.CurrentActivity, d.Mood, d.Paused, d.ExpiresAt, actor, d.Version)
	}
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return &response.Error{Status: 409, Code: "version_conflict", Message: "虚拟状态已更新，请刷新后重试"}
	}
	for _, cid := range ids {
		if _, err = tx.Exec(ctx, `UPDATE conversations SET settings_version=settings_version+1 WHERE id=$1`, cid); err != nil {
			return err
		}
		if err = cancelJobs(ctx, tx, cid); err != nil {
			return err
		}
		if err = refreshPendingOpen(ctx, tx, cid); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(ctx, `INSERT INTO conversation_audit(conversation_id,actor_id,action,details) VALUES($1,$2,'daily_state','{}')`, id, actor); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r Repository) MemoryProposals(ctx context.Context, id, actor string) ([]Memory, error) {
	rows, err := r.DB.Query(ctx, `SELECT p.id,p.kind,p.content,p.source_message_id::text,p.provenance FROM memory_proposals p JOIN conversations c ON c.id=p.conversation_id WHERE c.id=$1 AND c.user_id=$2 AND c.memory_opt_in ORDER BY p.source_message_id DESC LIMIT 20`, id, actor)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Memory{}
	for rows.Next() {
		var m Memory
		if err = rows.Scan(&m.ID, &m.Kind, &m.Content, &m.SourceMessageID, &m.Provenance); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
