package identity

import (
	"context"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Identity struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	Age            int     `json:"age"`
	AvatarURL      string  `json:"avatarUrl"`
	Gender         string  `json:"gender"`
	City           string  `json:"city"`
	Background     string  `json:"background"`
	OccupationCode string  `json:"occupationCode"`
	Occupation     string  `json:"occupation"`
	Persona        Persona `json:"-"`
	PersonaVersion int64   `json:"-"`
}

type Persona struct {
	Personality   string   `json:"personality"`
	SpeakingStyle string   `json:"speakingStyle"`
	Interests     []string `json:"interests"`
	CareerStage   string   `json:"careerStage"`
	Backstory     string   `json:"backstory"`
	Goals         string   `json:"goals"`
}

// PublicColumns deliberately excludes the platform's private persona data.
const PublicColumns = `i.id,i.name,i.age,i.avatar_url,i.gender,i.city,i.background,i.occupation_code,i.occupation`

func PublicDestinations(i *Identity) []any {
	return []any{&i.ID, &i.Name, &i.Age, &i.AvatarURL, &i.Gender, &i.City, &i.Background, &i.OccupationCode, &i.Occupation}
}

type Repository struct{ DB *pgxpool.Pool }

func (r Repository) List(ctx context.Context) ([]Identity, error) {
	rows, err := r.DB.Query(ctx, `SELECT `+PublicColumns+` FROM identities i ORDER BY i.created_at,i.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Identity{}
	for rows.Next() {
		var i Identity
		if err := rows.Scan(PublicDestinations(&i)...); err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	return items, rows.Err()
}
func (r Repository) Get(ctx context.Context, id string) (Identity, error) {
	var i Identity
	err := r.DB.QueryRow(ctx, `SELECT `+PublicColumns+`,i.persona,i.persona_version FROM identities i WHERE i.id=$1`, id).Scan(append(PublicDestinations(&i), &i.Persona, &i.PersonaVersion)...)
	return i, err
}
