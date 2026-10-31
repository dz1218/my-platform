package auth

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
)

// ProcessRevocation is safe across API replicas. Work is idempotent; a process
// crash rolls back the claim and leaves the committed job available for retry.
func (s Service) ProcessRevocation(ctx context.Context, cleanup func(context.Context, string, int64) error) (bool, error) {
	tx, err := s.Repo.DB.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	var userID string
	var version int64
	var attempts int
	err = tx.QueryRow(ctx, `SELECT user_id,session_version,attempts FROM account_revocations
        WHERE completed_at IS NULL AND retry_at<=now() ORDER BY retry_at LIMIT 1 FOR UPDATE SKIP LOCKED`).Scan(&userID, &version, &attempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	workCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	workErr := cleanup(workCtx, userID, version)
	cancel()
	if workErr != nil {
		delay := min(60, 1<<min(attempts, 6))
		_, err = tx.Exec(ctx, `UPDATE account_revocations SET attempts=attempts+1,retry_at=now()+$3*interval '1 second' WHERE user_id=$1 AND session_version=$2`, userID, version, delay)
		slog.Warn("account live cleanup pending", "user", userID, "version", version, "attempt", attempts+1, "error", workErr)
	} else {
		_, err = tx.Exec(ctx, `UPDATE account_revocations SET attempts=attempts+1,completed_at=now() WHERE user_id=$1 AND session_version=$2`, userID, version)
	}
	if err != nil {
		return true, err
	}
	return true, tx.Commit(ctx)
}

func (s Service) RunRevocations(ctx context.Context, cleanup func(context.Context, string, int64) error) {
	for ctx.Err() == nil {
		task, cancel := context.WithTimeout(ctx, 25*time.Second)
		worked, err := s.ProcessRevocation(task, cleanup)
		cancel()
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			slog.Warn("account cleanup queue unavailable", "error", err)
		}
		if worked && err == nil {
			continue
		}
		timer := time.NewTimer(time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}
