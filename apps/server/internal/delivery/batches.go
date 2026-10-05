package delivery

import (
	"companion/server/internal/ai/provider"
	"companion/server/pkg/database"
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"log/slog"
	"time"
	"unicode/utf8"
)

// SchedulePlan persists drafts only after validating the generating lease and snapshot.
func (r Repository) SchedulePlan(ctx context.Context, j Job, plan provider.Reply, due time.Time) error {
	if err := provider.ValidatePlan(plan); err != nil {
		return err
	}
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	s, err := lockConversation(ctx, tx, j.Conversation.ID)
	if err != nil {
		return err
	}
	var version, turnVersion int64
	var turnID *string
	err = tx.QueryRow(ctx, `SELECT j.settings_version,j.turn_version,c.turn_id FROM reply_jobs j JOIN conversations c ON c.id=j.conversation_id
 WHERE j.conversation_id=$1 AND j.version=$2 AND j.claim_token=$3 AND j.status='generating' FOR UPDATE OF j`, j.Conversation.ID, j.Version, j.ClaimToken).Scan(&version, &turnVersion, &turnID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if !s.AutomationEnabled || s.Version != version || s.TurnVersion != turnVersion || (s.OwnerType == "HUMAN" && s.Mode == "NEVER") {
		return cancelAndCommit(ctx, tx, j.Conversation.ID)
	}
	if j.Kind == "PROACTIVE" {
		if j.OpportunityID == nil {
			return errors.New("missing opportunity")
		}
		ok, e := proactiveEligible(ctx, tx, j.Conversation.ID, *j.OpportunityID, "", time.Now())
		if e != nil {
			return e
		}
		if !ok {
			return cancelAndCommit(ctx, tx, j.Conversation.ID)
		}
	}
	if plan.Action == "SILENCE" {
		if j.OpportunityID != nil {
			if _, err = tx.Exec(ctx, `UPDATE proactive_opportunities SET status='SILENCE' WHERE id=$1 AND status='QUEUED'`, *j.OpportunityID); err != nil {
				return err
			}
		}
		if _, err = tx.Exec(ctx, `UPDATE reply_jobs SET status='delivered',lease_until=NULL,updated_at=now() WHERE conversation_id=$1`, j.Conversation.ID); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `UPDATE conversations SET turn_status='ANSWERED',buffer_started_at=NULL WHERE id=$1`, j.Conversation.ID); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	if j.Policy.ReplyPacing == "typing" {
		userChars, lastUserAt := 0, due
		if jobKind(j) == "TURN_REPLY" {
			// Include only this buffered turn, also excluding turns answered silently.
			// The final lease check above prevents a superseded turn using this data.
			err = tx.QueryRow(ctx, `SELECT COALESCE(sum(length(content)),0),max(created_at) FROM messages
 WHERE conversation_id=$1 AND sender_type='user' AND id<=$2::bigint
 AND created_at>=COALESCE((SELECT buffer_started_at FROM conversations WHERE id=$1),'-infinity'::timestamptz)
 AND id>COALESCE((SELECT max(id) FROM messages WHERE conversation_id=$1 AND sender_type='identity' AND id<$2::bigint),0)`, j.Conversation.ID, j.TriggerID).Scan(&userChars, &lastUserAt)
			if err != nil {
				return err
			}
		}
		plan.Messages = typingPacedItems(plan.Messages, userChars, lastUserAt, due)
	}
	batch := database.ID()
	_, err = tx.Exec(ctx, `INSERT INTO reply_batches(id,conversation_id,job_version,turn_id,turn_version,settings_version,status,prompt_version,kind,opportunity_id) VALUES($1,$2,$3,$4,$5,$6,'PENDING',$7,$8,$9)`, batch, j.Conversation.ID, j.Version, turnID, turnVersion, version, plan.PromptVersion, jobKind(j), j.OpportunityID)
	if err != nil {
		return err
	}
	for n, m := range plan.Messages {
		due = due.Add(time.Duration(m.DelayMs) * time.Millisecond)
		_, err = tx.Exec(ctx, `INSERT INTO reply_items(id,batch_id,item_index,client_item_key,content,due_at) VALUES($1,$2,$3,$4,$5,$6)`, database.ID(), batch, n, m.ClientItemKey, m.Content, due)
		if err != nil {
			return err
		}
	}
	_, err = tx.Exec(ctx, `UPDATE reply_jobs SET status='scheduled',content=NULL,prompt_version=$2,due_at=(SELECT min(due_at) FROM reply_items WHERE batch_id=$3),lease_until=NULL,updated_at=now() WHERE conversation_id=$1`, j.Conversation.ID, plan.PromptVersion, batch)
	if err != nil {
		return err
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	chars, delay := 0, 0
	for _, m := range plan.Messages {
		chars += utf8.RuneCountInString(m.Content)
		delay += m.DelayMs
	}
	slog.Info("reply planned", "promptVersion", plan.PromptVersion, "policyVersion", j.Policy.Version,
		"bubbleCount", len(plan.Messages), "characterCount", chars, "pacingDelayMs", delay)
	return nil
}
func cancelAndCommit(ctx context.Context, tx pgx.Tx, id string) error {
	if err := cancelJobs(ctx, tx, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Each item becomes a real message in its own short transaction. Conversation
// locking orders user/human/configuration changes against this final gate.
func (r Repository) Deliver(ctx context.Context) (bool, error) {
	var id string
	err := r.DB.QueryRow(ctx, `SELECT conversation_id FROM reply_jobs WHERE status='scheduled' AND due_at<=clock_timestamp() ORDER BY due_at LIMIT 1`).Scan(&id)
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
	s, err := lockConversation(ctx, tx, id)
	if err != nil {
		return false, err
	}
	var version, sv, tv int64
	err = tx.QueryRow(ctx, `SELECT version,settings_version,turn_version FROM reply_jobs WHERE conversation_id=$1 AND status='scheduled' AND due_at<=clock_timestamp() FOR UPDATE`, id).Scan(&version, &sv, &tv)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !s.AutomationEnabled || s.Version != sv || s.TurnVersion != tv || (s.OwnerType == "HUMAN" && s.Mode == "NEVER") {
		return false, cancelAndCommit(ctx, tx, id)
	}
	var batch, item, content, kind, promptVersion string
	var itemDue time.Time
	var opportunity *string
	var index int
	err = tx.QueryRow(ctx, `SELECT b.id,i.id,i.content,i.item_index,b.kind,b.opportunity_id,b.prompt_version,i.due_at FROM reply_batches b JOIN reply_items i ON i.batch_id=b.id AND i.item_index=b.next_item_index
 WHERE b.conversation_id=$1 AND b.job_version=$2 AND b.status='PENDING' AND i.status='PENDING' FOR UPDATE OF b,i`, id, version).Scan(&batch, &item, &content, &index, &kind, &opportunity, &promptVersion, &itemDue)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if kind == "PROACTIVE" {
		if opportunity == nil {
			return false, errors.New("missing opportunity")
		}
		ok, e := proactiveEligible(ctx, tx, id, *opportunity, batch, time.Now())
		if e != nil {
			return false, e
		}
		if !ok {
			return false, cancelAndCommit(ctx, tx, id)
		}
	}
	var message string
	err = tx.QueryRow(ctx, `INSERT INTO messages(conversation_id,identity_id,sender_type,driver_type,content,reply_batch_id,reply_item_id,message_kind)
 SELECT id,identity_id,'identity','ai',$2,$3,$4,$5 FROM conversations WHERE id=$1 RETURNING id::text`, id, content, batch, item, kind).Scan(&message)
	if err != nil {
		return false, err
	}
	if _, err = tx.Exec(ctx, `UPDATE reply_items SET status='COMMITTED',committed_message_id=$2::bigint WHERE id=$1`, item, message); err != nil {
		return false, err
	}
	// Rebase all remaining dates together so their original relative gaps survive
	// a late worker or restart. clock_timestamp avoids a transaction's stale now().
	if _, err = tx.Exec(ctx, `WITH timing AS MATERIALIZED (SELECT GREATEST(interval '0',clock_timestamp()-$2::timestamptz) AS lateness)
 UPDATE reply_items SET due_at=due_at+timing.lateness FROM timing WHERE batch_id=$1 AND status='PENDING'`, batch, itemDue); err != nil {
		return false, err
	}
	if opportunity != nil {
		if _, err = tx.Exec(ctx, `UPDATE proactive_opportunities SET status='CONSUMED',consumed_batch_id=$2 WHERE id=$1`, *opportunity, batch); err != nil {
			return false, err
		}
	}
	var nextDue time.Time
	err = tx.QueryRow(ctx, `SELECT due_at FROM reply_items WHERE batch_id=$1 AND item_index=$2`, batch, index+1).Scan(&nextDue)
	last := errors.Is(err, pgx.ErrNoRows)
	if err != nil && !last {
		return false, err
	}
	batchStatus, jobStatus, turnStatus := "PENDING", "scheduled", "PARTIALLY_SENT"
	if kind == "PROACTIVE" {
		turnStatus = "ANSWERED"
	}
	if last {
		batchStatus, jobStatus, turnStatus = "COMPLETED", "delivered", "ANSWERED"
	}
	if _, err = tx.Exec(ctx, `UPDATE reply_batches SET next_item_index=next_item_index+1,status=$2 WHERE id=$1`, batch, batchStatus); err != nil {
		return false, err
	}
	if _, err = tx.Exec(ctx, `UPDATE reply_jobs SET status=$2,due_at=$3,updated_at=now() WHERE conversation_id=$1`, id, jobStatus, nextDue); err != nil {
		return false, err
	}
	if _, err = tx.Exec(ctx, `UPDATE conversations SET turn_status=$2,buffer_started_at=NULL,updated_at=now() WHERE id=$1`, id, turnStatus); err != nil {
		return false, err
	}
	if _, err = tx.Exec(ctx, `UPDATE matches SET status='talking',updated_at=now() WHERE id=(SELECT match_id FROM conversations WHERE id=$1) AND status='matched'`, id); err != nil {
		return false, err
	}
	if err = tx.Commit(ctx); err != nil {
		return false, err
	}
	slog.Info("reply item delivered", "promptVersion", promptVersion, "itemIndex", index,
		"characterCount", utf8.RuneCountInString(content), "deliveryLagMs", max(int64(0), time.Since(itemDue).Milliseconds()))
	return true, nil
}

func jobKind(j Job) string {
	if j.Kind == "PROACTIVE" {
		return j.Kind
	}
	return "TURN_REPLY"
}
