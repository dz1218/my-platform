package auth

import (
	"companion/server/internal/identity"
	"companion/server/pkg/database"
	"companion/server/pkg/response"
	"context"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/bcrypt"
	"golang.org/x/crypto/scrypt"
	"strings"
	"time"
	"unicode/utf8"
)

const CookieName = "companion_session"

type Service struct {
	Repo   Repository
	Secret string
	SMS    SMSSender
}

func (s Service) Register(ctx context.Context, phone, name, password string, consent bool, gender, ticket string) (User, error) {
	phone, err := normalizePhone(phone)
	if err != nil {
		return User{}, err
	}
	if !identity.ValidGender(gender) {
		return User{}, response.BadRequest("请选择你的性别")
	}
	if !consent {
		return User{}, response.BadRequest("请阅读并同意平台互动说明")
	}
	if len(password) < 8 || len(password) > 72 {
		return User{}, response.BadRequest("密码需要 8–72 字节")
	}
	name = strings.TrimSpace(name)
	if utf8.RuneCountInString(name) > 40 {
		return User{}, response.BadRequest("昵称不能超过 40 个字")
	}
	if name == "" {
		return User{}, &response.Error{Status: 400, Code: "name_required", Message: "请输入昵称"}
	}
	if len(ticket) != 64 {
		return User{}, verificationExpired()
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return User{}, err
	}
	tx, err := s.Repo.DB.Begin(ctx)
	if err != nil {
		return User{}, err
	}
	defer tx.Rollback(ctx)
	// Consume proof and create the account together. A failed insert leaves proof reusable.
	tag, err := tx.Exec(ctx, `DELETE FROM phone_verifications WHERE phone=$1 AND ticket_hash=$2 AND ticket_expires_at>now()`, phone, s.digest("ticket", phone, ticket))
	if err != nil {
		return User{}, err
	}
	if tag.RowsAffected() != 1 {
		return User{}, verificationExpired()
	}
	u := User{ID: database.ID(), Phone: phone, Name: name, Gender: &gender}
	_, err = tx.Exec(ctx, `INSERT INTO users(id,phone,name,password_hash,gender,updated_at) VALUES($1,$2,$3,$4,$5,now())`, u.ID, phone, name, string(hash), gender)
	var pe *pgconn.PgError
	if errors.As(err, &pe) && pe.Code == "23505" {
		return User{}, &response.Error{Status: 409, Code: "exists", Message: "该手机号已被注册"}
	}
	if err != nil {
		return User{}, err
	}
	return u, tx.Commit(ctx)
}
func (s Service) Login(ctx context.Context, phone, password string) (User, error) {
	phone, err := normalizePhone(phone)
	if err != nil {
		return User{}, err
	}
	if len(password) > 256 {
		return User{}, response.BadRequest("密码过长")
	}
	u, err := s.Repo.ByPhone(ctx, phone)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return User{}, err
	}
	if err != nil || !verifyPassword(password, u.PasswordHash) {
		return User{}, &response.Error{Status: 401, Code: "invalid", Message: "手机号或密码不正确"}
	}
	return u, nil
}
func verifyPassword(password, stored string) bool {
	if strings.HasPrefix(stored, "$2") {
		return bcrypt.CompareHashAndPassword([]byte(stored), []byte(password)) == nil
	}
	// Compatibility with the original Node crypto.scryptSync(password, salt, 64).
	parts := strings.Split(stored, ":")
	if len(parts) != 2 || len(parts[0]) != 32 {
		return false
	}
	expected, err := hex.DecodeString(parts[1])
	if err != nil || len(expected) != 64 {
		return false
	}
	actual, err := scrypt.Key([]byte(password), []byte(parts[0]), 16384, 8, 1, 64)
	return err == nil && subtle.ConstantTimeCompare(actual, expected) == 1
}
func (s Service) Token(userID string) (string, error) {
	now := time.Now()
	return jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{Subject: userID, Issuer: "companion", IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(7 * 24 * time.Hour))}).SignedString([]byte(s.Secret))
}
func (s Service) Verify(raw string) (string, error) {
	claims := &jwt.RegisteredClaims{}
	_, err := jwt.ParseWithClaims(raw, claims, func(t *jwt.Token) (interface{}, error) { return []byte(s.Secret), nil }, jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer("companion"), jwt.WithExpirationRequired())
	if err != nil || claims.Subject == "" {
		return "", errors.New("invalid session")
	}
	return claims.Subject, nil
}
