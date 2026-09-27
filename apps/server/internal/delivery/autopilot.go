package delivery

import (
	"companion/server/internal/behavior"
	"companion/server/pkg/response"
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"time"
)

type AutoReply struct {
	OwnerType    string `json:"ownerType"`
	Mode         string `json:"mode"`
	DelaySeconds int    `json:"delaySeconds"`
	Version      int64  `json:"version"`
	TurnVersion  int64  `json:"-"`
	CanManage    bool   `json:"canManage"`
}

func lockConversation(ctx context.Context, tx pgx.Tx, id string) (AutoReply, error) {
	var s AutoReply
	err := tx.QueryRow(ctx, `SELECT owner_type,auto_reply_mode,reply_delay_seconds,settings_version,turn_version FROM conversations WHERE id=$1 FOR UPDATE`, id).Scan(&s.OwnerType, &s.Mode, &s.DelaySeconds, &s.Version, &s.TurnVersion)
	return s, err
}
func operator(ctx context.Context, tx pgx.Tx, id, actor string) (bool, error) {
	var ok bool
	err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM conversation_takeovers t JOIN conversations c ON c.id=t.conversation_id WHERE t.conversation_id=$1 AND t.operator_id=$2 AND c.user_id<>$2)`, id, actor).Scan(&ok)
	return ok, err
}
func forbidden() error {
	return &response.Error{Status: 403, Code: "forbidden", Message: "没有此会话的接管权限"}
}
func (r Repository) Settings(ctx context.Context, id, actor string) (AutoReply, error) {
	var s AutoReply
	err := r.DB.QueryRow(ctx, `SELECT owner_type,auto_reply_mode,reply_delay_seconds,settings_version,
 EXISTS(SELECT 1 FROM conversation_takeovers WHERE conversation_id=c.id AND operator_id=$2 AND c.user_id<>$2)
 FROM conversations c WHERE id=$1 AND (user_id=$2 OR EXISTS(SELECT 1 FROM conversation_takeovers WHERE conversation_id=c.id AND operator_id=$2))`, id, actor).Scan(&s.OwnerType, &s.Mode, &s.DelaySeconds, &s.Version, &s.CanManage)
	return s, err
}
func validSettings(mode string, delay int) bool {
	if mode != "NEVER" && mode != "TIMEOUT" && mode != "ALWAYS" {
		return false
	}
	switch delay {
	case 15, 30, 60, 180, 300, 600:
		return true
	}
	return false
}

// Configure cancels drafts and re-evaluates the last unanswered user message.
// Taking over requires a pre-existing assignment; clients cannot grant themselves access.
func (r Repository) Configure(ctx context.Context, id, actor string, mode string, delay int, owner string, p behavior.Policy) (AutoReply, error) {
	if owner != "" && owner != "AI" && owner != "HUMAN" {
		return AutoReply{}, response.BadRequest("无效的接管状态")
	}
	if owner == "" && !validSettings(mode, delay) {
		return AutoReply{}, response.BadRequest("无效的托管模式或等待时间")
	}
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return AutoReply{}, err
	}
	defer tx.Rollback(ctx)
	s, err := lockConversation(ctx, tx, id)
	if err != nil {
		return s, err
	}
	ok, err := operator(ctx, tx, id, actor)
	if err != nil {
		return s, err
	}
	if !ok {
		return s, forbidden()
	}
	s.CanManage = true
	if (owner != "" && s.OwnerType == owner) || (owner == "" && s.Mode == mode && s.DelaySeconds == delay) {
		return s, tx.Commit(ctx)
	}
	if owner != "" {
		s.OwnerType = owner
	} else {
		s.Mode = mode
		s.DelaySeconds = delay
	}
	s.Version++
	_, err = tx.Exec(ctx, `UPDATE conversations SET owner_type=$2,auto_reply_mode=$3,reply_delay_seconds=$4,settings_version=$5,updated_at=now() WHERE id=$1`, id, s.OwnerType, s.Mode, s.DelaySeconds, s.Version)
	if err != nil {
		return s, err
	}
	if err = cancelJobs(ctx, tx, id); err != nil {
		return s, err
	}
	// The latest message decides whether there is an unanswered turn. AI/human
	// replies share the same history and never create a new automatic reply.
	var trigger string
	err = tx.QueryRow(ctx, `SELECT id::text FROM messages WHERE conversation_id=$1 AND sender_type='user' AND id=(SELECT max(id) FROM messages WHERE conversation_id=$1)`, id).Scan(&trigger)
	if err != nil && err != pgx.ErrNoRows {
		return s, err
	}
	if err == nil {
		if err = dispatch(ctx, tx, id, trigger, s, p); err != nil {
			return s, err
		}
	}
	details, _ := json.Marshal(s)
	_, err = tx.Exec(ctx, `INSERT INTO conversation_audit(conversation_id,actor_id,action,details) VALUES($1,$2,'configure',$3)`, id, actor, details)
	if err != nil {
		return s, err
	}
	return s, tx.Commit(ctx)
}
func cancelJobs(ctx context.Context, tx pgx.Tx, id string) error {
	_, err := tx.Exec(ctx, `UPDATE reply_jobs SET status='cancelled',version=version+1,content=NULL,claim_token=NULL,lease_until=NULL,updated_at=now() WHERE conversation_id=$1 AND status IN ('queued','generating','scheduled','failed')`, id)
	return err
}
func dispatch(ctx context.Context, tx pgx.Tx, id, trigger string, s AutoReply, p behavior.Policy) error {
	if s.OwnerType == "HUMAN" && s.Mode == "NEVER" {
		return nil
	}
	delay := p.DebounceSeconds
	if s.OwnerType == "HUMAN" && s.Mode == "TIMEOUT" {
		delay = s.DelaySeconds
	}
	policy, err := json.Marshal(p)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO reply_jobs(conversation_id,trigger_message_id,status,due_at,policy_json,settings_version,turn_version)
 VALUES($1,$2::bigint,'queued',(SELECT created_at FROM messages WHERE id=$2::bigint)+make_interval(secs=>$3),$4,$5,$6)
 ON CONFLICT(conversation_id) DO UPDATE SET version=reply_jobs.version+1,trigger_message_id=EXCLUDED.trigger_message_id,
 status='queued',due_at=EXCLUDED.due_at,requested_at=now(),policy_json=EXCLUDED.policy_json,settings_version=EXCLUDED.settings_version,turn_version=EXCLUDED.turn_version,
 attempts=0,wait_count=0,content=NULL,prompt_version=NULL,lease_until=NULL,claim_token=NULL,last_error=NULL,updated_at=now()`, id, trigger, delay, policy, s.Version, s.TurnVersion)
	return err
}

// Current is checked before model invocation; final delivery checks again while
// holding the conversation lock. The model never decides who should reply.
func (r Repository) Current(ctx context.Context, j Job) (bool, error) {
	var ok bool
	err := r.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM reply_jobs j JOIN conversations c ON c.id=j.conversation_id
 WHERE j.conversation_id=$1 AND j.version=$2 AND j.claim_token=$3 AND j.status='generating'
 AND j.settings_version=c.settings_version AND j.turn_version=c.turn_version AND (c.owner_type='AI' OR c.auto_reply_mode<>'NEVER'))`, j.Conversation.ID, j.Version, j.ClaimToken).Scan(&ok)
	return ok, err
}

// A transaction-scoped advisory lock serializes model calls across workers and
// across superseding turns without blocking human sends or settings changes.
func (r Repository) generationLock(ctx context.Context, id string) (func(), bool, error) {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return nil, false, err
	}
	var ok bool
	err = tx.QueryRow(ctx, `SELECT pg_try_advisory_xact_lock(hashtextextended($1, 72391))`, id).Scan(&ok)
	release := func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = tx.Rollback(cleanup)
	}
	if err != nil || !ok {
		release()
		return nil, false, err
	}
	return release, true, nil
}
func (r Repository) deferBusy(ctx context.Context, j Job) error {
	_, err := r.DB.Exec(ctx, `UPDATE reply_jobs SET status='queued',due_at=now()+interval '1 second',attempts=GREATEST(attempts-1,0),claim_token=NULL,lease_until=NULL WHERE conversation_id=$1 AND version=$2 AND claim_token=$3 AND status='generating'`, j.Conversation.ID, j.Version, j.ClaimToken)
	return err
}

// CancelClaim only retires this exact lease; it cannot cancel a newer turn.
func (r Repository) CancelClaim(ctx context.Context, j Job) error {
	_, err := r.DB.Exec(ctx, `UPDATE reply_jobs SET status='cancelled',content=NULL,claim_token=NULL,lease_until=NULL,updated_at=now() WHERE conversation_id=$1 AND version=$2 AND claim_token=$3 AND status='generating'`, j.Conversation.ID, j.Version, j.ClaimToken)
	return err
}
