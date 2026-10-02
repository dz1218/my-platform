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

// Enrichment is independent of message delivery. It runs at most once per 20
// persisted messages, only with memory consent, with durable leases and retries.
func (w Worker) enrich(ctx context.Context) error {
	_, err := w.Repo.DB.Exec(ctx, `UPDATE context_jobs SET status='FAILED' WHERE status='RUNNING' AND lease_until<now() AND attempts>=3`)
	if err != nil {
		return err
	}
	_, err = w.Repo.DB.Exec(ctx, `INSERT INTO context_jobs(conversation_id,through_message_id,settings_version)
 SELECT c.id,(SELECT max(id) FROM messages WHERE conversation_id=c.id),c.settings_version FROM conversations c
 WHERE c.memory_opt_in AND c.automation_enabled AND c.turn_status='ANSWERED'
 AND (SELECT count(*) FROM messages WHERE conversation_id=c.id AND id>COALESCE(c.summary_through_message_id,0))>=20
 ON CONFLICT(conversation_id) DO UPDATE SET through_message_id=EXCLUDED.through_message_id,settings_version=EXCLUDED.settings_version,status='PENDING',attempts=0,due_at=now()
 WHERE context_jobs.status IN ('DONE','FAILED') AND (context_jobs.through_message_id<EXCLUDED.through_message_id OR context_jobs.settings_version<>EXCLUDED.settings_version)`)
	if err != nil {
		return err
	}
	token := database.ID()
	var id, user, identity, through string
	var version int64
	err = w.Repo.DB.QueryRow(ctx, `WITH picked AS (SELECT conversation_id FROM context_jobs WHERE (status='PENDING' AND due_at<=now()) OR (status='RUNNING' AND lease_until<now()) ORDER BY due_at FOR UPDATE SKIP LOCKED LIMIT 1)
 UPDATE context_jobs j SET status='RUNNING',attempts=attempts+1,lease_until=now()+interval '120 seconds',claim_token=$1 FROM picked p,conversations c WHERE j.conversation_id=p.conversation_id AND c.id=j.conversation_id AND j.attempts<3
 RETURNING c.id,c.user_id,c.identity_id,j.through_message_id::text,j.settings_version`, token).Scan(&id, &user, &identity, &through, &version)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	call, stop := context.WithTimeout(ctx, 95*time.Second)
	defer stop()
	// Bind the history to the job's upper cursor, not a moving latest snapshot.
	c, err := w.Builder.Messages.Accessible(call, user, id)
	var request provider.ChatRequest
	if err == nil {
		request, err = w.Builder.Build(call, c)
	}
	if err == nil {
		rows, e := w.Repo.DB.Query(call, `SELECT id::text,CASE WHEN sender_type='user' THEN 'user' ELSE 'assistant' END,content,CASE WHEN sender_type='user' THEN 'USER' WHEN driver_type='human' THEN 'HUMAN' ELSE 'AI' END FROM (SELECT * FROM messages WHERE conversation_id=$1 AND id<=$2::bigint AND NOT EXISTS(SELECT 1 FROM conversation_memories x WHERE x.conversation_id=$1 AND x.source_message_id=messages.id AND x.deleted_at IS NOT NULL) ORDER BY id DESC LIMIT 30) m ORDER BY id`, id, through)
		err = e
		if err == nil {
			request.Messages = request.Messages[:1]
			for rows.Next() {
				var m provider.Message
				if err = rows.Scan(&m.ID, &m.Role, &m.Content, &m.Source); err != nil {
					break
				}
				request.Messages = append(request.Messages, m)
			}
			if err == nil {
				err = rows.Err()
			}
			rows.Close()
		}
	}
	var reply provider.Reply
	if err == nil {
		var allowed bool
		err = w.Repo.DB.QueryRow(call, `SELECT memory_opt_in AND automation_enabled AND settings_version=$2 FROM conversations WHERE id=$1`, id, version).Scan(&allowed)
		if err == nil && !allowed {
			err = errors.New("context permission changed")
		}
	}
	if err == nil {
		// Keep the enrichment request within the same transport/context budget.
		budget := 10000
		start := len(request.Messages)
		for start > 1 {
			n := len([]rune(request.Messages[start-1].Content))
			if n > budget {
				break
			}
			budget -= n
			start--
		}
		request.Messages = append(request.Messages[:1], request.Messages[start:]...)
		request.Kind = "CONTEXT_UPDATE"
		reply, err = w.Model.Generate(call, request)
	}
	if err == nil {
		err = w.Repo.commitEnrichment(call, id, through, token, version, reply)
	}
	if err == nil {
		return nil
	}
	// Store only a failure state, never prompts or provider error bodies.
	cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, e := w.Repo.DB.Exec(cleanup, `UPDATE context_jobs SET status=CASE WHEN attempts>=3 THEN 'FAILED' ELSE 'PENDING' END,due_at=now()+interval '1 minute',lease_until=NULL WHERE conversation_id=$1 AND claim_token=$2 AND status='RUNNING'`, id, token)
	slog.Warn("context enrichment failed", "conversation", id)
	return e
}
func (r Repository) commitEnrichment(ctx context.Context, id, through, token string, version int64, p provider.Reply) error {
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
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM context_jobs j JOIN conversations c ON c.id=j.conversation_id WHERE j.conversation_id=$1 AND j.claim_token=$2 AND j.status='RUNNING' AND c.memory_opt_in AND c.automation_enabled)`, id, token).Scan(&valid); err != nil {
		return err
	}
	if !valid {
		if _, err = tx.Exec(ctx, `UPDATE context_jobs SET status='DONE',lease_until=NULL WHERE conversation_id=$1 AND claim_token=$2 AND status='RUNNING'`, id, token); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	if s.Version == version {
		for _, m := range p.MemoryProposals {
			if strings.TrimSpace(m.Content) == "" || len([]rune(m.Content)) > 300 || (m.Kind != "FACT" && m.Kind != "PREFERENCE" && m.Kind != "EXPERIENCE" && m.Kind != "BOUNDARY") {
				return errors.New("invalid memory proposal")
			}
			// Source, provenance and scope are derived from PostgreSQL, never the model.
			_, err = tx.Exec(ctx, `INSERT INTO memory_proposals(id,conversation_id,source_message_id,kind,content,provenance)
 SELECT $1,$2,m.id,$4,$5,CASE WHEN m.sender_type='user' THEN 'USER_ASSERTED' ELSE 'HUMAN_AUTHORED' END FROM messages m
 WHERE m.conversation_id=$2 AND m.id::text=$3 AND m.id<=$6::bigint AND (m.sender_type='user' OR m.driver_type='human')
 AND NOT EXISTS(SELECT 1 FROM conversation_memories x WHERE x.conversation_id=$2 AND x.source_message_id=m.id AND x.kind=$4)
 ON CONFLICT DO NOTHING`, database.ID(), id, m.SourceMessageID, m.Kind, m.Content, through)
			if err != nil {
				return err
			}
		}
		if _, err = tx.Exec(ctx, `UPDATE conversations SET summary=$2,summary_through_message_id=$3::bigint WHERE id=$1`, id, p.Summary, through); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(ctx, `UPDATE context_jobs SET status='DONE',lease_until=NULL WHERE conversation_id=$1 AND claim_token=$2`, id, token); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
