package delivery

import (
	"context"
	"time"
)

// Cached rule-based fictional state needs no model call. Human edits are never
// overwritten, including after expiry; a human-owned identity pauses automation.
func (r Repository) RefreshDailyStates(ctx context.Context) error {
	rows, err := r.DB.Query(ctx, `SELECT i.id FROM identities i LEFT JOIN identity_daily_state s ON s.identity_id=i.id WHERE (s.identity_id IS NULL OR (s.expires_at<=now() AND s.editor_id IS NULL)) AND EXISTS(SELECT 1 FROM conversations WHERE identity_id=i.id AND automation_enabled) ORDER BY i.id LIMIT 20`)
	if err != nil {
		return err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, id := range ids {
		if err = r.refreshDailyState(ctx, id); err != nil {
			return err
		}
	}
	return nil
}
func (r Repository) refreshDailyState(ctx context.Context, id string) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `SELECT id,owner_type FROM conversations WHERE identity_id=$1 ORDER BY id FOR UPDATE`, id)
	if err != nil {
		return err
	}
	var conversations []string
	human := false
	for rows.Next() {
		var c, owner string
		if err = rows.Scan(&c, &owner); err != nil {
			rows.Close()
			return err
		}
		conversations = append(conversations, c)
		human = human || owner == "HUMAN"
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	if human {
		return nil
	}
	now := time.Now().UTC()
	scenes := []string{"虚构日常：整理书架", "虚构日常：练习画画", "虚构日常：挑选一首喜欢的歌", "虚构日常：翻看一本小说"}
	activity := scenes[now.YearDay()%len(scenes)]
	tag, err := tx.Exec(ctx, `INSERT INTO identity_daily_state(identity_id,current_activity,mood,expires_at) VALUES($1,$2,'平静',$3)
 ON CONFLICT(identity_id) DO UPDATE SET current_activity=EXCLUDED.current_activity,mood=EXCLUDED.mood,expires_at=EXCLUDED.expires_at,version=identity_daily_state.version+1
 WHERE identity_daily_state.editor_id IS NULL AND identity_daily_state.expires_at<=now()`, id, activity, now.Truncate(24*time.Hour).Add(24*time.Hour))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return nil
	}
	for _, c := range conversations {
		if _, err = tx.Exec(ctx, `UPDATE conversations SET settings_version=settings_version+1 WHERE id=$1`, c); err != nil {
			return err
		}
		if err = cancelJobs(ctx, tx, c); err != nil {
			return err
		}
		if err = refreshPendingOpen(ctx, tx, c); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
