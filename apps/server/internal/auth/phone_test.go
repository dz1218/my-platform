package auth

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"

	"companion/server/migrations"
	"companion/server/pkg/database"
	"companion/server/pkg/response"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
)

type testSMS struct {
	code string
	fail bool
}

func (*testSMS) Configured() bool { return true }
func (s *testSMS) Send(_ context.Context, _, code string) error {
	s.code = code
	if s.fail {
		return smsUnavailable()
	}
	return nil
}
func requireCode(t *testing.T, err error, code string) {
	t.Helper()
	var e *response.Error
	if !errors.As(err, &e) || e.Code != code {
		t.Fatalf("want %s, got %v", code, err)
	}
}
func TestPhoneValidation(t *testing.T) {
	for _, s := range []string{"a@b.com", "1380013800", "12800138000", "13800138000,13900139000", "+113800138000"} {
		if _, err := normalizePhone(s); err == nil {
			t.Fatal("accepted invalid phone")
		}
	}
	if phone, err := normalizePhone(" +8613800138000 "); err != nil || phone != "13800138000" {
		t.Fatal(phone, err)
	}
	s := Service{VersionLookup: func(context.Context, string) (int64, error) { return 0, nil }, Secret: strings.Repeat("s", 32)}
	if s.digest("code", "13800138000", "123456") == s.digest("code", "13900139000", "123456") {
		t.Fatal("code is not bound to phone")
	}
}

func TestPhoneRegistrationIntegration(t *testing.T) {
	if os.Getenv("AUTH_INTEGRATION") != "1" {
		t.Skip("set AUTH_INTEGRATION=1 for temporary-schema verification tests")
	}
	ctx := context.Background()
	dbURL := os.Getenv("AUTH_TEST_DATABASE_URL")
	if dbURL == "" {
		env, err := godotenv.Read("../../.env")
		if err != nil {
			t.Fatal(err)
		}
		dbURL = env["DATABASE_URL"]
	}
	admin, err := database.Open(ctx, dbURL)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := "phone_test_" + database.ID()
	if _, err = admin.Exec(ctx, `CREATE SCHEMA `+schema); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(ctx, `DROP SCHEMA `+schema+` CASCADE`)
	cfg, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		t.Fatal(err)
	}
	delete(cfg.ConnConfig.RuntimeParams, "schema")
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	db, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = migrations.Apply(ctx, db); err != nil {
		t.Fatal(err)
	}
	sender := &testSMS{}
	s := Service{Repo: Repository{DB: db}, Secret: strings.Repeat("secret", 8), SMS: sender}
	phone := "13800138000"
	if err = s.SendCode(ctx, phone); err != nil {
		t.Fatal(err)
	}
	err = s.SendCode(ctx, phone)
	requireCode(t, err, "rate_limit")
	var limited *response.Error
	if !errors.As(err, &limited) || limited.RetryAfter < 1 || limited.RetryAfter > 60 {
		t.Fatalf("invalid cooldown: %v", err)
	}
	var stored string
	if err = db.QueryRow(ctx, `SELECT code_hash FROM phone_verifications WHERE phone=$1`, phone).Scan(&stored); err != nil || stored == sender.code {
		t.Fatal("code not protected", err)
	}
	_, err = s.VerifyCode(ctx, "13900139000", sender.code)
	requireCode(t, err, "invalid_code")
	ticket, err := s.VerifyCode(ctx, phone, sender.code)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.VerifyCode(ctx, phone, sender.code)
	requireCode(t, err, "invalid_code")
	_, err = s.Register(ctx, phone, "测试听友", "password123", true, "FEMALE", strings.Repeat("a", 64))
	requireCode(t, err, "verification_expired")
	_, err = s.Register(ctx, "13900139000", "测试听友", "password123", true, "FEMALE", ticket)
	requireCode(t, err, "verification_expired")
	_, err = s.Register(ctx, phone, "测试听友", "short", true, "FEMALE", ticket)
	requireCode(t, err, "invalid_request")
	// Exactly one concurrent registration may consume this proof.
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, e := s.Register(ctx, phone, "测试听友", "password123", true, "FEMALE", ticket)
			results <- e
		}()
	}
	wg.Wait()
	close(results)
	success := 0
	for e := range results {
		if e == nil {
			success++
		} else {
			requireCode(t, e, "verification_expired")
		}
	}
	if success != 1 {
		t.Fatalf("successful registrations: %d", success)
	}
	user, err := s.Login(ctx, "+86"+phone, "password123")
	if err != nil || user.Phone != phone || user.Gender == nil || user.OnboardingCompleted {
		t.Fatal("login", user, err)
	}
	_, err = s.Login(ctx, phone, "wrong")
	requireCode(t, err, "invalid")
	requireCode(t, s.SendCode(ctx, phone), "exists")
	// Wrong guesses exhaust the challenge, including simultaneous requests.
	phone = "13800138002"
	if err = s.SendCode(ctx, phone); err != nil {
		t.Fatal(err)
	}
	right := sender.code
	wrong := "000000"
	if right == wrong {
		wrong = "999999"
	}
	for i := 0; i < 5; i++ {
		_, err = s.VerifyCode(ctx, phone, wrong)
		requireCode(t, err, "invalid_code")
	}
	_, err = s.VerifyCode(ctx, phone, right)
	requireCode(t, err, "invalid_code")
	if _, err = db.Exec(ctx, `UPDATE phone_verifications SET sent_at=now()-interval '61 seconds' WHERE phone=$1`, phone); err != nil {
		t.Fatal(err)
	}
	if err = s.SendCode(ctx, phone); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(ctx, `UPDATE phone_verifications SET expires_at=now()-interval '1 second' WHERE phone=$1`, phone); err != nil {
		t.Fatal(err)
	}
	_, err = s.VerifyCode(ctx, phone, sender.code)
	requireCode(t, err, "invalid_code")
	if _, err = db.Exec(ctx, `UPDATE phone_verifications SET sent_at=now()-interval '61 seconds',daily_count=10 WHERE phone=$1`, phone); err != nil {
		t.Fatal(err)
	}
	err = s.SendCode(ctx, phone)
	requireCode(t, err, "rate_limit")
	if !errors.As(err, &limited) || limited.RetryAfter <= 60 || limited.RetryAfter > 86400 {
		t.Fatalf("invalid daily cooldown: %v", err)
	}
	phone = "13800138003"
	if err = s.SendCode(ctx, phone); err != nil {
		t.Fatal(err)
	}
	ticket, err = s.VerifyCode(ctx, phone, sender.code)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(ctx, `UPDATE phone_verifications SET ticket_expires_at=now()-interval '1 second' WHERE phone=$1`, phone); err != nil {
		t.Fatal(err)
	}
	_, err = s.Register(ctx, phone, "测试听友", "password123", true, "FEMALE", ticket)
	requireCode(t, err, "verification_expired")
	sender.fail = true
	requireCode(t, s.SendCode(ctx, "13800138004"), "sms_unavailable")
	requireCode(t, s.SendCode(ctx, "13800138004"), "rate_limit")
}
