package auth

import (
	"companion/server/pkg/database"
	"context"
	"github.com/jackc/pgx/v5/pgxpool"
)

type User struct {
	ID           string `json:"id"`
	Email        string `json:"email"`
	Name         string `json:"name"`
	PasswordHash string `json:"-"`
}
type Repository struct{ DB *pgxpool.Pool }

func (r Repository) ByEmail(ctx context.Context, email string) (User, error) {
	var u User
	err := r.DB.QueryRow(ctx, `SELECT id,email,COALESCE(name,''),password_hash FROM users WHERE email=$1`, email).Scan(&u.ID, &u.Email, &u.Name, &u.PasswordHash)
	return u, err
}
func (r Repository) ByID(ctx context.Context, id string) (User, error) {
	var u User
	err := r.DB.QueryRow(ctx, `SELECT id,email,COALESCE(name,''),password_hash FROM users WHERE id=$1`, id).Scan(&u.ID, &u.Email, &u.Name, &u.PasswordHash)
	return u, err
}
func (r Repository) Create(ctx context.Context, email, name, hash string) (User, error) {
	u := User{ID: database.ID(), Email: email, Name: name}
	_, err := r.DB.Exec(ctx, `INSERT INTO users(id,email,name,password_hash,updated_at) VALUES($1,$2,$3,$4,now())`, u.ID, email, name, hash)
	return u, err
}
