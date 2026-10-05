package delivery

import (
	"errors"
	"testing"
	"time"

	"companion/server/internal/matching"
	"companion/server/migrations"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Restore the pre-inheritance schema around legacy fixture data, then exercise
// the real 007 -> 008 -> 009 upgrade. This only runs in an isolated test schema.
func applyOwnerRetirement(t *testing.T, f *autopilotFixture) {
	t.Helper()
	if _, err := f.db.Exec(f.ctx, `DROP TABLE identity_inheritances;
 DROP FUNCTION preserve_identity_inheritance();
 DROP INDEX conversations_identity;
 ALTER TABLE users DROP COLUMN gender,DROP COLUMN onboarding_completed;
 ALTER TABLE identities DROP COLUMN gender;
 DELETE FROM schema_migrations WHERE version IN ('008_identity_inheritance.sql','009_retire_conversation_assignments.sql')`); err != nil {
		t.Fatal(err)
	}
	if err := migrations.Apply(f.ctx, f.db); err != nil {
		t.Fatal(err)
	}
	if err := migrations.Apply(f.ctx, f.db); err != nil {
		t.Fatal("migration rerun", err)
	}
}

func TestInheritanceRepairsPreviouslyAppliedReplyDelayConstraint(t *testing.T) {
	f := inheritanceTest(t)
	// A database upgraded by an earlier copy of 006 retains the original delay
	// CHECK despite having all migration versions through 009 marked applied.
	if _, err := f.db.Exec(f.ctx, `UPDATE users SET gender='FEMALE';
 UPDATE conversations SET reply_delay_seconds=60,automation_enabled=false,memory_opt_in=true WHERE id='c';
 INSERT INTO proactive_preferences(conversation_id,user_opt_in,allow_proactive_ai) VALUES('c',true,true);
 ALTER TABLE conversations DROP CONSTRAINT conversations_reply_delay_seconds_check;
 ALTER TABLE conversations ADD CONSTRAINT conversations_reply_delay_seconds_check CHECK(reply_delay_seconds IN (15,30,60,180,300,600));
 ALTER TABLE conversations ALTER COLUMN reply_delay_seconds SET DEFAULT 60;
 DELETE FROM schema_migrations WHERE version='010_repair_reply_delay_constraint.sql'`); err != nil {
		t.Fatal(err)
	}
	var applied int
	if err := f.db.QueryRow(f.ctx, `SELECT count(*) FROM schema_migrations`).Scan(&applied); err != nil || applied != 9 {
		t.Fatalf("legacy migration ledger: %d %v", applied, err)
	}
	err := f.repo.InheritIdentity(f.ctx, "operator", "identity_linwan", f.service.Policies)
	var constraint *pgconn.PgError
	if !errors.As(err, &constraint) || constraint.Code != "23514" || constraint.ConstraintName != "conversations_reply_delay_seconds_check" {
		t.Fatalf("expected old database constraint failure, got %v", err)
	}
	var claims, audit int
	var completed bool
	if err = f.db.QueryRow(f.ctx, `SELECT (SELECT count(*) FROM identity_inheritances),(SELECT count(*) FROM conversation_audit),onboarding_completed FROM users WHERE id='operator'`).Scan(&claims, &audit, &completed); err != nil || claims != 0 || audit != 0 || completed {
		t.Fatalf("failed claim partially committed: claims=%d audit=%d completed=%v err=%v", claims, audit, completed, err)
	}
	assertPreserved := func(wantOwner string, wantDelay int, wantVersion int64, wantProactive bool) {
		t.Helper()
		var owner string
		var delay int
		var version int64
		var automation, memory, optIn, proactive bool
		if err := f.db.QueryRow(f.ctx, `SELECT c.owner_type,c.reply_delay_seconds,c.settings_version,c.automation_enabled,c.memory_opt_in,p.user_opt_in,p.allow_proactive_ai FROM conversations c JOIN proactive_preferences p ON p.conversation_id=c.id WHERE c.id='c'`).Scan(&owner, &delay, &version, &automation, &memory, &optIn, &proactive); err != nil {
			t.Fatal(err)
		}
		if owner != wantOwner || delay != wantDelay || version != wantVersion || automation || !memory || !optIn || proactive != wantProactive {
			t.Fatalf("unexpected settings: owner=%s delay=%d version=%d automation=%v memory=%v optIn=%v proactive=%v", owner, delay, version, automation, memory, optIn, proactive)
		}
	}
	assertPreserved("AI", 60, 1, true)
	for n := 0; n < 2; n++ {
		if err = migrations.Apply(f.ctx, f.db); err != nil {
			t.Fatal("repair migration", err)
		}
		assertPreserved("AI", 60, 1, true)
	}
	if err = f.repo.InheritIdentity(f.ctx, "operator", "identity_linwan", f.service.Policies); err != nil {
		t.Fatal("claim after database repair", err)
	}
	assertPreserved("HUMAN", 120, 2, false)
	if err = f.db.QueryRow(f.ctx, `SELECT (SELECT count(*) FROM identity_inheritances WHERE user_id='operator' AND identity_id='identity_linwan'),onboarding_completed FROM users WHERE id='operator'`).Scan(&claims, &completed); err != nil || claims != 1 || !completed {
		t.Fatalf("claim did not complete: claims=%d completed=%v err=%v", claims, completed, err)
	}
	// New participants must still be able to open a chat after inheritance.
	future, err := (matching.Repository{DB: f.db}).Create(f.ctx, "stranger", "identity_linwan")
	if err != nil {
		t.Fatal("new match after database repair", err)
	}
	settings, err := f.repo.Settings(f.ctx, future.ConversationID, "operator")
	if err != nil || !settings.CanManage || settings.OwnerType != "HUMAN" || settings.Mode != "TIMEOUT" || settings.DelaySeconds != 120 {
		t.Fatalf("new chat settings: %+v %v", settings, err)
	}
	message, err := f.service.Send(f.ctx, "operator", future.ConversationID, "repaired-inherited-send", "你好，我在这里")
	if err != nil || message.Source != "HUMAN" || message.Sender.ID != "identity_linwan" {
		t.Fatalf("inherited identity reply: %+v %v", message, err)
	}
	// Keep the range established by current 006, including its boundary values.
	for _, delay := range []int{0, 120, 86400} {
		if _, err = f.db.Exec(f.ctx, `UPDATE conversations SET reply_delay_seconds=$1 WHERE id=$2`, delay, future.ConversationID); err != nil {
			t.Fatalf("supported delay %d rejected: %v", delay, err)
		}
	}
	for _, delay := range []int{-1, 86401} {
		if _, err = f.db.Exec(f.ctx, `UPDATE conversations SET reply_delay_seconds=$1 WHERE id=$2`, delay, future.ConversationID); !errors.As(err, &constraint) || constraint.Code != "23514" {
			t.Fatalf("out-of-range delay %d accepted: %v", delay, err)
		}
	}
	var delay int
	if err = f.db.QueryRow(f.ctx, `UPDATE conversations SET reply_delay_seconds=DEFAULT WHERE id=$1 RETURNING reply_delay_seconds`, future.ConversationID).Scan(&delay); err != nil || delay != 120 {
		t.Fatalf("repaired default delay: %d %v", delay, err)
	}
}

func TestInheritanceMigrationRestoresUnclaimedAIAndPreservesOptOut(t *testing.T) {
	for _, enabled := range []bool{true, false} {
		t.Run(map[bool]string{true: "enabled", false: "opted_out"}[enabled], func(t *testing.T) {
			f := inheritanceTest(t)
			f.send("u")
			old := f.claim()
			if err := f.repo.Schedule(f.ctx, old, "不应该发送的旧草稿", "old-prompt", time.Now().Add(-time.Second)); err != nil {
				t.Fatal(err)
			}
			if _, err := f.db.Exec(f.ctx, `UPDATE conversations SET owner_type='HUMAN',auto_reply_mode='NEVER',automation_enabled=$1,memory_opt_in=true WHERE id='c'`, enabled); err != nil {
				t.Fatal(err)
			}
			if _, err := f.db.Exec(f.ctx, `INSERT INTO proactive_preferences(conversation_id,user_opt_in,allow_proactive_ai) VALUES('c',false,false)`); err != nil {
				t.Fatal(err)
			}
			applyOwnerRetirement(t, f)
			var owner string
			var automation, memory, optIn, proactive bool
			var version int64
			if err := f.db.QueryRow(f.ctx, `SELECT c.owner_type,c.automation_enabled,c.memory_opt_in,c.settings_version,p.user_opt_in,p.allow_proactive_ai FROM conversations c JOIN proactive_preferences p ON p.conversation_id=c.id WHERE c.id='c'`).Scan(&owner, &automation, &memory, &version, &optIn, &proactive); err != nil {
				t.Fatal(err)
			}
			if owner != "AI" || automation != enabled || !memory || version != 2 || optIn || proactive {
				t.Fatalf("settings changed incorrectly: %s %v %v %d %v %v", owner, automation, memory, version, optIn, proactive)
			}
			var drafts int
			if err := f.db.QueryRow(f.ctx, `SELECT count(*) FROM reply_items WHERE status='PENDING'`).Scan(&drafts); err != nil || drafts != 0 {
				t.Fatalf("stale drafts survived: %d %v", drafts, err)
			}
			if delivered, err := f.repo.Deliver(f.ctx); err != nil || delivered {
				t.Fatalf("stale draft delivered: %v %v", delivered, err)
			}
			if err := f.repo.Schedule(f.ctx, old, "失效的模型回调", "old-prompt", time.Now()); err != nil {
				t.Fatal(err)
			}
			if enabled {
				job, err := f.repo.Claim(f.ctx)
				if err != nil {
					t.Fatal("unanswered legacy turn was not requeued", err)
				}
				if job.Version <= old.Version || job.Policy.Version != f.policy.Version {
					t.Fatalf("new snapshot/policy: %+v", job)
				}
				if current, err := f.repo.Current(f.ctx, job); err != nil || !current {
					t.Fatalf("restored generation invalid: %v %v", current, err)
				}
			} else {
				if _, err := f.repo.Claim(f.ctx); !errors.Is(err, pgx.ErrNoRows) {
					t.Fatalf("disabled AI queued work: %v", err)
				}
			}
			// Subsequent user messages follow the same preserved automation choice.
			f.send("u")
			if enabled {
				job := f.claim()
				if err := f.repo.Schedule(f.ctx, job, "恢复后的新回复", "fresh-prompt", time.Now().Add(-time.Second)); err != nil {
					t.Fatal(err)
				}
				if delivered, err := f.repo.Deliver(f.ctx); err != nil || !delivered {
					t.Fatalf("AI did not resume: %v %v", delivered, err)
				}
			} else {
				f.noClaim()
			}
			var oldMessages int
			if err := f.db.QueryRow(f.ctx, `SELECT count(*) FROM messages WHERE content IN ('不应该发送的旧草稿','失效的模型回调')`).Scan(&oldMessages); err != nil || oldMessages != 0 {
				t.Fatalf("old generated content escaped: %d %v", oldMessages, err)
			}
			var userMessages int
			if err := f.db.QueryRow(f.ctx, `SELECT count(*) FROM messages WHERE sender_type='user'`).Scan(&userMessages); err != nil || userMessages != 2 {
				t.Fatalf("committed history changed: %d %v", userMessages, err)
			}
		})
	}
}

func TestInheritanceMigrationQueuesLegacyNeverTurnWithoutJob(t *testing.T) {
	f := inheritanceTest(t)
	if _, err := f.db.Exec(f.ctx, `UPDATE conversations SET owner_type='HUMAN',auto_reply_mode='NEVER' WHERE id='c'`); err != nil {
		t.Fatal(err)
	}
	f.send("u")
	f.noClaim()
	applyOwnerRetirement(t, f)
	job, err := f.repo.Claim(f.ctx)
	if err != nil {
		t.Fatal("legacy no-job turn not queued", err)
	}
	if err = job.Policy.Validate(); err != nil {
		t.Fatal("invalid migration default policy", err)
	}
	if current, err := f.repo.Current(f.ctx, job); err != nil || !current {
		t.Fatalf("new job invalid: %v %v", current, err)
	}
	if err = f.repo.Schedule(f.ctx, job, "现在可以回复了", "fresh-prompt", time.Now().Add(-time.Second)); err != nil {
		t.Fatal(err)
	}
	if delivered, err := f.repo.Deliver(f.ctx); err != nil || !delivered {
		t.Fatalf("restored no-job turn did not deliver: %v %v", delivered, err)
	}
}
