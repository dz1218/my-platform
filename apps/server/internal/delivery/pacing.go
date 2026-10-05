package delivery

import (
	"companion/server/internal/ai/provider"
	"context"
	"errors"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// Server-owned pacing is materialized once into the existing durable item dates.
// Never mutate a caller's candidate or sleep while holding a transaction.
func typingPacedItems(items []provider.PlanItem, userChars int, lastUserAt, now time.Time) []provider.PlanItem {
	out := append([]provider.PlanItem(nil), items...)
	for i := range out {
		chars := utf8.RuneCountInString(out[i].Content)
		if i == 0 {
			target := min(8000, max(1800, 1000+12*userChars+90*chars))
			elapsed := max(int64(0), now.Sub(lastUserAt).Milliseconds())
			out[i].DelayMs = int(max(int64(0), int64(target)-elapsed))
		} else {
			out[i].DelayMs = min(5000, max(1200, 600+90*chars))
		}
	}
	return out
}

// A typing pulse can postpone generation only within the original turn buffer.
// Releasing the lease refunds the attempt and never shortens a TIMEOUT/retry.
func (r Repository) deferForTyping(ctx context.Context, j Job) (bool, error) {
	if jobKind(j) != "TURN_REPLY" {
		return false, nil
	}
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	if _, err = lockConversation(ctx, tx, j.Conversation.ID); err != nil {
		return false, err
	}
	var until time.Time
	err = tx.QueryRow(ctx, `SELECT LEAST(p.expires_at,c.buffer_started_at+make_interval(secs=>$4))
 FROM conversations c JOIN conversation_presence p ON p.conversation_id=c.id AND p.actor_id=c.user_id
 JOIN reply_jobs j ON j.conversation_id=c.id
 WHERE c.id=$1 AND j.version=$2 AND j.claim_token=$3 AND j.status='generating'
 AND j.settings_version=c.settings_version AND j.turn_version=c.turn_version
 AND c.buffer_started_at IS NOT NULL
 AND LEAST(p.expires_at,c.buffer_started_at+make_interval(secs=>$4))>clock_timestamp()
 FOR UPDATE OF j`, j.Conversation.ID, j.Version, j.ClaimToken, j.Policy.BufferSeconds()).Scan(&until)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	_, err = tx.Exec(ctx, `UPDATE reply_jobs SET status='queued',due_at=GREATEST(due_at,$2),
 attempts=GREATEST(0,attempts-1),claim_token=NULL,lease_until=NULL,updated_at=now() WHERE conversation_id=$1`, j.Conversation.ID, until)
	if err != nil {
		return false, err
	}
	return true, tx.Commit(ctx)
}
