package delivery

import (
	"companion/server/internal/behavior"
	"companion/server/internal/conversation"
	"companion/server/pkg/database"
	"companion/server/pkg/response"
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
	WaitCount    int
	Attempts     int
	RequestedAt  time.Time
	Policy       behavior.Policy
}

// Enqueue serializes only short DB operations, never a model call.
// Acceptance, message persistence and job invalidation commit together.
func (r Repository) Enqueue(ctx context.Context, c conversation.Conversation, requestID, content string, p behavior.Policy) (conversation.Message, error) {
	return r.SendAs(ctx, c, c.UserID, requestID, content, p)
}
func (r Repository) SendAs(ctx context.Context, c conversation.Conversation, actor, requestID, content string, p behavior.Policy) (conversation.Message, error) {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return conversation.Message{}, err
	}
	defer tx.Rollback(ctx)
	settings, err := lockConversation(ctx, tx, c.ID)
	if err != nil {
		return conversation.Message{}, err
	}
	human := actor != c.UserID
	if human {
		ok, e := operator(ctx, tx, c.ID, actor)
		if e != nil {
			return conversation.Message{}, e
		}
		if !ok || settings.OwnerType != "HUMAN" {
			return conversation.Message{}, forbidden()
		}
	}
	m := conversation.Message{SenderType: "user", Source: "USER", Content: content, Status: "complete", Sender: conversation.Sender{ID: c.UserID}, RequestID: &requestID}
	if human {
		m.SenderType = "identity"
		m.Source = "HUMAN"
		m.Sender.ID = c.IdentityID
	}
	err = tx.QueryRow(ctx, `SELECT id::text,content,status,created_at FROM messages WHERE conversation_id=$1 AND request_id=$2 AND sender_type=$3 AND (sender_type='user' OR actor_id=$4)`, c.ID, requestID, m.SenderType, actor).Scan(&m.ID, &m.Content, &m.Status, &m.CreatedAt)
	if err == nil {
		if m.Content != content {
			return m, &response.Error{Status: 409, Code: "request_conflict", Message: "重复请求的消息内容不同"}
		}
		// An accepted message stays accepted even if its reply job fails.
		// Replaying a send only acknowledges the original message.
		m.Status = "complete"
		if err = tx.QueryRow(ctx, `SELECT CASE WHEN $2='user' THEN (SELECT COALESCE(name,'') FROM users WHERE id=$1) ELSE (SELECT name FROM identities WHERE id=$1) END`, m.Sender.ID, m.SenderType).Scan(&m.Sender.Name); err != nil {
			return m, err
		}
		return m, tx.Commit(ctx)
	} else if errors.Is(err, pgx.ErrNoRows) {
		err = tx.QueryRow(ctx, `INSERT INTO messages(conversation_id,identity_id,sender_type,driver_type,actor_id,content,request_id,status,created_at) VALUES($1,$2,$5,CASE WHEN $5='identity' THEN 'human' ELSE NULL END,$6,$3,$4,'complete',clock_timestamp()) RETURNING id::text,created_at`, c.ID, c.IdentityID, content, requestID, m.SenderType, actor).Scan(&m.ID, &m.CreatedAt)
		if err != nil {
			return m, err
		}
	} else {
		return m, err
	}
	settings.TurnVersion++
	if _, err = tx.Exec(ctx, `UPDATE conversations SET turn_version=$2,updated_at=now() WHERE id=$1`, c.ID, settings.TurnVersion); err != nil {
		return m, err
	}
	if err = cancelJobs(ctx, tx, c.ID); err != nil {
		return m, err
	}
	if !human {
		if err = dispatch(ctx, tx, c.ID, m.ID, settings, p); err != nil {
			return m, err
		}
	}
	if human {
		if _, err = tx.Exec(ctx, `UPDATE matches SET status='talking',updated_at=now() WHERE id=(SELECT match_id FROM conversations WHERE id=$1) AND status='matched'`, c.ID); err != nil {
			return m, err
		}
	}
	if err = tx.QueryRow(ctx, `SELECT CASE WHEN $2='user' THEN (SELECT COALESCE(name,'') FROM users WHERE id=$1) ELSE (SELECT name FROM identities WHERE id=$1) END`, m.Sender.ID, m.SenderType).Scan(&m.Sender.Name); err != nil {
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
 RETURNING v.id,v.user_id,v.identity_id,j.version,j.trigger_message_id::text,j.attempts,j.requested_at,j.policy_json,j.wait_count`, j.ClaimToken).Scan(&j.Conversation.ID, &j.Conversation.UserID, &j.Conversation.IdentityID, &j.Version, &j.TriggerID, &j.Attempts, &j.RequestedAt, &policy, &j.WaitCount)
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
	_, err = tx.Exec(ctx, `UPDATE reply_jobs SET status=$4,due_at=now()+make_interval(secs=>$5),lease_until=NULL,last_error='generation_failed',updated_at=now()
 WHERE conversation_id=$1 AND version=$2 AND claim_token=$3 AND status='generating'`, j.Conversation.ID, j.Version, j.ClaimToken, status, j.Policy.RetrySeconds*j.Attempts)
	if err != nil {
		return err
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
	settings, err := lockConversation(ctx, tx, id)
	if err != nil {
		return false, err
	}
	var version, settingsVersion, turnVersion int64
	var content, trigger string
	err = tx.QueryRow(ctx, `SELECT version,content,trigger_message_id::text,settings_version,turn_version FROM reply_jobs WHERE conversation_id=$1 AND status='scheduled' AND due_at<=now() FOR UPDATE`, id).Scan(&version, &content, &trigger, &settingsVersion, &turnVersion)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if settings.Version != settingsVersion || settings.TurnVersion != turnVersion || (settings.OwnerType == "HUMAN" && settings.Mode == "NEVER") {
		if err = cancelJobs(ctx, tx, id); err != nil {
			return false, err
		}
		return false, tx.Commit(ctx)
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

// Wait is an agent action, not a generation failure. Persist it without consuming
// the failure retry budget. New input invalidates it through the job version.
func (r Repository) Wait(ctx context.Context, j Job, seconds int) error {
	if j.WaitCount >= 1 || seconds < 1 || seconds > j.Policy.MaxWaitSeconds {
		return fmt.Errorf("agent wait exceeds execution limits")
	}
	_, err := r.DB.Exec(ctx, `UPDATE reply_jobs SET status='queued',due_at=now()+make_interval(secs=>$4),
 wait_count=wait_count+1,attempts=GREATEST(attempts-1,0),lease_until=NULL,claim_token=NULL,updated_at=now()
 WHERE conversation_id=$1 AND version=$2 AND claim_token=$3 AND status='generating'`, j.Conversation.ID, j.Version, j.ClaimToken, seconds)
	return err
}
