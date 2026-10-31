package auth

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"companion/server/migrations"
	"companion/server/pkg/database"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"golang.org/x/crypto/bcrypt"
)

func passwordTestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	if os.Getenv("AUTH_INTEGRATION") != "1" {
		t.Skip("set AUTH_INTEGRATION=1 for isolated-schema password tests")
	}
	raw := os.Getenv("AUTH_TEST_DATABASE_URL")
	if raw == "" {
		env, err := godotenv.Read("../../.env")
		if err != nil {
			t.Fatal(err)
		}
		raw = env["DATABASE_URL"]
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1" && u.Hostname() != "::1") {
		t.Fatal("password integration tests require a local database")
	}
	ctx := context.Background()
	admin, err := database.Open(ctx, raw)
	if err != nil {
		t.Fatal(err)
	}
	schema := "password_test_" + database.ID()
	if _, err = admin.Exec(ctx, `CREATE SCHEMA `+schema); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = admin.Exec(context.Background(), `DROP SCHEMA `+schema+` CASCADE`); admin.Close() })
	cfg, err := pgxpool.ParseConfig(raw)
	if err != nil {
		t.Fatal(err)
	}
	delete(cfg.ConnConfig.RuntimeParams, "schema")
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	db, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	if err = migrations.Apply(ctx, db); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestSessionVersionFailsClosed(t *testing.T) {
	s := Service{Secret: strings.Repeat("s", 32)}
	raw, _ := s.Token("user")
	if _, err := s.Verify(raw); err == nil {
		t.Fatal("session accepted without a version repository")
	}
	version := int64(0)
	s.VersionLookup = func(context.Context, string) (int64, error) { return version, nil }
	legacy, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{Subject: "user", Issuer: "companion", ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}).SignedString([]byte(s.Secret))
	if _, err := s.Verify(legacy); err != nil {
		t.Fatal(err)
	}
	version = 1
	for _, old := range []string{raw, legacy} {
		if _, err := s.Verify(old); !errors.Is(err, ErrInvalidSession) {
			t.Fatal("old token survived", err)
		}
	}
	fresh, _ := s.Token("user", version)
	if _, err := s.Verify(fresh); err != nil {
		t.Fatal(err)
	}
}

func TestPasswordRecoveryIntegration(t *testing.T) {
	db := passwordTestDB(t)
	ctx := context.Background()
	sender := &testSMS{}
	s := Service{Repo: Repository{DB: db}, Secret: strings.Repeat("secret", 8), SMS: sender, ResetSMS: sender}
	count := 0
	create := func() User {
		count++
		hash, _ := bcrypt.GenerateFromPassword([]byte("original-password"), bcrypt.MinCost)
		u := User{ID: database.ID(), Phone: fmt.Sprintf("1390000%04d", count), PasswordHash: string(hash)}
		_, err := db.Exec(ctx, `INSERT INTO users(id,phone,name,password_hash,gender,updated_at) VALUES($1,$2,'测试账户',$3,'FEMALE',now())`, u.ID, u.Phone, u.PasswordHash)
		if err != nil {
			t.Fatal(err)
		}
		return u
	}
	ticket := func(u User) string {
		t.Helper()
		if err := s.SendPasswordCode(ctx, u.Phone); err != nil {
			t.Fatal(err)
		}
		proof, err := s.VerifyPasswordCode(ctx, u.Phone, sender.code)
		if err != nil {
			t.Fatal(err)
		}
		return proof
	}
	t.Run("reset consumes proof, invalidates both devices and retains rate budget", func(t *testing.T) {
		u := create()
		a, _ := s.Token(u.ID)
		b, _ := s.Token(u.ID)
		proof := ticket(u)
		requireCode(t, s.ResetPassword(ctx, u.Phone, proof, "short"), "invalid_password")
		requireCode(t, s.ResetPassword(ctx, u.Phone, proof, "original-password"), "same_password")
		if err := s.ResetPassword(ctx, u.Phone, proof, "new-password-1"); err != nil {
			t.Fatal(err)
		}
		requireCode(t, s.ResetPassword(ctx, u.Phone, proof, "new-password-2"), "verification_expired")
		for _, raw := range []string{a, b} {
			if _, err := s.Verify(raw); !errors.Is(err, ErrInvalidSession) {
				t.Fatal("old session survived", err)
			}
		}
		_, err := s.Login(ctx, u.Phone, "original-password")
		requireCode(t, err, "invalid")
		logged, err := s.Login(ctx, u.Phone, "new-password-1")
		if err != nil || logged.SessionVersion != 1 {
			t.Fatal(logged, err)
		}
		fresh, _ := s.Token(logged.ID, logged.SessionVersion)
		if _, err := s.Verify(fresh); err != nil {
			t.Fatal(err)
		}
		requireCode(t, s.SendPasswordCode(ctx, u.Phone), "rate_limit")
		var budget, jobs int
		_ = db.QueryRow(ctx, `SELECT daily_count FROM password_reset_verifications WHERE phone=$1`, u.Phone).Scan(&budget)
		_ = db.QueryRow(ctx, `SELECT count(*) FROM account_revocations WHERE user_id=$1 AND session_version=1`, u.ID).Scan(&jobs)
		if budget != 1 || jobs != 1 {
			t.Fatal(budget, jobs)
		}
	})
	t.Run("change checks original and cancels outstanding reset proofs", func(t *testing.T) {
		u := create()
		proof := ticket(u)
		session := Session{UserID: u.ID}
		requireCode(t, s.ChangePassword(ctx, session, "wrong", "new-password-1"), "invalid_current_password")
		requireCode(t, s.ChangePassword(ctx, session, "original-password", "original-password"), "same_password")
		if err := s.ChangePassword(ctx, session, "original-password", "new-password-1"); err != nil {
			t.Fatal(err)
		}
		requireCode(t, s.ResetPassword(ctx, u.Phone, proof, "new-password-2"), "verification_expired")
		if err := s.ChangePassword(ctx, session, "new-password-1", "new-password-2"); !errors.Is(err, ErrInvalidSession) {
			t.Fatal(err)
		}
	})
	t.Run("unknown phone sends nothing and cannot create account", func(t *testing.T) {
		before := sender.code
		phone := "13800009999"
		if err := s.SendPasswordCode(ctx, phone); err != nil {
			t.Fatal(err)
		}
		if sender.code != before {
			t.Fatal("sent to unknown account")
		}
		_, err := s.VerifyPasswordCode(ctx, phone, before)
		requireCode(t, err, "invalid_code")
		requireCode(t, s.ResetPassword(ctx, phone, strings.Repeat("a", 64), "new-password-1"), "verification_expired")
		var n int
		_ = db.QueryRow(ctx, `SELECT count(*) FROM users WHERE phone=$1`, phone).Scan(&n)
		if n != 0 {
			t.Fatal("created account")
		}
	})
	t.Run("cross purpose, expiry, guessing and delivery limits", func(t *testing.T) {
		u := create()
		if err := s.SendPasswordCode(ctx, u.Phone); err != nil {
			t.Fatal(err)
		}
		code := sender.code
		_, err := s.VerifyCode(ctx, u.Phone, code)
		requireCode(t, err, "invalid_code")
		wrong := "000000"
		if wrong == code {
			wrong = "111111"
		}
		for i := 0; i < 5; i++ {
			_, err = s.VerifyPasswordCode(ctx, u.Phone, wrong)
			requireCode(t, err, "invalid_code")
		}
		_, err = s.VerifyPasswordCode(ctx, u.Phone, code)
		requireCode(t, err, "invalid_code")
		_, _ = db.Exec(ctx, `UPDATE password_reset_verifications SET sent_at=now()-interval '61 seconds' WHERE phone=$1`, u.Phone)
		if err = s.SendPasswordCode(ctx, u.Phone); err != nil {
			t.Fatal(err)
		}
		_, _ = db.Exec(ctx, `UPDATE password_reset_verifications SET expires_at=now()-interval '1 second' WHERE phone=$1`, u.Phone)
		_, err = s.VerifyPasswordCode(ctx, u.Phone, sender.code)
		requireCode(t, err, "invalid_code")
		_, _ = db.Exec(ctx, `UPDATE password_reset_verifications SET sent_at=now()-interval '61 seconds',daily_count=10 WHERE phone=$1`, u.Phone)
		requireCode(t, s.SendPasswordCode(ctx, u.Phone), "rate_limit")
		u = create()
		sender.fail = true
		requireCode(t, s.SendPasswordCode(ctx, u.Phone), "sms_unavailable")
		sender.fail = false
		requireCode(t, s.SendPasswordCode(ctx, u.Phone), "rate_limit")
		u = create()
		proof := ticket(u)
		_, _ = db.Exec(ctx, `UPDATE password_reset_verifications SET ticket_expires_at=now()-interval '1 second' WHERE phone=$1`, u.Phone)
		requireCode(t, s.ResetPassword(ctx, u.Phone, proof, "new-password-1"), "verification_expired")
	})
	t.Run("concurrent reset and change have one winner", func(t *testing.T) {
		u := create()
		proof := ticket(u)
		start := make(chan struct{})
		results := make(chan error, 2)
		var wg sync.WaitGroup
		wg.Add(2)
		go func() { defer wg.Done(); <-start; results <- s.ResetPassword(ctx, u.Phone, proof, "reset-password") }()
		go func() {
			defer wg.Done()
			<-start
			results <- s.ChangePassword(ctx, Session{UserID: u.ID}, "original-password", "changed-password")
		}()
		close(start)
		wg.Wait()
		close(results)
		success := 0
		for err := range results {
			if err == nil {
				success++
			}
		}
		if success != 1 {
			t.Fatal("winners", success)
		}
		var version int64
		_ = db.QueryRow(ctx, `SELECT session_version FROM users WHERE id=$1`, u.ID).Scan(&version)
		if version != 1 {
			t.Fatal(version)
		}
	})
	t.Run("transaction failure retains old password and reusable proof", func(t *testing.T) {
		u := create()
		proof := ticket(u)
		_, err := db.Exec(ctx, `CREATE FUNCTION reject_revocation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END; $$;
          CREATE TRIGGER reject_revocation BEFORE INSERT ON account_revocations FOR EACH ROW EXECUTE FUNCTION reject_revocation()`)
		if err != nil {
			t.Fatal(err)
		}
		if err = s.ResetPassword(ctx, u.Phone, proof, "new-password-1"); err == nil {
			t.Fatal("transaction unexpectedly succeeded")
		}
		if _, err = s.Login(ctx, u.Phone, "original-password"); err != nil {
			t.Fatal(err)
		}
		_, err = db.Exec(ctx, `DROP TRIGGER reject_revocation ON account_revocations`)
		if err != nil {
			t.Fatal(err)
		}
		if err = s.ResetPassword(ctx, u.Phone, proof, "new-password-1"); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("room creation lock orders revocation after the external create", func(t *testing.T) {
		u := create()
		release, err := s.LockSession(ctx, Session{UserID: u.ID})
		if err != nil {
			t.Fatal(err)
		}
		defer release()
		// A conditional password write cannot commit while creation holds the
		// account row. Its durable cleanup is therefore enqueued afterward.
		blocked, err := db.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer blocked.Rollback(ctx)
		if _, err = blocked.Exec(ctx, `SET LOCAL lock_timeout='100ms'`); err != nil {
			t.Fatal(err)
		}
		_, err = blocked.Exec(ctx, `UPDATE users SET session_version=1 WHERE id=$1`, u.ID)
		if err == nil {
			t.Fatal("password write bypassed creation lock", err)
		}
		if err = blocked.Rollback(ctx); err != nil {
			t.Fatal(err)
		}
		release()
		if err = s.ChangePassword(ctx, Session{UserID: u.ID}, "original-password", "changed-password"); err != nil {
			t.Fatal(err)
		}
		if _, err = s.LockSession(ctx, Session{UserID: u.ID}); !errors.Is(err, ErrInvalidSession) {
			t.Fatal("revoked session could create room", err)
		}
	})
	t.Run("durable cleanup retries before completing", func(t *testing.T) {
		// Previous cases deliberately left jobs pending.
		worked, err := s.ProcessRevocation(ctx, func(context.Context, string, int64) error { return errors.New("temporary failure") })
		if err != nil || !worked {
			t.Fatal(worked, err)
		}
		var n int
		_ = db.QueryRow(ctx, `SELECT count(*) FROM account_revocations WHERE completed_at IS NULL AND attempts=1`).Scan(&n)
		if n != 1 {
			t.Fatal("failed cleanup marked complete", n)
		}
		_, _ = db.Exec(ctx, `UPDATE account_revocations SET retry_at=now()`)
		for {
			worked, err = s.ProcessRevocation(ctx, func(context.Context, string, int64) error { return nil })
			if err != nil {
				t.Fatal(err)
			}
			if !worked {
				break
			}
		}
		_ = db.QueryRow(ctx, `SELECT count(*) FROM account_revocations WHERE completed_at IS NULL`).Scan(&n)
		if n != 0 {
			t.Fatal("jobs left", n)
		}
	})
}
