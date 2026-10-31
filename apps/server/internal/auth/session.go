package auth

import (
	"context"
	"errors"
	"time"

	"companion/server/pkg/response"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
)

var ErrInvalidSession = &response.Error{Status: 401, Code: "unauthorized", Message: "登录已失效，请重新登录"}

type Session struct {
	UserID  string
	Version int64
}

type sessionClaims struct {
	jwt.RegisteredClaims
	Version int64 `json:"sv"`
}

// Token signs the version observed when the password was verified, never a
// second read which could race with a password change. Omitted means legacy v0.
func (s Service) Token(userID string, versions ...int64) (string, error) {
	version := int64(0)
	if len(versions) > 0 {
		version = versions[0]
	}
	now := time.Now()
	return jwt.NewWithClaims(jwt.SigningMethodHS256, sessionClaims{
		RegisteredClaims: jwt.RegisteredClaims{Subject: userID, Issuer: "companion", IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(7 * 24 * time.Hour))},
		Version:          version,
	}).SignedString([]byte(s.Secret))
}

func (s Service) CurrentVersion(ctx context.Context, userID string) (int64, error) {
	if s.VersionLookup != nil {
		return s.VersionLookup(ctx, userID)
	}
	if s.Repo.DB == nil {
		return 0, errors.New("session repository unavailable")
	}
	var version int64
	err := s.Repo.DB.QueryRow(ctx, `SELECT session_version FROM users WHERE id=$1`, userID).Scan(&version)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrInvalidSession
	}
	return version, err
}

func (s Service) CheckSession(ctx context.Context, session Session) error {
	if session.UserID == "" || session.Version < 0 {
		return ErrInvalidSession
	}
	version, err := s.CurrentVersion(ctx, session.UserID)
	if err != nil {
		return err
	}
	if version != session.Version {
		return ErrInvalidSession
	}
	return nil
}

func (s Service) Authenticate(ctx context.Context, raw string) (Session, error) {
	claims := &sessionClaims{}
	_, err := jwt.ParseWithClaims(raw, claims, func(*jwt.Token) (any, error) { return []byte(s.Secret), nil }, jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer("companion"), jwt.WithExpirationRequired())
	if err != nil || claims.Subject == "" {
		return Session{}, ErrInvalidSession
	}
	session := Session{UserID: claims.Subject, Version: claims.Version}
	return session, s.CheckSession(ctx, session)
}

// Verify is retained for non-request callers. HTTP uses the request context.
func (s Service) Verify(raw string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	session, err := s.Authenticate(ctx, raw)
	if err != nil {
		return "", err
	}
	return session.UserID, nil
}

func (s Service) BindSession(c *gin.Context, session Session) {
	c.Set("userID", session.UserID)
	c.Set("sessionVersion", session.Version)
	c.Set("sessionCheck", func(ctx context.Context) error { return s.CheckSession(ctx, session) })
}

// Keep password revocation ordered after an in-flight external room creation.
// The durable cleanup job can then never miss a room created by an old session.
func (s Service) LockSession(ctx context.Context, session Session) (func(), error) {
	if s.VersionLookup != nil {
		return func() {}, s.CheckSession(ctx, session)
	}
	tx, err := s.Repo.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	release := func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = tx.Rollback(cleanup)
	}
	var version int64
	err = tx.QueryRow(ctx, `SELECT session_version FROM users WHERE id=$1 FOR SHARE`, session.UserID).Scan(&version)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && version != session.Version) {
		err = ErrInvalidSession
	}
	if err != nil {
		release()
		return nil, err
	}
	return release, nil
}

func SessionVersion(c *gin.Context) int64 { return c.GetInt64("sessionVersion") }

// Established sockets recheck the captured version, not their short-lived
// handshake ticket's expiry. Guest sockets have no account to revoke.
func CheckConnection(c *gin.Context, ctx context.Context) error {
	if check, ok := c.Get("sessionCheck"); ok {
		return check.(func(context.Context) error)(ctx)
	}
	if UserID(c) != "" {
		return ErrInvalidSession
	}
	return nil
}
