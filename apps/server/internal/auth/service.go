package auth

import (
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
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"
)

const CookieName = "companion_session"

type Service struct {
	Repo   Repository
	Secret string
}

func (s Service) Register(ctx context.Context, email, name, password string, consent bool) (User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	name = strings.TrimSpace(name)
	addr, err := mail.ParseAddress(email)
	if err != nil || addr.Address != email || len(email) > 254 {
		return User{}, response.BadRequest("请输入有效邮箱")
	}
	if !consent {
		return User{}, response.BadRequest("请阅读并同意平台互动说明")
	}
	if len(password) < 8 || len(password) > 72 {
		return User{}, response.BadRequest("密码需要 8–72 字节")
	}
	if utf8.RuneCountInString(name) > 40 {
		return User{}, response.BadRequest("昵称不能超过 40 个字")
	}
	if name == "" {
		name = strings.Split(email, "@")[0]
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return User{}, err
	}
	u, err := s.Repo.Create(ctx, email, name, string(hash))
	var pe *pgconn.PgError
	if errors.As(err, &pe) && pe.Code == "23505" {
		return User{}, &response.Error{Status: 409, Code: "exists", Message: "该邮箱已被注册"}
	}
	return u, err
}
func (s Service) Login(ctx context.Context, email, password string) (User, error) {
	if len(password) > 256 {
		return User{}, response.BadRequest("密码过长")
	}
	u, err := s.Repo.ByEmail(ctx, strings.ToLower(strings.TrimSpace(email)))
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return User{}, err
	}
	if err != nil || !verifyPassword(password, u.PasswordHash) {
		return User{}, &response.Error{Status: 401, Code: "invalid", Message: "邮箱或密码不正确"}
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
