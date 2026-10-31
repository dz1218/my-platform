package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"

	"companion/server/pkg/response"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

func passwordError(code, message string) error {
	return &response.Error{Status: 400, Code: code, Message: message}
}
func validateNewPassword(password string) error {
	if len(password) < 8 || len(password) > 72 {
		return passwordError("invalid_password", "密码需要 8–72 字节")
	}
	return nil
}
func (s Service) resetDigest(kind, phone string, version int64, value string) string {
	return s.digest("reset-"+kind, phone, fmt.Sprintf("%d:%s", version, value))
}

func (s Service) SendPasswordCode(ctx context.Context, rawPhone string) error {
	phone, err := normalizePhone(rawPhone)
	if err != nil {
		return err
	}
	if s.ResetSMS == nil || !s.ResetSMS.Configured() {
		return &response.Error{Status: 503, Code: "sms_not_configured", Message: "短信服务尚未配置完成"}
	}
	var userID *string
	var version int64
	var id string
	err = s.Repo.DB.QueryRow(ctx, `SELECT id,session_version FROM users WHERE phone=$1`, phone).Scan(&id, &version)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if err == nil {
		userID = &id
	}
	n, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		return err
	}
	code := fmt.Sprintf("%06d", n.Int64())
	hash := s.resetDigest("code", phone, version, code)
	if userID == nil {
		hash = ""
	}
	// Reserve even for unknown numbers; the public response and cooldown do not
	// disclose whether an account exists. Never erase this row after success.
	tag, err := s.Repo.DB.Exec(ctx, `INSERT INTO password_reset_verifications(phone,user_id,session_version,code_hash,expires_at)
        VALUES($1,$2,$3,$4,now()+interval '5 minutes')
        ON CONFLICT(phone) DO UPDATE SET user_id=$2,session_version=$3,code_hash=$4,expires_at=now()+interval '5 minutes',
        sent_at=now(),attempts=0,ticket_hash=NULL,ticket_expires_at=NULL,consumed_at=NULL,
        daily_count=CASE WHEN password_reset_verifications.day_start<now()-interval '24 hours' THEN 1 ELSE password_reset_verifications.daily_count+1 END,
        day_start=CASE WHEN password_reset_verifications.day_start<now()-interval '24 hours' THEN now() ELSE password_reset_verifications.day_start END
        WHERE password_reset_verifications.sent_at<now()-interval '60 seconds'
        AND (password_reset_verifications.daily_count<10 OR password_reset_verifications.day_start<now()-interval '24 hours')`, phone, userID, version, hash)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		var retry int
		err = s.Repo.DB.QueryRow(ctx, `SELECT GREATEST(1,CEIL(EXTRACT(EPOCH FROM GREATEST(sent_at+interval '60 seconds',
            CASE WHEN daily_count>=10 THEN day_start+interval '24 hours' ELSE sent_at END)-now())))::int
            FROM password_reset_verifications WHERE phone=$1`, phone).Scan(&retry)
		if err != nil {
			return err
		}
		return &response.Error{Status: 429, Code: "rate_limit", Message: "发送太频繁，请稍后再试", RetryAfter: retry}
	}
	if userID == nil {
		return nil
	}
	return s.ResetSMS.Send(ctx, phone, code)
}

func (s Service) VerifyPasswordCode(ctx context.Context, rawPhone, code string) (string, error) {
	phone, err := normalizePhone(rawPhone)
	if err != nil {
		return "", err
	}
	if !codePattern.MatchString(code) {
		return "", invalidCode()
	}
	ticket, err := randomToken()
	if err != nil {
		return "", err
	}
	tx, err := s.Repo.DB.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	var hash string
	var version int64
	err = tx.QueryRow(ctx, `UPDATE password_reset_verifications v SET attempts=attempts+1
        WHERE phone=$1 AND expires_at>now() AND attempts<5 AND ticket_hash IS NULL AND consumed_at IS NULL
        AND EXISTS(SELECT 1 FROM users u WHERE u.id=v.user_id AND u.phone=v.phone AND u.session_version=v.session_version)
        RETURNING code_hash,session_version`, phone).Scan(&hash, &version)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", invalidCode()
	}
	if err != nil {
		return "", err
	}
	if !hmac.Equal([]byte(hash), []byte(s.resetDigest("code", phone, version, code))) {
		if err = tx.Commit(ctx); err != nil {
			return "", err
		}
		return "", invalidCode()
	}
	_, err = tx.Exec(ctx, `UPDATE password_reset_verifications SET code_hash='',ticket_hash=$2,ticket_expires_at=now()+interval '10 minutes' WHERE phone=$1`, phone, s.resetDigest("ticket", phone, version, ticket))
	if err != nil {
		return "", err
	}
	return ticket, tx.Commit(ctx)
}

func (s Service) ResetPassword(ctx context.Context, rawPhone, ticket, password string) error {
	phone, err := normalizePhone(rawPhone)
	if err != nil {
		return err
	}
	if err = validateNewPassword(password); err != nil {
		return err
	}
	if len(ticket) != 64 {
		return verificationExpired()
	}
	u, err := s.Repo.ByPhone(ctx, phone)
	if errors.Is(err, pgx.ErrNoRows) {
		return verificationExpired()
	}
	if err != nil {
		return err
	}
	digest := s.resetDigest("ticket", phone, u.SessionVersion, ticket)
	var valid bool
	err = s.Repo.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM password_reset_verifications WHERE phone=$1 AND user_id=$2
        AND session_version=$3 AND ticket_hash=$4 AND ticket_expires_at>now() AND consumed_at IS NULL)`, phone, u.ID, u.SessionVersion, digest).Scan(&valid)
	if err != nil {
		return err
	}
	if !valid {
		return verificationExpired()
	}
	return s.replacePassword(ctx, u, password, digest)
}

func (s Service) ChangePassword(ctx context.Context, session Session, current, password string) error {
	if err := validateNewPassword(password); err != nil {
		return err
	}
	u, err := s.Repo.ByID(ctx, session.UserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrInvalidSession
	}
	if err != nil {
		return err
	}
	if u.SessionVersion != session.Version {
		return ErrInvalidSession
	}
	if len(current) > 256 || !verifyPassword(current, u.PasswordHash) {
		return passwordError("invalid_current_password", "原密码不正确")
	}
	return s.replacePassword(ctx, u, password, "")
}

func (s Service) replacePassword(ctx context.Context, u User, password, ticketHash string) error {
	if verifyPassword(password, u.PasswordHash) {
		return passwordError("same_password", "新密码不能与原密码相同")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	tx, err := s.Repo.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// All password mutations lock users first, then the challenge. A losing
	// concurrent request never overwrites the winner's password or version.
	tag, err := tx.Exec(ctx, `UPDATE users SET password_hash=$2,session_version=session_version+1,updated_at=now()
        WHERE id=$1 AND session_version=$3 AND password_hash=$4`, u.ID, string(hash), u.SessionVersion, u.PasswordHash)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		if ticketHash != "" {
			return verificationExpired()
		}
		return ErrInvalidSession
	}
	if ticketHash != "" {
		tag, err = tx.Exec(ctx, `UPDATE password_reset_verifications SET consumed_at=now() WHERE phone=$1 AND user_id=$2
            AND session_version=$3 AND ticket_hash=$4 AND ticket_expires_at>now() AND consumed_at IS NULL`, u.Phone, u.ID, u.SessionVersion, ticketHash)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return verificationExpired()
		}
	}
	_, err = tx.Exec(ctx, `UPDATE password_reset_verifications SET consumed_at=now(),code_hash='',ticket_hash=NULL,ticket_expires_at=NULL WHERE user_id=$1`, u.ID)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO account_revocations(user_id,session_version) VALUES($1,$2)`, u.ID, u.SessionVersion+1)
	if err != nil {
		return err
	}
	// Reuse account notifications to wake the account socket before its heartbeat.
	_, err = tx.Exec(ctx, `SELECT pg_notify('companion_matches_changed',json_build_object('schema',current_schema(),'userId',$1::text)::text)`, u.ID)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
