package identity

import (
	"context"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Identity struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Age        int    `json:"age"`
	AvatarURL  string `json:"avatarUrl"`
	City       string `json:"-"`
	Background string `json:"-"`
}
type Repository struct{ DB *pgxpool.Pool }

func (r Repository) List(ctx context.Context) ([]Identity, error) {
	rows, err := r.DB.Query(ctx, `SELECT id,name,age,avatar_url FROM identities ORDER BY created_at,id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Identity{}
	for rows.Next() {
		var i Identity
		if err := rows.Scan(&i.ID, &i.Name, &i.Age, &i.AvatarURL); err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	return items, rows.Err()
}
func (r Repository) Get(ctx context.Context, id string) (Identity, error) {
	var i Identity
	err := r.DB.QueryRow(ctx, `SELECT id,name,age,avatar_url,city,background FROM identities WHERE id=$1`, id).Scan(&i.ID, &i.Name, &i.Age, &i.AvatarURL, &i.City, &i.Background)
	return i, err
}
