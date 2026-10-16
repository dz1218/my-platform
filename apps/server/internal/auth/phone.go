package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math/big"
	"regexp"
	"strings"

	"companion/server/pkg/response"
	"github.com/jackc/pgx/v5"
)

var phonePattern = regexp.MustCompile(`^1[3-9][0-9]{9}$`)
var codePattern = regexp.MustCompile(`^[0-9]{6}$`)

func normalizePhone(phone string) (string, error) {
	phone = strings.TrimSpace(phone)
	phone = strings.TrimPrefix(phone, "+86")
	if !phonePattern.MatchString(phone) {
		return "", &response.Error{Status: 400, Code: "invalid_phone", Message: "请输入有效的中国大陆手机号"}
	}
	return phone, nil
}
func verificationExpired() error {
	return &response.Error{Status: 400, Code: "verification_expired", Message: "手机号验证已过期，请重新验证"}
}
func invalidCode() error {
	return &response.Error{Status: 400, Code: "invalid_code", Message: "验证码不正确或已过期"}
}
func (s Service) digest(purpose, phone, value string) string {
	hash := hmac.New(sha256.New, []byte(s.Secret))
	hash.Write([]byte(purpose + ":" + phone + ":" + value))
	return hex.EncodeToString(hash.Sum(nil))
}
func randomToken() (string, error) {
	b := make([]byte, 32)
	_, err := rand.Read(b)
	return hex.EncodeToString(b), err
}
func (s Service) SendCode(ctx context.Context, rawPhone string) error {
	phone, err := normalizePhone(rawPhone)
	if err != nil {
		return err
	}
	if s.SMS == nil || !s.SMS.Configured() {
		return &response.Error{Status: 503, Code: "sms_not_configured", Message: "短信服务尚未配置完成"}
	}
	var exists bool
	if err = s.Repo.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE phone=$1)`, phone).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return &response.Error{Status: 409, Code: "exists", Message: "该手机号已被注册"}
	}
	n, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		return err
	}
	code := fmt.Sprintf("%06d", n.Int64())
	digest := s.digest("code", phone, code)
	// Reserve atomically before the external call: one send/minute and ten/day per phone.
	tag, err := s.Repo.DB.Exec(ctx, `INSERT INTO phone_verifications(phone,code_hash,expires_at) VALUES($1,$2,now()+interval '5 minutes')
 ON CONFLICT(phone) DO UPDATE SET code_hash=$2,expires_at=now()+interval '5 minutes',sent_at=now(),attempts=0,ticket_hash=NULL,ticket_expires_at=NULL,
 daily_count=CASE WHEN phone_verifications.day_start<now()-interval '24 hours' THEN 1 ELSE phone_verifications.daily_count+1 END,
 day_start=CASE WHEN phone_verifications.day_start<now()-interval '24 hours' THEN now() ELSE phone_verifications.day_start END
 WHERE phone_verifications.sent_at<now()-interval '60 seconds' AND (phone_verifications.daily_count<10 OR phone_verifications.day_start<now()-interval '24 hours')`, phone, digest)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		var retryAfter int
		err = s.Repo.DB.QueryRow(ctx, `SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM GREATEST(
 sent_at + interval '60 seconds',
 CASE WHEN daily_count >= 10 THEN day_start + interval '24 hours' ELSE sent_at END
 ) - now())))::int FROM phone_verifications WHERE phone=$1`, phone).Scan(&retryAfter)
		if err != nil {
			return err
		}
		return &response.Error{Status: 429, Code: "rate_limit", Message: "发送太频繁，请稍后再试", RetryAfter: retryAfter}
	}
	// On delivery errors keep the reservation: retrying an uncertain send can duplicate SMS.
	return s.SMS.Send(ctx, phone, code)
}
func (s Service) VerifyCode(ctx context.Context, rawPhone, code string) (string, error) {
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
	var stored string
	// UPDATE holds a row lock so concurrent guesses cannot evade the attempt cap.
	err = tx.QueryRow(ctx, `UPDATE phone_verifications SET attempts=attempts+1 WHERE phone=$1 AND expires_at>now() AND attempts<5 AND ticket_hash IS NULL RETURNING code_hash`, phone).Scan(&stored)
	if err == pgx.ErrNoRows {
		return "", invalidCode()
	}
	if err != nil {
		return "", err
	}
	if !hmac.Equal([]byte(stored), []byte(s.digest("code", phone, code))) {
		if err = tx.Commit(ctx); err != nil {
			return "", err
		}
		return "", invalidCode()
	}
	_, err = tx.Exec(ctx, `UPDATE phone_verifications SET code_hash='',ticket_hash=$2,ticket_expires_at=now()+interval '10 minutes' WHERE phone=$1`, phone, s.digest("ticket", phone, ticket))
	if err != nil {
		return "", err
	}
	return ticket, tx.Commit(ctx)
}
