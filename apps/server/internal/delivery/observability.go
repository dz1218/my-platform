package delivery

import (
	"context"
	"log/slog"
	"time"
)

// Aggregates contain no conversation text or user identifiers. Keep a separate
// low-frequency query rather than adding full-table counts to every request.
func (r Repository) ObserveAgent(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	var replies, contexts, indexes, failed, cleanup int64
	var queueLag, indexLag float64
	err := r.DB.QueryRow(ctx, `SELECT
 (SELECT count(*) FROM reply_jobs WHERE status IN ('queued','generating')),
 (SELECT count(*) FROM context_jobs WHERE status IN ('PENDING','RUNNING')),
 (SELECT count(*) FROM agent_index_jobs WHERE status IN ('PENDING','RUNNING')),
 (SELECT count(*) FROM agent_index_jobs WHERE status='FAILED'),
 (SELECT count(*) FROM agent_cleanup_jobs),
 COALESCE((SELECT EXTRACT(EPOCH FROM now()-min(due_at)) FROM reply_jobs WHERE status='queued' AND due_at<now()),0),
 COALESCE((SELECT EXTRACT(EPOCH FROM now()-min(d.updated_at)) FROM agent_documents d JOIN agent_index_jobs j ON j.document_id=d.id WHERE j.status<>'DONE'),0)`).Scan(&replies, &contexts, &indexes, &failed, &cleanup, &queueLag, &indexLag)
	if err != nil {
		return err
	}
	slog.Info("companion queue metrics", "replyPending", replies, "contextPending", contexts, "indexPending", indexes, "indexFailed", failed, "cleanupPending", cleanup, "queueLagSeconds", queueLag, "indexLagSeconds", indexLag)
	_, err = r.DB.Exec(ctx, `DELETE FROM agent_runs WHERE id IN (SELECT id FROM agent_runs WHERE expires_at<now()-interval '7 days' LIMIT 1000)`)
	return err
}
