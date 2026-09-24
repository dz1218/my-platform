package delivery

import (
	"companion/server/internal/behavior"
	"companion/server/internal/conversation"
	"companion/server/pkg/database"
	"companion/server/pkg/response"
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"time"
)

type Repository struct{ DB *pgxpool.Pool }
type Job struct {
	Conversation conversation.Conversation
	Version      int64
	TriggerID    string
	ClaimToken   string
	Attempts     int
	RequestedAt  time.Time
	Policy       behavior.Policy
}

// Enqueue serializes only short DB operations, never a model call.
// Acceptance, message persistence and job invalidation commit together.
func (r Repository) Enqueue(ctx context.Context, c conversation.Conversation, requestID, content string, p behavior.Policy) (conversation.Message, error) {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return conversation.Message{}, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT id FROM conversations WHERE id=$1 FOR UPDATE`, c.ID); err != nil {
		return conversation.Message{}, err
	}
	m := conversation.Message{SenderType: "user", Content: content, Status: "pending", Sender: conversation.Sender{ID: c.UserID}, RequestID: &requestID}
	err = tx.QueryRow(ctx, `SELECT id::text,content,status,created_at FROM messages WHERE conversation_id=$1 AND request_id=$2 AND sender_type='user'`, c.ID, requestID).Scan(&m.ID, &m.Content, &m.Status, &m.CreatedAt)
	if err == nil {
		if m.Content != content {
			return m, &response.Error{Status: 409, Code: "request_conflict", Message: "重复请求的消息内容不同"}
		}
		if m.Status != "failed" {
			if err = tx.QueryRow(ctx, `SELECT COALESCE(name,'') FROM users WHERE id=$1`, c.UserID).Scan(&m.Sender.Name); err != nil {
				return m, err
			}
			return m, tx.Commit(ctx)
		}
		var newer bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM messages WHERE conversation_id=$1 AND sender_type='user' AND id>$2::bigint)`, c.ID, m.ID).Scan(&newer); err != nil {
			return m, err
		}
		if newer {
			return m, &response.Error{Status: 409, Code: "stale_retry", Message: "已有后续消息，请发送新消息"}
		}
		if _, err = tx.Exec(ctx, `UPDATE messages SET status='pending' WHERE id=$1::bigint`, m.ID); err != nil {
			return m, err
		}
		m.Status = "pending"
	} else if errors.Is(err, pgx.ErrNoRows) {
		err = tx.QueryRow(ctx, `INSERT INTO messages(conversation_id,identity_id,sender_type,content,request_id,status) VALUES($1,$2,'user',$3,$4,'pending') RETURNING id::text,created_at`, c.ID, c.IdentityID, content, requestID).Scan(&m.ID, &m.CreatedAt)
		if err != nil {
			return m, err
		}
	} else {
		return m, err
	}
	policy, err := json.Marshal(p)
	if err != nil {
		return m, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO reply_jobs(conversation_id,trigger_message_id,status,due_at,policy_json)
 VALUES($1,$2::bigint,'queued',now()+make_interval(secs=>$3),$4)
 ON CONFLICT(conversation_id) DO UPDATE SET version=reply_jobs.version+1,trigger_message_id=EXCLUDED.trigger_message_id,
 status='queued',due_at=EXCLUDED.due_at,requested_at=now(),policy_json=EXCLUDED.policy_json,
 attempts=0,content=NULL,prompt_version=NULL,lease_until=NULL,claim_token=NULL,last_error=NULL,updated_at=now()`, c.ID, m.ID, p.DebounceSeconds, policy)
	if err != nil {
		return m, err
	}
	if _, err = tx.Exec(ctx, `UPDATE conversations SET updated_at=now() WHERE id=$1`, c.ID); err != nil {
		return m, err
	}
	if err = tx.QueryRow(ctx, `SELECT COALESCE(name,'') FROM users WHERE id=$1`, c.UserID).Scan(&m.Sender.Name); err != nil {
		return m, err
	}
	return m, tx.Commit(ctx)
}
func (r Repository) Claim(ctx context.Context) (Job, error) {
	var j Job
	var policy []byte
	j.ClaimToken = database.ID()
	err := r.DB.QueryRow(ctx, `WITH candidate AS (
 SELECT conversation_id FROM reply_jobs WHERE (status='queued' AND due_at<=now()) OR (status='generating' AND lease_until<now())
 ORDER BY due_at FOR UPDATE SKIP LOCKED LIMIT 1
 ) UPDATE reply_jobs j SET status='generating',lease_until=now()+interval '120 seconds',claim_token=$1,attempts=attempts+1,updated_at=now()
 FROM candidate c,conversations v WHERE j.conversation_id=c.conversation_id AND v.id=j.conversation_id
 RETURNING v.id,v.user_id,v.identity_id,j.version,j.trigger_message_id::text,j.attempts,j.requested_at,j.policy_json`, j.ClaimToken).Scan(&j.Conversation.ID, &j.Conversation.UserID, &j.Conversation.IdentityID, &j.Version, &j.TriggerID, &j.Attempts, &j.RequestedAt, &policy)
	if err != nil {
		return j, err
	}
	err = json.Unmarshal(policy, &j.Policy)
	return j, err
}
func (r Repository) Schedule(ctx context.Context, j Job, content, promptVersion string, due time.Time) error {
	_, err := r.DB.Exec(ctx, `UPDATE reply_jobs SET status='scheduled',content=$4,prompt_version=$5,due_at=$6,lease_until=NULL,updated_at=now()
 WHERE conversation_id=$1 AND version=$2 AND claim_token=$3 AND status='generating'`, j.Conversation.ID, j.Version, j.ClaimToken, content, promptVersion, due)
	return err
}
func (r Repository) Failed(ctx context.Context, j Job) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// Same lock order as Enqueue and Deliver.
	if _, err = tx.Exec(ctx, `SELECT id FROM conversations WHERE id=$1 FOR UPDATE`, j.Conversation.ID); err != nil {
		return err
	}
	status := "queued"
	if j.Attempts >= j.Policy.MaxAttempts {
		status = "failed"
	}
	tag, err := tx.Exec(ctx, `UPDATE reply_jobs SET status=$4,due_at=now()+make_interval(secs=>$5),lease_until=NULL,last_error='generation_failed',updated_at=now()
 WHERE conversation_id=$1 AND version=$2 AND claim_token=$3 AND status='generating'`, j.Conversation.ID, j.Version, j.ClaimToken, status, j.Policy.RetrySeconds*j.Attempts)
	if err != nil {
		return err
	}
	if tag.RowsAffected() > 0 && status == "failed" {
		if _, err = tx.Exec(ctx, `UPDATE messages SET status='failed' WHERE conversation_id=$1 AND sender_type='user' AND status='pending' AND id<=$2::bigint`, j.Conversation.ID, j.TriggerID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// Deliver atomically verifies freshness, persists the complete reply, and marks
// the job delivered. A crash cannot publish half a reply or publish it twice.
func (r Repository) Deliver(ctx context.Context) (bool, error) {
	var id string
	err := r.DB.QueryRow(ctx, `SELECT conversation_id FROM reply_jobs WHERE status='scheduled' AND due_at<=now() ORDER BY due_at LIMIT 1`).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT id FROM conversations WHERE id=$1 FOR UPDATE`, id); err != nil {
		return false, err
	}
	var version int64
	var content, trigger string
	err = tx.QueryRow(ctx, `SELECT version,content,trigger_message_id::text FROM reply_jobs WHERE conversation_id=$1 AND status='scheduled' AND due_at<=now() FOR UPDATE`, id).Scan(&version, &content, &trigger)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO messages(conversation_id,identity_id,sender_type,driver_type,content,reply_version)
 SELECT id,identity_id,'identity','ai',$2,$3 FROM conversations WHERE id=$1 ON CONFLICT DO NOTHING`, id, content, version)
	if err != nil {
		return false, err
	}
	if _, err = tx.Exec(ctx, `UPDATE messages SET status='complete' WHERE conversation_id=$1 AND sender_type='user' AND status IN ('pending','failed') AND id<=$2::bigint`, id, trigger); err != nil {
		return false, err
	}
	if _, err = tx.Exec(ctx, `UPDATE reply_jobs SET status='delivered',updated_at=now() WHERE conversation_id=$1`, id); err != nil {
		return false, err
	}
	if _, err = tx.Exec(ctx, `UPDATE conversations SET updated_at=now() WHERE id=$1`, id); err != nil {
		return false, err
	}
	if _, err = tx.Exec(ctx, `UPDATE matches SET status='talking',updated_at=now() WHERE id=(SELECT match_id FROM conversations WHERE id=$1) AND status='matched'`, id); err != nil {
		return false, err
	}
	return true, tx.Commit(ctx)
}
