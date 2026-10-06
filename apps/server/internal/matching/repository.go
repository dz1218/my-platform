package matching

import (
	"companion/server/internal/identity"
	"companion/server/pkg/database"
	"companion/server/pkg/response"
	"context"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Match struct {
	ID             string            `json:"id"`
	ConversationID string            `json:"conversationId"`
	Identity       identity.Identity `json:"identity"`
}
type Repository struct{ DB *pgxpool.Pool }

const columns = `m.id,c.id,` + identity.PublicColumns
const joins = ` FROM matches m JOIN conversations c ON c.match_id=m.id JOIN identities i ON i.id=m.identity_id `

func (r Repository) Get(ctx context.Context, userID, id string) (Match, error) {
	var m Match
	err := r.DB.QueryRow(ctx, `SELECT `+columns+joins+`WHERE m.user_id=$1 AND m.id=$2 AND NOT EXISTS(SELECT 1 FROM identity_inheritances h WHERE h.identity_id=m.identity_id AND h.user_id=$1)`, userID, id).Scan(append([]any{&m.ID, &m.ConversationID}, identity.PublicDestinations(&m.Identity)...)...)
	return m, err
}
func (r Repository) List(ctx context.Context, userID string) ([]Match, error) {
	rows, err := r.DB.Query(ctx, `SELECT `+columns+joins+`WHERE m.user_id=$1 AND NOT EXISTS(SELECT 1 FROM identity_inheritances h WHERE h.identity_id=m.identity_id AND h.user_id=$1) ORDER BY c.updated_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Match{}
	for rows.Next() {
		var m Match
		if err := rows.Scan(append([]any{&m.ID, &m.ConversationID}, identity.PublicDestinations(&m.Identity)...)...); err != nil {
			return nil, err
		}
		items = append(items, m)
	}
	return items, rows.Err()
}
func (r Repository) Create(ctx context.Context, userID, identityID string) (Match, error) {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return Match{}, err
	}
	defer tx.Rollback(ctx)
	// Same account -> identity lock order as inheritance.
	if _, err = tx.Exec(ctx, `SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE`, userID); err != nil {
		return Match{}, err
	}
	if _, err = tx.Exec(ctx, `SELECT id FROM identities WHERE id=$1 FOR NO KEY UPDATE`, identityID); err != nil {
		return Match{}, err
	}
	var owner string
	if err = tx.QueryRow(ctx, `SELECT COALESCE((SELECT user_id FROM identity_inheritances WHERE identity_id=$1),'')`, identityID).Scan(&owner); err != nil {
		return Match{}, err
	}
	if owner == userID {
		return Match{}, response.BadRequest("不能与自己继承的 AI 身份聊天")
	}
	ownerType, mode := "AI", "NEVER"
	if owner != "" {
		ownerType, mode = "HUMAN", "TIMEOUT"
	}
	var id string
	err = tx.QueryRow(ctx, `INSERT INTO matches(id,user_id,identity_id) VALUES($1,$2,$3) ON CONFLICT(user_id,identity_id) DO UPDATE SET user_id=EXCLUDED.user_id RETURNING id`, database.ID(), userID, identityID).Scan(&id)
	if err != nil {
		return Match{}, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO conversations(id,match_id,user_id,identity_id,owner_type,auto_reply_mode,reply_delay_seconds) VALUES($1,$2,$3,$4,$5,$6,120) ON CONFLICT(match_id) DO NOTHING`, database.ID(), id, userID, identityID, ownerType, mode)
	if err != nil {
		return Match{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Match{}, err
	}
	return r.Get(ctx, userID, id)
}
