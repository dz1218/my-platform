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
	"strings"
	"time"
	_ "time/tzdata"
)

type Preferences struct {
	UserOptIn         bool   `json:"userOptIn"`
	AllowProactiveAI  bool   `json:"allowProactiveAI"`
	Timezone          string `json:"timezone"`
	QuietStart        int    `json:"quietStart"`
	QuietEnd          int    `json:"quietEnd"`
	MaxBatches        int    `json:"maxBatchesPer24h"`
	MinGap            int    `json:"minGapMinutes"`
	Version           int64  `json:"version"`
	AutomationEnabled bool   `json:"automationEnabled"`
	MemoryOptIn       bool   `json:"memoryOptIn"`
}

func defaultPreferences() Preferences {
	return Preferences{Timezone: "Asia/Shanghai", QuietStart: 1320, QuietEnd: 540, MaxBatches: 1, MinGap: 480, Version: 1, AutomationEnabled: true}
}
func QuietHours(now time.Time, zone string, start, end int) bool {
	loc, err := time.LoadLocation(zone)
	if err != nil {
		return true
	}
	t := now.In(loc)
	m := t.Hour()*60 + t.Minute()
	if start == end {
		return true
	} // Explicit full-day quiet window.
	if start < end {
		return m >= start && m < end
	}
	return m >= start || m < end
}
func (r Repository) Preferences(ctx context.Context, id, actor string) (Preferences, error) {
	p := defaultPreferences()
	err := r.DB.QueryRow(ctx, `SELECT automation_enabled,memory_opt_in FROM conversations c WHERE id=$1 AND `+conversation.ManageSQL, id, actor).Scan(&p.AutomationEnabled, &p.MemoryOptIn)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, forbidden()
	}
	if err != nil {
		return p, err
	}
	err = r.DB.QueryRow(ctx, `SELECT user_opt_in,allow_proactive_ai,timezone,quiet_start,quiet_end,max_batches_per_24h,min_gap_minutes,version FROM proactive_preferences WHERE conversation_id=$1`, id).Scan(&p.UserOptIn, &p.AllowProactiveAI, &p.Timezone, &p.QuietStart, &p.QuietEnd, &p.MaxBatches, &p.MinGap, &p.Version)
	if errors.Is(err, pgx.ErrNoRows) {
		err = nil
	}
	return p, err
}
func (r Repository) SavePreferences(ctx context.Context, id, actor string, p Preferences, manager bool) error {
	if _, err := time.LoadLocation(p.Timezone); err != nil || p.QuietStart < 0 || p.QuietStart > 1439 || p.QuietEnd < 0 || p.QuietEnd > 1439 || p.MaxBatches < 1 || p.MaxBatches > 3 || p.MinGap < 480 || p.MinGap > 10080 {
		return response.BadRequest("无效的时区、免打扰或频率设置")
	}
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = lockConversation(ctx, tx, id); err != nil {
		return err
	}
	// Both settings endpoints require the current assignment, checked while the
	// conversation is locked so reassignment cannot race a settings write.
	ok, err := operator(ctx, tx, id, actor)
	if err != nil {
		return err
	}
	if !ok {
		return forbidden()
	}
	if _, err = tx.Exec(ctx, `INSERT INTO proactive_preferences(conversation_id) VALUES($1) ON CONFLICT DO NOTHING`, id); err != nil {
		return err
	}
	var version int64
	if err = tx.QueryRow(ctx, `SELECT version FROM proactive_preferences WHERE conversation_id=$1`, id).Scan(&version); err != nil {
		return err
	}
	if p.Version != version {
		return &response.Error{Status: 409, Code: "version_conflict", Message: "设置已更新，请刷新后重试"}
	}
	if manager {
		_, err = tx.Exec(ctx, `UPDATE proactive_preferences SET allow_proactive_ai=$2,version=version+1 WHERE conversation_id=$1`, id, p.AllowProactiveAI)
	} else {
		_, err = tx.Exec(ctx, `UPDATE proactive_preferences SET user_opt_in=$2,timezone=$3,quiet_start=$4,quiet_end=$5,max_batches_per_24h=$6,min_gap_minutes=$7,version=version+1 WHERE conversation_id=$1`, id, p.UserOptIn, p.Timezone, p.QuietStart, p.QuietEnd, p.MaxBatches, p.MinGap)
		if err == nil {
			_, err = tx.Exec(ctx, `UPDATE conversations SET automation_enabled=$2,memory_opt_in=$3 WHERE id=$1`, id, p.AutomationEnabled, p.MemoryOptIn)
		}
	}
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE conversations SET settings_version=settings_version+1 WHERE id=$1`, id); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO conversation_audit(conversation_id,actor_id,action,details) VALUES($1,$2,'preferences','{}')`, id, actor); err != nil {
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

// Opportunities are explicitly authorized by the user and anchored to their own
// saved message. Arbitrary model speculation cannot create contact permission.
func (r Repository) AddOpportunity(ctx context.Context, id, actor, source, topic string, due, expires time.Time) error {
	if strings.TrimSpace(topic) == "" || len([]rune(topic)) > 120 || !expires.After(due) || expires.Sub(due) > 7*24*time.Hour || due.After(time.Now().Add(366*24*time.Hour)) {
		return response.BadRequest("无效的跟进主题或时间")
	}
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = lockConversation(ctx, tx, id); err != nil {
		return err
	}
	var ok bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM messages m JOIN conversations c ON c.id=m.conversation_id JOIN proactive_preferences p ON p.conversation_id=c.id WHERE c.id=$1 AND c.user_id=$2 AND m.id::text=$3 AND m.sender_type='user' AND p.user_opt_in AND c.memory_opt_in AND c.automation_enabled)`, id, actor, source).Scan(&ok)
	if err != nil {
		return err
	}
	if !ok {
		return forbidden()
	}
	_, err = tx.Exec(ctx, `INSERT INTO proactive_opportunities(id,conversation_id,topic_key,source_message_id,due_at,expires_at) VALUES($1,$2,$3,$4::bigint,$5,$6) ON CONFLICT DO NOTHING`, database.ID(), id, topic, source, due, expires)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Must be called with the conversation lock held. On subsequent batch items,
// its own first committed item is excluded from rate counts, never other batches.
func proactiveEligible(ctx context.Context, tx pgx.Tx, id, opportunity, batch string, now time.Time) (bool, error) {
	p := defaultPreferences()
	var owner, mode, status string
	var enabled, memory bool
	var due, expires time.Time
	err := tx.QueryRow(ctx, `SELECT p.user_opt_in,p.allow_proactive_ai,p.timezone,p.quiet_start,p.quiet_end,p.max_batches_per_24h,p.min_gap_minutes,c.owner_type,c.auto_reply_mode,c.automation_enabled,c.memory_opt_in,o.status,o.due_at,o.expires_at
 FROM conversations c JOIN proactive_preferences p ON p.conversation_id=c.id JOIN proactive_opportunities o ON o.conversation_id=c.id AND o.id=$2 WHERE c.id=$1`, id, opportunity).Scan(&p.UserOptIn, &p.AllowProactiveAI, &p.Timezone, &p.QuietStart, &p.QuietEnd, &p.MaxBatches, &p.MinGap, &owner, &mode, &enabled, &memory, &status, &due, &expires)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !enabled || !memory || !p.UserOptIn || (owner == "HUMAN" && (mode == "NEVER" || !p.AllowProactiveAI)) || now.Before(due) || !now.Before(expires) || (status != "PENDING" && status != "QUEUED" && !(status == "CONSUMED" && batch != "")) || QuietHours(now, p.Timezone, p.QuietStart, p.QuietEnd) {
		return false, nil
	}
	var blocked bool
	err = tx.QueryRow(ctx, `SELECT
 EXISTS(SELECT 1 FROM conversations WHERE id=$1 AND turn_status IN ('OPEN','PARTIALLY_SENT')) OR
 EXISTS(SELECT 1 FROM messages WHERE conversation_id=$1 AND created_at>$2::timestamptz-interval '10 minutes' AND COALESCE(reply_batch_id,'')<>$3) OR
 EXISTS(SELECT 1 FROM conversation_presence WHERE conversation_id=$1 AND expires_at>$2) OR
 (SELECT count(DISTINCT reply_batch_id) FROM messages WHERE conversation_id=$1 AND message_kind='PROACTIVE' AND created_at>$2::timestamptz-interval '24 hours' AND reply_batch_id<>$3)>=$4 OR
 EXISTS(SELECT 1 FROM messages WHERE conversation_id=$1 AND message_kind='PROACTIVE' AND reply_batch_id<>$3 AND created_at>$2::timestamptz-make_interval(mins=>$5))`, id, now, batch, p.MaxBatches, p.MinGap).Scan(&blocked)
	return !blocked, err
}
func (r Repository) QueueProactive(ctx context.Context, p behavior.Policy) error {
	rows, err := r.DB.Query(ctx, `SELECT id,conversation_id FROM proactive_opportunities WHERE status='PENDING' AND due_at<=now() ORDER BY due_at LIMIT 50`)
	if err != nil {
		return err
	}
	type entry struct{ id, conversation string }
	var entries []entry
	for rows.Next() {
		var e entry
		if err = rows.Scan(&e.id, &e.conversation); err != nil {
			rows.Close()
			return err
		}
		entries = append(entries, e)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, e := range entries {
		if err = r.queueOpportunity(ctx, e.conversation, e.id, p); err != nil {
			return err
		}
	}
	return nil
}
func (r Repository) queueOpportunity(ctx context.Context, id, opportunity string, p behavior.Policy) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	s, err := lockConversation(ctx, tx, id)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE proactive_opportunities SET status='EXPIRED' WHERE id=$1 AND status='PENDING' AND expires_at<=now()`, opportunity); err != nil {
		return err
	}
	var busy bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM reply_jobs WHERE conversation_id=$1 AND status IN ('queued','generating','scheduled')) OR EXISTS(SELECT 1 FROM proactive_opportunities WHERE conversation_id=$1 AND attempted_at>now()-interval '8 hours')`, id).Scan(&busy)
	if err != nil {
		return err
	}
	if busy {
		return tx.Commit(ctx)
	}
	ok, err := proactiveEligible(ctx, tx, id, opportunity, "", time.Now())
	if err != nil {
		return err
	}
	if !ok {
		return tx.Commit(ctx)
	}
	policy, err := json.Marshal(p)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO reply_jobs(conversation_id,trigger_message_id,status,due_at,policy_json,settings_version,turn_version,kind,opportunity_id)
 SELECT $1,source_message_id,'queued',now(),$3,$4,$5,'PROACTIVE',id FROM proactive_opportunities WHERE id=$2 AND status='PENDING'
 ON CONFLICT(conversation_id) DO UPDATE SET version=reply_jobs.version+1,trigger_message_id=EXCLUDED.trigger_message_id,status='queued',due_at=now(),requested_at=now(),policy_json=EXCLUDED.policy_json,settings_version=EXCLUDED.settings_version,turn_version=EXCLUDED.turn_version,kind='PROACTIVE',opportunity_id=$2,attempts=0,claim_token=NULL,lease_until=NULL`, id, opportunity, policy, s.Version, s.TurnVersion)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE proactive_opportunities SET status='QUEUED',attempted_at=now() WHERE id=$1 AND status='PENDING'`, opportunity); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
