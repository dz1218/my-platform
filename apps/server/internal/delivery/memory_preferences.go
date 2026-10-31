package delivery

import (
	"companion/server/internal/conversation"
	"companion/server/pkg/response"
	"context"
	"github.com/jackc/pgx/v5"
	"regexp"
	"strings"
	"time"
)

type MemoryPreferences struct {
	Enabled        bool  `json:"enabled"`
	Version        int64 `json:"version"`
	ConsentVersion int   `json:"consentVersion"`
}

func memoryConflict() error {
	return &response.Error{Status: 409, Code: "version_conflict", Message: "记忆已更新，请刷新后重试"}
}

var credentialPattern = regexp.MustCompile(`(?i)(密码|验证码|口令|私钥|password|verification.?code|api[_ -]?key|access[_ -]?token|bearer\s|sk-[a-z0-9]{12}|-----BEGIN.*PRIVATE KEY)`)

func containsCredential(s string) bool { return credentialPattern.MatchString(s) }

var uncertainPattern = regexp.MustCompile(`(?i)(假如|假设|如果|开玩笑|逗你|也许|可能|打算|准备|计划|明天|下周|希望|要是|并不是|不是说|不是真的|imagine|maybe|joking|planning)`)
var sensitivePattern = regexp.MustCompile(`(?i)(病|诊断|药|医院|住址|身份证|银行卡|性取向|性生活|宗教|政治|创伤|自杀|抑郁|经纬度|diagnos|medical|address|trauma)`)
var firstPersonFact = regexp.MustCompile(`^我(叫|的名字|住|在|是|喜欢|爱|不喜欢|讨厌|习惯|更喜欢|不想|不希望|不吃|不能吃|现在住|目前住)`)

func (r Repository) MemoryPreferences(ctx context.Context, id, actor string) (MemoryPreferences, error) {
	var p MemoryPreferences
	err := r.DB.QueryRow(ctx, `SELECT memory_opt_in AND memory_consent_version=2,memory_revision,memory_consent_version FROM conversations c WHERE id=$1 AND user_id=$2 AND `+conversation.AccessSQL, id, actor).Scan(&p.Enabled, &p.Version, &p.ConsentVersion)
	return p, err
}

// Invalidate all derived state atomically. Cleanup may lag, but every read and
// final send is fenced by the newly committed revision immediately.
func invalidateMemory(ctx context.Context, tx pgx.Tx, id string) error {
	statements := []string{
		// Previous AI replies may repeat a forgotten fact without a retrieval
		// citation (including the legacy runner). Conservatively suppress those
		// existing derived messages from future context, keeping the transcript.
		`INSERT INTO agent_forgotten_sources SELECT m.conversation_id,m.id FROM messages m WHERE m.conversation_id=$1 AND m.driver_type='ai' AND m.id>(SELECT min(source_message_id) FROM agent_forgotten_sources WHERE conversation_id=$1) ON CONFLICT DO NOTHING`,
		`DELETE FROM memory_proposals p USING agent_forgotten_sources f WHERE p.conversation_id=$1 AND f.conversation_id=p.conversation_id AND f.source_message_id=p.source_message_id`,
		`UPDATE proactive_opportunities o SET status='CANCELED' FROM conversations c WHERE o.conversation_id=c.id AND c.id=$1 AND o.status IN ('PENDING','QUEUED') AND (NOT c.memory_opt_in OR o.source_message_id<=c.memory_forget_through OR EXISTS(SELECT 1 FROM agent_forgotten_sources f WHERE f.conversation_id=c.id AND f.source_message_id=o.source_message_id))`,
		`UPDATE conversations SET memory_revision=memory_revision+1,settings_version=settings_version+1,summary='',summary_through_message_id=NULL WHERE id=$1`,
		`UPDATE context_jobs SET status='DONE',lease_until=NULL WHERE conversation_id=$1`,
		`DELETE FROM agent_documents WHERE conversation_id=$1`,
		`INSERT INTO agent_backfills(conversation_id,through_message_id) SELECT id,memory_forget_through FROM conversations WHERE id=$1 ON CONFLICT(conversation_id) DO UPDATE SET through_message_id=EXCLUDED.through_message_id,dirty=true`,
		`INSERT INTO agent_cleanup_jobs(conversation_id,before_revision) SELECT id,memory_revision FROM conversations WHERE id=$1 ON CONFLICT(conversation_id) DO UPDATE SET before_revision=EXCLUDED.before_revision,due_at=now()`,
	}
	for _, sql := range statements {
		if _, err := tx.Exec(ctx, sql, id); err != nil {
			return err
		}
	}
	if err := cancelJobs(ctx, tx, id); err != nil {
		return err
	}
	return refreshPendingOpen(ctx, tx, id)
}

func (r Repository) SetMemoryPreferences(ctx context.Context, id, actor string, p MemoryPreferences) (MemoryPreferences, error) {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return p, err
	}
	defer tx.Rollback(ctx)
	if _, err = lockConversation(ctx, tx, id); err != nil {
		return p, err
	}
	var version int64
	err = tx.QueryRow(ctx, `SELECT memory_revision FROM conversations c WHERE id=$1 AND user_id=$2 AND `+conversation.AccessSQL, id, actor).Scan(&version)
	if err != nil {
		return p, err
	}
	if p.Version != version {
		return p, memoryConflict()
	}
	if p.Enabled && p.ConsentVersion != 2 {
		return p, response.BadRequest("请确认开启自动记忆")
	}
	if _, err = tx.Exec(ctx, `UPDATE conversations SET memory_opt_in=$2,memory_consent_version=2 WHERE id=$1`, id, p.Enabled); err != nil {
		return p, err
	}
	if err = invalidateMemory(ctx, tx, id); err != nil {
		return p, err
	}
	if err = tx.Commit(ctx); err != nil {
		return p, err
	}
	return r.MemoryPreferences(ctx, id, actor)
}

func (r Repository) ClearMemories(ctx context.Context, id, actor string, version int64) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = lockConversation(ctx, tx, id); err != nil {
		return err
	}
	var current int64
	if err = tx.QueryRow(ctx, `SELECT memory_revision FROM conversations c WHERE id=$1 AND user_id=$2 AND `+conversation.AccessSQL, id, actor).Scan(&current); err != nil {
		return err
	}
	if version != current {
		return memoryConflict()
	}
	for _, sql := range []string{
		`UPDATE conversations SET memory_forget_through=COALESCE((SELECT max(id) FROM messages WHERE conversation_id=$1),0) WHERE id=$1`,
		`UPDATE conversation_memories SET deleted_at=now(),content='[deleted]',version=version+1 WHERE conversation_id=$1 AND deleted_at IS NULL`,
		`DELETE FROM memory_proposals WHERE conversation_id=$1`,
	} {
		if _, err = tx.Exec(ctx, sql, id); err != nil {
			return err
		}
	}
	if err = invalidateMemory(ctx, tx, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r Repository) ResolveMemory(ctx context.Context, id, actor, proposal string, version int64, accept bool) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = lockConversation(ctx, tx, id); err != nil {
		return err
	}
	var allowed bool
	if err = tx.QueryRow(ctx, `SELECT (NOT $3 OR (memory_opt_in AND memory_consent_version=2)) FROM conversations c WHERE id=$1 AND user_id=$2 AND `+conversation.AccessSQL, id, actor, accept).Scan(&allowed); err != nil {
		return err
	}
	if !allowed {
		return response.BadRequest("请先开启记忆")
	}
	var m Memory
	if err = tx.QueryRow(ctx, `SELECT id,kind,content,source_message_id::text,provenance,version,fact_key,valid_until,assertion FROM memory_proposals WHERE id=$1 AND conversation_id=$2 FOR UPDATE`, proposal, id).Scan(&m.ID, &m.Kind, &m.Content, &m.SourceMessageID, &m.Provenance, &m.Version, &m.FactKey, &m.ValidUntil, &m.Assertion); err != nil {
		return err
	}
	if version != m.Version {
		return memoryConflict()
	}
	if accept {
		if containsCredential(m.Content) {
			return response.BadRequest("不能保存访问凭据")
		}
		var sourceValid bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.id=$1 AND m.id=$2::bigint AND m.id>c.memory_forget_through AND (m.sender_type='user' OR m.driver_type='human') AND NOT EXISTS(SELECT 1 FROM agent_forgotten_sources f WHERE f.conversation_id=c.id AND f.source_message_id=m.id))`, id, m.SourceMessageID).Scan(&sourceValid); err != nil {
			return err
		}
		if !sourceValid || (m.ValidUntil != nil && !m.ValidUntil.After(time.Now())) {
			return memoryConflict()
		}
		// Explicit confirmation resolves competing facts; user edits remain final.
		if m.FactKey != "" {
			var manual bool
			if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM conversation_memories WHERE conversation_id=$1 AND fact_key=$2 AND manual AND deleted_at IS NULL)`, id, m.FactKey).Scan(&manual); err != nil {
				return err
			}
			if manual {
				return &response.Error{Status: 409, Code: "manual_memory_conflict", Message: "已有你编辑的同类记忆，请直接编辑已有内容"}
			}
			if _, err = tx.Exec(ctx, `INSERT INTO agent_forgotten_sources SELECT conversation_id,source_message_id FROM conversation_memories WHERE conversation_id=$1 AND fact_key=$2 AND deleted_at IS NULL ON CONFLICT DO NOTHING`, id, m.FactKey); err != nil {
				return err
			}
			if _, err = tx.Exec(ctx, `UPDATE conversation_memories SET deleted_at=now(),content='[superseded]',version=version+1 WHERE conversation_id=$1 AND fact_key=$2 AND deleted_at IS NULL`, id, m.FactKey); err != nil {
				return err
			}
		}
		result, insertErr := tx.Exec(ctx, `INSERT INTO conversation_memories(id,conversation_id,kind,content,source_message_id,provenance,manual,fact_key,valid_until,assertion) VALUES($1,$2,$3,$4,$5::bigint,$6,true,$7,$8,$9) ON CONFLICT(conversation_id,source_message_id,kind) DO NOTHING`, m.ID, id, m.Kind, strings.TrimSpace(m.Content), m.SourceMessageID, m.Provenance, m.FactKey, m.ValidUntil, m.Assertion)
		if insertErr != nil {
			return insertErr
		}
		if result.RowsAffected() == 0 {
			return memoryConflict()
		}
	} else {
		_, err = tx.Exec(ctx, `INSERT INTO agent_forgotten_sources VALUES($1,$2::bigint) ON CONFLICT DO NOTHING`, id, m.SourceMessageID)
	}
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM memory_proposals WHERE id=$1 AND conversation_id=$2`, proposal, id); err != nil {
		return err
	}
	if err = invalidateMemory(ctx, tx, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
