package identity

import (
	"companion/server/pkg/response"
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
)

func ValidGender(gender string) bool { return gender == "FEMALE" || gender == "MALE" }

type InheritanceOption struct {
	Identity
	Available bool `json:"available"`
}
type InheritanceState struct {
	Gender              *string             `json:"gender"`
	OnboardingCompleted bool                `json:"onboardingCompleted"`
	Identity            *Identity           `json:"identity"`
	Items               []InheritanceOption `json:"items"`
}

func (r Repository) Inherited(ctx context.Context, user string) (*Identity, error) {
	var i Identity
	err := r.DB.QueryRow(ctx, `SELECT i.id,i.name,i.age,i.avatar_url,i.gender,i.city,i.background FROM identity_inheritances h JOIN identities i ON i.id=h.identity_id WHERE h.user_id=$1`, user).Scan(&i.ID, &i.Name, &i.Age, &i.AvatarURL, &i.Gender, &i.City, &i.Background)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &i, nil
}
func (r Repository) Inheritance(ctx context.Context, user string) (InheritanceState, error) {
	state := InheritanceState{Items: []InheritanceOption{}}
	err := r.DB.QueryRow(ctx, `SELECT gender,onboarding_completed FROM users WHERE id=$1`, user).Scan(&state.Gender, &state.OnboardingCompleted)
	if err != nil {
		return state, err
	}
	state.Identity, err = r.Inherited(ctx, user)
	if err != nil {
		return state, err
	}
	rows, err := r.DB.Query(ctx, `SELECT i.id,i.name,i.age,i.avatar_url,i.gender,i.city,i.background,
 h.identity_id IS NULL AND i.gender=COALESCE($1,'') AND NOT EXISTS(SELECT 1 FROM identity_inheritances WHERE user_id=$2)
 FROM identities i LEFT JOIN identity_inheritances h ON h.identity_id=i.id ORDER BY i.created_at,i.id`, state.Gender, user)
	if err != nil {
		return state, err
	}
	defer rows.Close()
	for rows.Next() {
		var i InheritanceOption
		if err = rows.Scan(&i.ID, &i.Name, &i.Age, &i.AvatarURL, &i.Gender, &i.City, &i.Background, &i.Available); err != nil {
			return state, err
		}
		state.Items = append(state.Items, i)
	}
	return state, rows.Err()
}
func (r Repository) SkipInheritance(ctx context.Context, user string) error {
	tag, err := r.DB.Exec(ctx, `UPDATE users SET onboarding_completed=true,updated_at=now() WHERE id=$1`, user)
	if err == nil && tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return err
}
func (r Repository) SetGender(ctx context.Context, user, gender string) error {
	if !ValidGender(gender) {
		return response.BadRequest("请选择你的性别")
	}
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var existing *string
	if err = tx.QueryRow(ctx, `SELECT gender FROM users WHERE id=$1 FOR NO KEY UPDATE`, user).Scan(&existing); err != nil {
		return err
	}
	if existing != nil {
		if *existing == gender {
			return tx.Commit(ctx)
		}
		return &response.Error{Status: 409, Code: "gender_set", Message: "账号性别已设置，不能在继承页面更改"}
	}
	var claimed bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM identity_inheritances WHERE user_id=$1)`, user).Scan(&claimed); err != nil {
		return err
	}
	if claimed {
		return &response.Error{Status: 409, Code: "already_inherited", Message: "继承身份后不能更改性别"}
	}
	if _, err = tx.Exec(ctx, `UPDATE users SET gender=$2,updated_at=now() WHERE id=$1`, user, gender); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
