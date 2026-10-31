package delivery

import (
	aicontext "companion/server/internal/ai/context"
	"companion/server/internal/ai/provider"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"math"
	"strings"
	"time"
	"unicode"
)

func (r Repository) BindRun(ctx context.Context, request provider.ChatRequest, cid, kind, claim, through string, jobVersion int64) (provider.ChatRequest, error) {
	run := &provider.RunContext{ConversationID: cid, ClaimToken: claim, ThroughMessageID: through}
	var persona int64
	err := r.DB.QueryRow(ctx, `SELECT c.user_id,c.identity_id,c.settings_version,c.turn_version,c.memory_revision,c.memory_opt_in AND c.memory_consent_version=2,i.persona_version FROM conversations c JOIN identities i ON i.id=c.identity_id WHERE c.id=$1`, cid).Scan(&run.UserID, &run.IdentityID, &run.SettingsVersion, &run.TurnVersion, &run.MemoryRevision, &run.MemoryEnabled, &persona)
	if err != nil {
		return request, err
	}
	key := sha256.Sum256([]byte(fmt.Sprintf("companion:%s:%s:%d:%s:%d:%d", cid, kind, jobVersion, through, run.SettingsVersion, run.MemoryRevision)))
	run.ID = hex.EncodeToString(key[:])
	deadline := time.Now().Add(90 * time.Second)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	run.Deadline = deadline.UTC().Format(time.RFC3339Nano)
	// Include metadata in the size budget before freezing the exact input snapshot.
	run.InputHash = strings.Repeat("0", 64)
	request.ContractVersion = 2
	request.Run = run
	request, err = boundRunInput(request)
	if err != nil {
		return request, err
	}
	if kind == "CONTEXT_UPDATE" && len(request.Messages) > 1 {
		through = request.Messages[len(request.Messages)-1].ID
		run.ThroughMessageID = through
		key = sha256.Sum256([]byte(fmt.Sprintf("companion:%s:%s:%d:%s:%d:%d", cid, kind, jobVersion, through, run.SettingsVersion, run.MemoryRevision)))
		run.ID = hex.EncodeToString(key[:])
	}
	body, err := json.Marshal(request.Messages)
	if err != nil {
		return request, err
	}
	hash := sha256.Sum256(body)
	run.InputHash = hex.EncodeToString(hash[:])
	_, err = r.DB.Exec(ctx, `INSERT INTO agent_runs(id,conversation_id,kind,job_version,claim_token,settings_version,turn_version,memory_revision,persona_version,through_message_id,input_hash,expires_at)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::bigint,$11,$12)
 ON CONFLICT(id) DO UPDATE SET claim_token=EXCLUDED.claim_token,input_hash=EXCLUDED.input_hash,expires_at=EXCLUDED.expires_at,turn_version=EXCLUDED.turn_version,persona_version=EXCLUDED.persona_version`, run.ID, cid, kind, jobVersion, claim, run.SettingsVersion, run.TurnVersion, run.MemoryRevision, persona, through, run.InputHash, deadline)
	request.ContractVersion = 2
	request.Run = run
	if err == nil {
		err = r.ValidateRun(ctx, *run)
	}
	return request, err
}

func boundRunInput(request provider.ChatRequest) (provider.ChatRequest, error) {
	if request.Kind != "CONTEXT_UPDATE" {
		return aicontext.BoundRequest(request)
	}
	// Enrichment must keep a prefix, while normal replies keep the newest suffix.
	// Account for escaping, persona size and run metadata before advancing a cursor.
	original := append([]provider.Message(nil), request.Messages...)
	for count := len(original); count > 0; count-- {
		candidate := request
		candidate.Messages = append([]provider.Message(nil), original[:count]...)
		bounded, err := aicontext.BoundRequest(candidate)
		if err != nil {
			return request, err
		}
		if len(bounded.Messages) == count {
			return bounded, nil
		}
	}
	return request, errors.New("context_batch_too_large")
}

const validRunSQL = `SELECT EXISTS(SELECT 1 FROM agent_runs r JOIN conversations c ON c.id=r.conversation_id JOIN identities i ON i.id=c.identity_id
 WHERE r.id=$1 AND r.claim_token=$2 AND r.input_hash=$3 AND r.expires_at>now()
 AND c.id=$4 AND c.user_id=$5 AND c.identity_id=$6 AND c.settings_version=r.settings_version AND c.memory_revision=r.memory_revision AND i.persona_version=r.persona_version
 AND r.memory_revision=$7 AND r.turn_version=$8 AND r.settings_version=$9 AND r.through_message_id=$10::bigint AND (c.memory_opt_in AND c.memory_consent_version=2)=$11
 AND c.automation_enabled AND (c.owner_type<>'HUMAN' OR c.auto_reply_mode<>'NEVER')
 AND ((r.kind='CONTEXT_UPDATE' AND c.memory_opt_in AND c.memory_consent_version=2 AND EXISTS(SELECT 1 FROM context_jobs j WHERE j.conversation_id=c.id AND j.status='RUNNING' AND j.claim_token=r.claim_token AND j.settings_version=r.settings_version AND j.lease_until>now()))
 OR (r.kind<>'CONTEXT_UPDATE' AND c.turn_version=r.turn_version AND EXISTS(SELECT 1 FROM reply_jobs j WHERE j.conversation_id=c.id AND j.status='generating' AND j.claim_token=r.claim_token AND j.version=r.job_version AND j.settings_version=r.settings_version AND j.lease_until>now()))))`

type runQuerier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func validateRun(ctx context.Context, q runQuerier, run provider.RunContext) error {
	var ok bool
	if err := q.QueryRow(ctx, validRunSQL, run.ID, run.ClaimToken, run.InputHash, run.ConversationID, run.UserID, run.IdentityID, run.MemoryRevision, run.TurnVersion, run.SettingsVersion, run.ThroughMessageID, run.MemoryEnabled).Scan(&ok); err != nil {
		return err
	}
	if !ok {
		return errors.New("stale_agent_run")
	}
	return nil
}
func (r Repository) ValidateRun(ctx context.Context, run provider.RunContext) error {
	return validateRun(ctx, r.DB, run)
}

// Every document is joined back to its business source. An index or deletion
// worker can lag without making stale or unauthorized content readable.
const validDocumentSQL = `c.memory_opt_in AND c.memory_consent_version=2 AND (
 (d.source_kind='memory' AND EXISTS(SELECT 1 FROM conversation_memories m WHERE m.id=d.source_id AND m.conversation_id=c.id AND m.deleted_at IS NULL AND m.version=d.source_version AND (m.valid_until IS NULL OR m.valid_until>now())))
 OR (d.source_kind='identity' AND EXISTS(SELECT 1 FROM identities i WHERE i.id=c.identity_id AND i.id=d.source_id AND i.persona_version=d.source_version))
 OR (d.source_kind='message' AND EXISTS(SELECT 1 FROM messages m WHERE m.id::text=d.source_id AND m.conversation_id=c.id AND m.id>c.memory_forget_through AND NOT EXISTS(SELECT 1 FROM agent_forgotten_sources f WHERE f.conversation_id=c.id AND f.source_message_id=m.id))))`

func (r Repository) SearchEvidence(ctx context.Context, run provider.RunContext, query string, vector []float64, model string) ([]provider.Evidence, error) {
	if err := r.ValidateRun(ctx, run); err != nil {
		return nil, err
	}
	query = strings.TrimSpace(query)
	if len([]rune(query)) > 500 || query == "" {
		return nil, errors.New("invalid_search")
	}
	var embedding any
	if len(vector) > 0 {
		if len(vector) != 1024 {
			return nil, errors.New("invalid_embedding")
		}
		for _, v := range vector {
			if math.IsNaN(v) || math.IsInf(v, 0) {
				return nil, errors.New("invalid_embedding")
			}
		}
		b, _ := json.Marshal(vector)
		embedding = string(b)
	}
	// Exact terms preserve Chinese names and dates; trigram and semantic ranks
	// handle longer natural-language questions without broad character matches.
	terms := strings.FieldsFunc(strings.ToLower(query), func(r rune) bool { return unicode.IsSpace(r) || unicode.IsPunct(r) })
	if len(terms) > 20 {
		terms = terms[:20]
	}
	rows, err := r.DB.Query(ctx, `WITH allowed AS MATERIALIZED (
 SELECT d.* FROM agent_documents d JOIN conversations c ON c.id=d.conversation_id
 WHERE c.id=$1 AND `+validDocumentSQL+` AND (CASE WHEN d.source_kind='message' THEN d.source_id::bigint ELSE 0 END)<=$2::bigint),
 lexical AS (SELECT id,row_number() OVER(ORDER BY (position(lower($3) in lower(content))>0) DESC,public.similarity(content,$3) DESC,id) AS rank
 FROM allowed WHERE position(lower($3) in lower(content))>0 OR EXISTS(SELECT 1 FROM unnest($4::text[]) t WHERE position(t in lower(content))>0) OR public.similarity(content,$3)>0.02 LIMIT 20),
 semantic AS (SELECT id,row_number() OVER(ORDER BY embedding OPERATOR(public.<=>) $5::public.vector,id) AS rank FROM allowed
 WHERE $5::public.vector IS NOT NULL AND embedding IS NOT NULL AND embedding_hash=content_hash AND embedding_model=$6 ORDER BY embedding OPERATOR(public.<=>) $5::public.vector,id LIMIT 20),
 fused AS (SELECT id,sum(score) score FROM (SELECT id,1.0/(60+rank) score FROM lexical UNION ALL SELECT id,1.0/(60+rank) FROM semantic) x GROUP BY id ORDER BY score DESC,id LIMIT 20)
 SELECT a.id,a.source_version,a.content_hash,a.source_kind,left(a.content,1200) FROM fused f JOIN allowed a ON a.id=f.id ORDER BY f.score DESC,a.id LIMIT 6`, run.ConversationID, run.ThroughMessageID, query, terms, embedding, model)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []provider.Evidence{}
	for rows.Next() {
		var e provider.Evidence
		if err = rows.Scan(&e.ID, &e.Version, &e.Hash, &e.Kind, &e.Content); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	if err = r.ValidateRun(ctx, run); err != nil {
		return nil, err
	}
	return out, nil
}

func validateExecution(ctx context.Context, tx pgx.Tx, run *provider.RunContext, e *provider.Execution) error {
	if run == nil {
		return nil
	} // Legacy fixtures and jobs created before the v2 rollout.
	if err := validateRun(ctx, tx, *run); err != nil {
		return err
	}
	if e == nil || e.RunID != run.ID || e.InputHash != run.InputHash || e.MemoryRevision != run.MemoryRevision || e.GraphVersion == "" || e.ModelCalls < 0 || e.ModelCalls > 3 || e.RetrievalCalls < 0 || e.RetrievalCalls > 2 || e.InputTokens < 0 || e.OutputTokens < 0 || len(e.Evidence) > 12 {
		return errors.New("invalid_execution")
	}
	for _, ref := range e.Evidence {
		var ok bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM agent_documents d JOIN conversations c ON c.id=d.conversation_id WHERE d.id=$1 AND c.id=$2 AND d.source_version=$3 AND d.content_hash=$4 AND `+validDocumentSQL+`)`, ref.ID, run.ConversationID, ref.Version, ref.Hash).Scan(&ok); err != nil {
			return err
		}
		if !ok {
			return errors.New("stale_evidence")
		}
	}
	return nil
}
