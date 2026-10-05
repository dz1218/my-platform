package delivery

import (
	"companion/server/internal/ai/provider"
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
	Kind          string
	OpportunityID *string
	Conversation  conversation.Conversation
	Version       int64
	TriggerID     string
	ClaimToken    string
	WaitCount     int
	Attempts      int
	RequestedAt   time.Time
	Policy        behavior.Policy
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
	// Recheck after locking: inheritance may have changed since Accessible.
	var accessible bool
	if err = tx.QueryRow(ctx, `SELECT `+conversation.AccessSQL+` FROM conversations c WHERE c.id=$1`, c.ID, actor).Scan(&accessible); err != nil {
		return conversation.Message{}, err
	}
	if !accessible {
		return conversation.Message{}, forbidden()
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
		m.ServerSeq = m.ID
		m.MessageKind = "TURN_REPLY"
		return m, tx.Commit(ctx)
	} else if errors.Is(err, pgx.ErrNoRows) {
		err = tx.QueryRow(ctx, `INSERT INTO messages(conversation_id,identity_id,sender_type,driver_type,actor_id,content,request_id,status,created_at) VALUES($1,$2,$5,CASE WHEN $5='identity' THEN 'human' ELSE NULL END,$6,$3,$4,'complete',clock_timestamp()) RETURNING id::text,created_at`, c.ID, c.IdentityID, content, requestID, m.SenderType, actor).Scan(&m.ID, &m.CreatedAt)
		if err != nil {
			return m, err
		}
	} else {
		return m, err
	}
	// Only a newly accepted message consumes its sender's previous typing pulse.
	// Idempotent send retries returned above must not erase newer input presence.
	if _, err = tx.Exec(ctx, `DELETE FROM conversation_presence WHERE conversation_id=$1 AND actor_id=$2`, c.ID, actor); err != nil {
		return m, err
	}
	if human {
		_, err = tx.Exec(ctx, `UPDATE conversations SET turn_status='ANSWERED',buffer_started_at=NULL WHERE id=$1`, c.ID)
	} else {
		_, err = tx.Exec(ctx, `UPDATE conversations SET turn_id=CASE WHEN turn_status='OPEN' THEN COALESCE(turn_id,$2) ELSE $2 END,
  buffer_started_at=CASE WHEN turn_status='OPEN' THEN COALESCE(buffer_started_at,now()) ELSE now() END,turn_status='OPEN' WHERE id=$1`, c.ID, database.ID())
	}
	if err != nil {
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
	m.ServerSeq = m.ID
	m.MessageKind = "TURN_REPLY"
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
 RETURNING v.id,v.user_id,v.identity_id,j.version,j.trigger_message_id::text,j.attempts,j.requested_at,j.policy_json,j.wait_count,j.kind,j.opportunity_id`, j.ClaimToken).Scan(&j.Conversation.ID, &j.Conversation.UserID, &j.Conversation.IdentityID, &j.Version, &j.TriggerID, &j.Attempts, &j.RequestedAt, &policy, &j.WaitCount, &j.Kind, &j.OpportunityID)
	if err != nil {
		return j, err
	}
	err = json.Unmarshal(policy, &j.Policy)
	return j, err
}
func (r Repository) Schedule(ctx context.Context, j Job, content, promptVersion string, due time.Time) error {
	return r.SchedulePlan(ctx, j, provider.Reply{Action: "REPLY", Messages: []provider.PlanItem{{ClientItemKey: "1", Content: content}}, PromptVersion: promptVersion}, due)
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
 WHERE conversation_id=$1 AND version=$2 AND claim_token=$3 AND status='generating'`, j.Conversation.ID, j.Version, j.ClaimToken, status, min(300, j.Policy.RetrySeconds*(1<<min(j.Attempts-1, 5))))
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
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
