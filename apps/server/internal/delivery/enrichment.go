package delivery

import (
	"companion/server/internal/ai/provider"
	"companion/server/pkg/database"
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"log/slog"
	"strings"
	"time"
)

// Go owns retries. Process contiguous batches, never skip unprocessed history.
func (w Worker) enrich(ctx context.Context) error {
	_, err := w.Repo.DB.Exec(ctx, `UPDATE context_jobs SET status='FAILED' WHERE status='RUNNING' AND lease_until<now() AND attempts>=3`)
	if err != nil {
		return err
	}
	_, err = w.Repo.DB.Exec(ctx, `INSERT INTO context_jobs(conversation_id,through_message_id,settings_version)
 SELECT c.id,(SELECT max(id) FROM messages WHERE conversation_id=c.id),c.settings_version FROM conversations c
 WHERE c.memory_opt_in AND c.memory_consent_version=2 AND c.automation_enabled AND c.turn_status='ANSWERED'
 AND EXISTS(SELECT 1 FROM messages WHERE conversation_id=c.id AND id>GREATEST(COALESCE(c.summary_through_message_id,0),c.memory_forget_through))
 ON CONFLICT(conversation_id) DO UPDATE SET through_message_id=EXCLUDED.through_message_id,settings_version=EXCLUDED.settings_version,status='PENDING',attempts=0,due_at=now()
 WHERE context_jobs.status IN ('DONE','FAILED') AND (context_jobs.through_message_id<EXCLUDED.through_message_id OR context_jobs.settings_version<>EXCLUDED.settings_version)`)
	if err != nil {
		return err
	}
	token := database.ID()
	var id, user, through string
	var version int64
	err = w.Repo.DB.QueryRow(ctx, `WITH picked AS (SELECT conversation_id FROM context_jobs WHERE (status='PENDING' AND due_at<=now()) OR (status='RUNNING' AND lease_until<now()) ORDER BY due_at FOR UPDATE SKIP LOCKED LIMIT 1)
 UPDATE context_jobs j SET status='RUNNING',attempts=attempts+1,lease_until=now()+interval '120 seconds',claim_token=$1 FROM picked p,conversations c
 WHERE j.conversation_id=p.conversation_id AND c.id=j.conversation_id AND j.attempts<3 RETURNING c.id,c.user_id,j.through_message_id::text,j.settings_version`, token).Scan(&id, &user, &through, &version)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	call, stop := context.WithTimeout(ctx, 95*time.Second)
	defer stop()
	c, err := w.Builder.Messages.Accessible(call, user, id)
	var request provider.ChatRequest
	if err == nil {
		request, err = w.Builder.Build(call, c)
	}
	processed := through
	if err == nil {
		request.Messages = request.Messages[:1]
		request.Kind = "CONTEXT_UPDATE"
		rows, e := w.Repo.DB.Query(call, `SELECT m.id::text,CASE WHEN sender_type='user' THEN 'user' ELSE 'assistant' END,content,CASE WHEN sender_type='user' THEN 'USER' WHEN driver_type='human' THEN 'HUMAN' ELSE 'AI' END,
  EXISTS(SELECT 1 FROM agent_forgotten_sources f WHERE f.conversation_id=m.conversation_id AND f.source_message_id=m.id)
  FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.id=$1 AND m.id<=$2::bigint AND m.id>GREATEST(COALESCE(c.summary_through_message_id,0),c.memory_forget_through) ORDER BY m.id LIMIT 30`, id, through)
		err = e
		if err == nil {
			budget := 6000
			processed = "0"
			for rows.Next() {
				var m provider.Message
				var forgotten bool
				if err = rows.Scan(&m.ID, &m.Role, &m.Content, &m.Source, &forgotten); err != nil {
					break
				}
				if !forgotten && !containsCredential(m.Content) {
					n := len([]rune(m.Content))
					if n > budget && len(request.Messages) > 1 {
						break
					}
					if n > budget {
						m.Content = string([]rune(m.Content)[:budget])
						n = budget
					}
					request.Messages = append(request.Messages, m)
					budget -= n
				}
				processed = m.ID
			}
			if err == nil {
				err = rows.Err()
			}
			rows.Close()
		}
	}
	var reply provider.Reply
	if err == nil {
		if processed == "0" {
			processed = through
		}
		request, err = w.Repo.BindRun(call, request, id, "CONTEXT_UPDATE", token, processed, version)
		if err == nil {
			processed = request.Run.ThroughMessageID
			if len(request.Messages) == 1 {
				reply = provider.Reply{Action: "SILENCE", Execution: &provider.Execution{RunID: request.Run.ID, InputHash: request.Run.InputHash, MemoryRevision: request.Run.MemoryRevision, GraphVersion: "empty-context"}}
			} else {
				reply, err = w.Model.Generate(call, request)
			}
		}
	}
	if err == nil {
		err = w.Repo.commitEnrichmentRun(call, id, processed, token, version, reply, request.Run)
	}
	if err == nil {
		return nil
	}
	cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if errors.Is(err, provider.ErrBusy) {
		_, e := w.Repo.DB.Exec(cleanup, `UPDATE context_jobs SET status='PENDING',attempts=GREATEST(attempts-1,0),due_at=now()+interval '5 seconds',lease_until=NULL WHERE conversation_id=$1 AND claim_token=$2 AND status='RUNNING'`, id, token)
		return e
	}
	_, e := w.Repo.DB.Exec(cleanup, `UPDATE context_jobs SET status=CASE WHEN attempts>=3 THEN 'FAILED' ELSE 'PENDING' END,due_at=now()+interval '1 minute',lease_until=NULL WHERE conversation_id=$1 AND claim_token=$2 AND status='RUNNING'`, id, token)
	slog.Warn("context enrichment failed", "conversation", id)
	return e
}

func (r Repository) commitEnrichment(ctx context.Context, id, through, token string, version int64, p provider.Reply) error {
	return r.commitEnrichmentRun(ctx, id, through, token, version, p, nil)
}

func (r Repository) commitEnrichmentRun(ctx context.Context, id, through, token string, version int64, p provider.Reply, run *provider.RunContext) error {
	if p.Action != "SILENCE" || len(p.Messages) != 0 || len([]rune(p.Summary)) > 1000 || len(p.MemoryProposals) > 5 {
		return errors.New("invalid context proposal")
	}
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	s, err := lockConversation(ctx, tx, id)
	if err != nil {
		return err
	}
	var valid bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM context_jobs j JOIN conversations c ON c.id=j.conversation_id WHERE j.conversation_id=$1 AND j.claim_token=$2 AND j.status='RUNNING' AND c.memory_opt_in AND c.memory_consent_version=2 AND c.automation_enabled)`, id, token).Scan(&valid); err != nil {
		return err
	}
	if valid && s.Version == version {
		if err = validateExecution(ctx, tx, run, p.Execution); err != nil {
			return err
		}
		for _, m := range p.MemoryProposals {
			if err = commitMemoryCandidate(ctx, tx, id, through, m); err != nil {
				return err
			}
		}
		summary := p.Summary
		if containsCredential(summary) {
			summary = ""
		}
		if _, err = tx.Exec(ctx, `UPDATE conversations SET summary=$2,summary_through_message_id=GREATEST(COALESCE(summary_through_message_id,0),$3::bigint) WHERE id=$1`, id, summary, through); err != nil {
			return err
		}
	}
	_, err = tx.Exec(ctx, `UPDATE context_jobs SET status=CASE WHEN $3::bigint<through_message_id AND $4 THEN 'PENDING' ELSE 'DONE' END,attempts=0,due_at=now()+interval '5 seconds',lease_until=NULL WHERE conversation_id=$1 AND claim_token=$2`, id, token, through, valid && s.Version == version)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

var automaticFactKeys = map[string]bool{"preferred_name": true, "city": true, "occupation": true, "food_preference": true, "communication_preference": true, "hobby": true, "boundary": true}

func commitMemoryCandidate(ctx context.Context, tx pgx.Tx, id, through string, m provider.MemoryProposal) error {
	if strings.TrimSpace(m.Content) == "" || len([]rune(m.Content)) > 300 || (m.Kind != "FACT" && m.Kind != "PREFERENCE" && m.Kind != "EXPERIENCE" && m.Kind != "BOUNDARY") {
		return errors.New("invalid memory proposal")
	}
	if containsCredential(m.Content) {
		return nil
	}
	var source, provenance string
	err := tx.QueryRow(ctx, `SELECT content,CASE WHEN sender_type='user' THEN 'USER_ASSERTED' ELSE 'HUMAN_AUTHORED' END FROM messages m JOIN conversations c ON c.id=m.conversation_id
 WHERE c.id=$1 AND m.id::text=$2 AND m.id<=$3::bigint AND m.id>c.memory_forget_through AND (m.sender_type='user' OR m.driver_type='human')
 AND NOT EXISTS(SELECT 1 FROM agent_forgotten_sources f WHERE f.conversation_id=c.id AND f.source_message_id=m.id)
 AND NOT EXISTS(SELECT 1 FROM conversation_memories x WHERE x.conversation_id=c.id AND x.source_message_id=m.id AND x.kind=$4)`, id, m.SourceMessageID, through, m.Kind).Scan(&source, &provenance)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if containsCredential(source) {
		return nil
	}
	var expires *time.Time
	if m.ValidUntil != nil {
		d, e := time.Parse(time.RFC3339, *m.ValidUntil)
		if e != nil || !d.After(time.Now()) {
			return nil
		}
		expires = &d
	}
	if m.Assertion != "ASSERTION" && m.Assertion != "PLAN" {
		m.Assertion = "UNCERTAIN"
	}
	if m.Assertion != "ASSERTION" || m.FactKey == "other" {
		m.FactKey = ""
	}
	automatic := provenance == "USER_ASSERTED" && m.Assertion == "ASSERTION" && automaticFactKeys[m.FactKey] && len([]rune(m.SourceQuote)) <= 300 && strings.TrimSpace(source) == strings.TrimSpace(m.SourceQuote) && firstPersonFact.MatchString(source) && !uncertainPattern.MatchString(source) && !sensitivePattern.MatchString(source)
	if automatic {
		// Save the verified quotation, never a model paraphrase of a user fact.
		m.Content = strings.TrimSpace(m.SourceQuote)
	}
	var conflict bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM conversation_memories WHERE conversation_id=$1 AND deleted_at IS NULL AND ((fact_key<>'' AND fact_key=$2) OR content=$3))`, id, m.FactKey, m.Content).Scan(&conflict); err != nil {
		return err
	}
	if automatic && !conflict {
		_, err = tx.Exec(ctx, `INSERT INTO conversation_memories(id,conversation_id,source_message_id,kind,content,provenance,fact_key,valid_until,assertion) VALUES($1,$2,$3::bigint,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`, database.ID(), id, m.SourceMessageID, m.Kind, m.Content, provenance, m.FactKey, expires, m.Assertion)
		return err
	}
	reason := "需要确认"
	if conflict {
		reason = "与已有记忆可能冲突"
	} else if sensitivePattern.MatchString(source) {
		reason = "涉及敏感内容"
	} else if uncertainPattern.MatchString(source) {
		reason = "计划、假设或不确定内容"
	}
	_, err = tx.Exec(ctx, `INSERT INTO memory_proposals(id,conversation_id,source_message_id,kind,content,provenance,fact_key,reason,valid_until,assertion) VALUES($1,$2,$3::bigint,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`, database.ID(), id, m.SourceMessageID, m.Kind, m.Content, provenance, m.FactKey, reason, expires, m.Assertion)
	return err
}
