package delivery

import (
	"companion/server/internal/ai/provider"
	"companion/server/pkg/database"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"math"
	"time"
)

func putDocument(ctx context.Context, tx pgx.Tx, cid, kind, id string, version int64, content string) error {
	hash := sha256.Sum256([]byte(content))
	key := sha256.Sum256([]byte(cid + ":" + kind + ":" + id))
	_, err := tx.Exec(ctx, `INSERT INTO agent_documents(id,conversation_id,source_kind,source_id,source_version,content,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7)
 ON CONFLICT(conversation_id,source_kind,source_id) DO UPDATE SET source_version=EXCLUDED.source_version,content=EXCLUDED.content,content_hash=EXCLUDED.content_hash,updated_at=now()
 WHERE agent_documents.source_version<>EXCLUDED.source_version OR agent_documents.content_hash<>EXCLUDED.content_hash`, hex.EncodeToString(key[:]), cid, kind, id, version, content, hex.EncodeToString(hash[:]))
	return err
}

// The transaction also emits index jobs through agent_document_outbox.
func (r Repository) SyncDocuments(ctx context.Context) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `INSERT INTO agent_backfills(conversation_id,through_message_id) SELECT id,memory_forget_through FROM conversations WHERE memory_opt_in AND memory_consent_version=2 ON CONFLICT DO NOTHING`)
	if err != nil {
		return err
	}
	var cid string
	err = tx.QueryRow(ctx, `SELECT c.id FROM conversations c JOIN agent_backfills b ON b.conversation_id=c.id WHERE c.memory_opt_in AND c.memory_consent_version=2 AND b.dirty ORDER BY b.updated_at,c.id FOR UPDATE OF c SKIP LOCKED LIMIT 1`).Scan(&cid)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	var iid, persona string
	var version int64
	if err = tx.QueryRow(ctx, `SELECT i.id,i.persona_version,left(jsonb_build_object('name',i.name,'background',i.background,'persona',i.persona,'fictional',true)::text,4000) FROM identities i JOIN conversations c ON c.identity_id=i.id WHERE c.id=$1`, cid).Scan(&iid, &version, &persona); err != nil {
		return err
	}
	if err = putDocument(ctx, tx, cid, "identity", iid, version, persona); err != nil {
		return err
	}
	rows, err := tx.Query(ctx, `SELECT id,version,kind||' ['||assertion||']: '||content FROM conversation_memories WHERE conversation_id=$1 AND deleted_at IS NULL AND (valid_until IS NULL OR valid_until>now())`, cid)
	if err != nil {
		return err
	}
	type document struct {
		id, content string
		version     int64
	}
	docs := []document{}
	for rows.Next() {
		var d document
		if err = rows.Scan(&d.id, &d.version, &d.content); err != nil {
			break
		}
		docs = append(docs, d)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return err
	}
	for _, d := range docs {
		if containsCredential(d.content) {
			continue
		}
		if err = putDocument(ctx, tx, cid, "memory", d.id, d.version, d.content); err != nil {
			return err
		}
	}
	rows, err = tx.Query(ctx, `SELECT m.id::text,CASE WHEN sender_type='user' THEN 'USER' WHEN driver_type='human' THEN 'HUMAN' ELSE 'AI_DIALOGUE' END||' '||m.created_at::text||': '||left(m.content,2000),EXISTS(SELECT 1 FROM agent_forgotten_sources f WHERE f.conversation_id=m.conversation_id AND f.source_message_id=m.id)
 FROM messages m JOIN agent_backfills b ON b.conversation_id=m.conversation_id WHERE m.conversation_id=$1 AND m.id>b.through_message_id ORDER BY m.id LIMIT 40`, cid)
	if err != nil {
		return err
	}
	docs = nil
	last := "0"
	processed := 0
	for rows.Next() {
		var d document
		var forgotten bool
		if err = rows.Scan(&d.id, &d.content, &forgotten); err != nil {
			break
		}
		last = d.id
		processed++
		if !forgotten && !containsCredential(d.content) {
			docs = append(docs, d)
		}
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return err
	}
	for _, d := range docs {
		if err = putDocument(ctx, tx, cid, "message", d.id, 1, d.content); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(ctx, `UPDATE agent_backfills SET through_message_id=GREATEST(through_message_id,$2::bigint),updated_at=now(),dirty=$3 WHERE conversation_id=$1`, cid, last, processed == 40); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM agent_documents d USING conversations c WHERE d.conversation_id=c.id AND c.id=$1 AND NOT (`+validDocumentSQL+`)`, cid); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (w Worker) index(ctx context.Context) error {
	if _, err := w.Repo.DB.Exec(ctx, `UPDATE agent_index_jobs SET status='FAILED',lease_until=NULL WHERE status='RUNNING' AND attempts>=8 AND lease_until<now()`); err != nil {
		return err
	}
	if err := w.Repo.SyncDocuments(ctx); err != nil {
		return err
	}
	model, ok := w.Model.(provider.IndexModel)
	if !ok {
		return nil
	}
	// Retry purges until all in-flight old threads release their execution lock.
	var cid string
	var revision int64
	err := w.Repo.DB.QueryRow(ctx, `SELECT conversation_id,before_revision FROM agent_cleanup_jobs WHERE due_at<=now() ORDER BY due_at LIMIT 1`).Scan(&cid, &revision)
	if err == nil {
		call, cancel := context.WithTimeout(ctx, 10*time.Second)
		e := model.PurgeCheckpoints(call, cid, revision)
		cancel()
		if e == nil {
			_, err = w.Repo.DB.Exec(ctx, `DELETE FROM agent_cleanup_jobs WHERE conversation_id=$1 AND before_revision=$2`, cid, revision)
		} else {
			_, err = w.Repo.DB.Exec(ctx, `UPDATE agent_cleanup_jobs SET due_at=now()+interval '15 seconds' WHERE conversation_id=$1`, cid)
		}
		if err != nil {
			return err
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	token := database.ID()
	var id, hash, content string
	err = w.Repo.DB.QueryRow(ctx, `WITH picked AS (SELECT j.document_id FROM agent_index_jobs j JOIN agent_documents d ON d.id=j.document_id JOIN conversations c ON c.id=d.conversation_id
 WHERE ((j.status='PENDING' AND j.due_at<=now()) OR (j.status='RUNNING' AND j.lease_until<now())) AND j.attempts<8 AND `+validDocumentSQL+` ORDER BY j.due_at FOR UPDATE OF j SKIP LOCKED LIMIT 1)
 UPDATE agent_index_jobs j SET status='RUNNING',attempts=attempts+1,claim_token=$1,lease_until=now()+interval '30 seconds' FROM picked p,agent_documents d WHERE j.document_id=p.document_id AND d.id=j.document_id RETURNING d.id,j.content_hash,d.content`, token).Scan(&id, &hash, &content)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	call, cancel := context.WithTimeout(ctx, 15*time.Second)
	result, err := model.Embed(call, []string{content})
	cancel()
	if err == nil {
		if result.Model == "" || len(result.Vectors) != 1 || len(result.Vectors[0]) != 1024 {
			err = errors.New("invalid embedding response")
		} else {
			for _, v := range result.Vectors[0] {
				if math.IsNaN(v) || math.IsInf(v, 0) {
					err = errors.New("nonfinite embedding")
					break
				}
			}
		}
	}
	if err != nil {
		if errors.Is(err, provider.ErrBusy) {
			_, e := w.Repo.DB.Exec(ctx, `UPDATE agent_index_jobs SET status='PENDING',attempts=GREATEST(attempts-1,0),due_at=now()+interval '2 seconds',lease_until=NULL WHERE document_id=$1 AND claim_token=$2`, id, token)
			return e
		}
		_, e := w.Repo.DB.Exec(ctx, `UPDATE agent_index_jobs SET status=CASE WHEN attempts>=8 THEN 'FAILED' ELSE 'PENDING' END,due_at=now()+interval '30 seconds'*attempts,lease_until=NULL WHERE document_id=$1 AND claim_token=$2`, id, token)
		return e
	}
	vector, _ := json.Marshal(result.Vectors[0])
	tx, err := w.Repo.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// Lock the owner first, matching edits/forgetting and document synchronization.
	if _, err = tx.Exec(ctx, `SELECT c.id FROM conversations c JOIN agent_documents d ON d.conversation_id=c.id WHERE d.id=$1 FOR UPDATE OF c`, id); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE agent_documents d SET embedding=$3::public.vector,embedding_model=$4,embedding_hash=$2 FROM conversations c,agent_index_jobs j WHERE d.id=$1 AND c.id=d.conversation_id AND d.content_hash=$2 AND j.document_id=d.id AND j.claim_token=$5 AND j.content_hash=$2 AND `+validDocumentSQL, id, hash, string(vector), result.Model, token)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE agent_index_jobs SET status='DONE',lease_until=NULL WHERE document_id=$1 AND claim_token=$2 AND content_hash=$3`, id, token, hash); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
