package matching

import (
	"companion/server/internal/identity"
	"companion/server/pkg/database"
	"context"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Match struct {
	ID             string            `json:"id"`
	ConversationID string            `json:"conversationId"`
	Identity       identity.Identity `json:"identity"`
}
type Repository struct{ DB *pgxpool.Pool }

const columns = `m.id,c.id,i.id,i.name,i.age,i.avatar_url`
const joins = ` FROM matches m JOIN conversations c ON c.match_id=m.id JOIN identities i ON i.id=m.identity_id `

func (r Repository) Get(ctx context.Context, userID, id string) (Match, error) {
	var m Match
	err := r.DB.QueryRow(ctx, `SELECT `+columns+joins+`WHERE m.user_id=$1 AND m.id=$2`, userID, id).Scan(&m.ID, &m.ConversationID, &m.Identity.ID, &m.Identity.Name, &m.Identity.Age, &m.Identity.AvatarURL)
	return m, err
}
func (r Repository) List(ctx context.Context, userID string) ([]Match, error) {
	rows, err := r.DB.Query(ctx, `SELECT `+columns+joins+`WHERE m.user_id=$1 ORDER BY c.updated_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Match{}
	for rows.Next() {
		var m Match
		if err := rows.Scan(&m.ID, &m.ConversationID, &m.Identity.ID, &m.Identity.Name, &m.Identity.Age, &m.Identity.AvatarURL); err != nil {
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
	var id string
	err = tx.QueryRow(ctx, `INSERT INTO matches(id,user_id,identity_id) VALUES($1,$2,$3) ON CONFLICT(user_id,identity_id) DO UPDATE SET user_id=EXCLUDED.user_id RETURNING id`, database.ID(), userID, identityID).Scan(&id)
	if err != nil {
		return Match{}, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO conversations(id,match_id,user_id,identity_id) VALUES($1,$2,$3,$4) ON CONFLICT(match_id) DO NOTHING`, database.ID(), id, userID, identityID)
	if err != nil {
		return Match{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Match{}, err
	}
	return r.Get(ctx, userID, id)
}
