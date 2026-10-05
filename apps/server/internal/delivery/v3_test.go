package delivery

import (
	"strings"
	"testing"
	"time"
)

func TestV3PacingUsesBufferedInputAndSnapshots(t *testing.T) {
	for _, pacing := range []string{"", "typing"} {
		t.Run("pacing="+pacing, func(t *testing.T) {
			f := autopilotTest(t)
			f.policy.ReplyPacing = pacing
			f.service.Policies.Default = f.policy
			first, err := f.service.Send(f.ctx, "u", "c", "first-input", strings.Repeat("你😀", 40))
			if err != nil {
				t.Fatal(err)
			}
			last, err := f.service.Send(f.ctx, "u", "c", "last-input", "补充一下")
			if err != nil {
				t.Fatal(err)
			}
			j := f.claim()
			if j.Policy.ReplyPacing != pacing {
				t.Fatal("lost policy snapshot")
			}
			// A subsequent config change cannot change this job's policy.
			f.service.Policies.Default.ReplyPacing = ""
			p := plan(3)
			p.Messages[0].DelayMs = 300
			p.Messages[1].DelayMs = 700
			p.Messages[2].DelayMs = 900
			base := last.CreatedAt.Add(100 * time.Millisecond)
			if err = f.repo.SchedulePlan(f.ctx, j, p, base); err != nil {
				t.Fatal(err)
			}
			rows, err := f.db.Query(f.ctx, `SELECT due_at FROM reply_items ORDER BY item_index`)
			if err != nil {
				t.Fatal(err)
			}
			var dates []time.Time
			for rows.Next() {
				var d time.Time
				if err = rows.Scan(&d); err != nil {
					t.Fatal(err)
				}
				dates = append(dates, d)
			}
			rows.Close()
			if err = rows.Err(); err != nil {
				t.Fatal(err)
			}
			if len(dates) != 3 {
				t.Fatal(dates)
			}
			want := []time.Duration{300 * time.Millisecond, 700 * time.Millisecond, 900 * time.Millisecond}
			if pacing == "typing" {
				want = []time.Duration{2178 * time.Millisecond, 1200 * time.Millisecond, 1200 * time.Millisecond}
			}
			for i, d := range dates {
				from := base
				if i > 0 {
					from = dates[i-1]
				}
				if d.Sub(from) != want[i] {
					t.Fatal("incorrect persisted interval", i, d.Sub(from), want[i])
				}
			}
			if first.ID == last.ID {
				t.Fatal("input coalesced destructively")
			}
		})
	}
}

func TestV3LateDeliveryAndRestartPreserveRelativeIntervals(t *testing.T) {
	f := autopilotTest(t)
	f.send("u")
	p := plan(3)
	p.Messages[1].DelayMs = 1500
	p.Messages[2].DelayMs = 2300
	if err := f.repo.SchedulePlan(f.ctx, f.claim(), p, time.Now().Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	if ok, err := f.repo.Deliver(f.ctx); err != nil || !ok {
		t.Fatal(ok, err)
	}
	var gap float64
	if err := f.db.QueryRow(f.ctx, `SELECT extract(epoch FROM (SELECT due_at FROM reply_items WHERE item_index=2)-(SELECT due_at FROM reply_items WHERE item_index=1))`).Scan(&gap); err != nil || gap != 2.3 {
		t.Fatal("remaining gap changed", gap, err)
	}
	if err := f.db.QueryRow(f.ctx, `SELECT extract(epoch FROM due_at-clock_timestamp()) FROM reply_jobs`).Scan(&gap); err != nil || gap < 1.3 || gap > 1.5 {
		t.Fatal("first gap lost", gap, err)
	}
	if ok, err := f.repo.Deliver(f.ctx); ok || err != nil {
		t.Fatal("burst after late delivery", ok, err)
	}
	// Move persisted deadlines into the past to simulate another long downtime.
	if _, err := f.db.Exec(f.ctx, `UPDATE reply_items SET due_at=due_at-interval '1 hour' WHERE status='PENDING'; UPDATE reply_jobs SET due_at=due_at-interval '1 hour'`); err != nil {
		t.Fatal(err)
	}
	restarted := Repository{DB: f.db}
	if ok, err := restarted.Deliver(f.ctx); err != nil || !ok {
		t.Fatal(ok, err)
	}
	if err := f.db.QueryRow(f.ctx, `SELECT extract(epoch FROM due_at-clock_timestamp()) FROM reply_jobs`).Scan(&gap); err != nil || gap < 2.1 || gap > 2.3 {
		t.Fatal("restart lost gap", gap, err)
	}
	if ok, err := restarted.Deliver(f.ctx); ok || err != nil {
		t.Fatal("restart burst", ok, err)
	}
}

func TestV3TypingPacedBatchIsInterrupted(t *testing.T) {
	for _, actor := range []string{"u", "operator"} {
		t.Run(actor, func(t *testing.T) {
			f := autopilotTest(t)
			f.policy.ReplyPacing = "typing"
			f.service.Policies.Default = f.policy
			f.configure("ALWAYS")
			f.send("u")
			if _, err := f.db.Exec(f.ctx, `UPDATE messages SET created_at=clock_timestamp()-interval '20 seconds'; UPDATE conversations SET buffer_started_at=clock_timestamp()-interval '21 seconds'`); err != nil {
				t.Fatal(err)
			}
			if err := f.repo.SchedulePlan(f.ctx, f.claim(), plan(3), time.Now().Add(-time.Second)); err != nil {
				t.Fatal(err)
			}
			if ok, err := f.repo.Deliver(f.ctx); err != nil || !ok {
				t.Fatal(ok, err)
			}
			f.send(actor)
			if ok, err := f.repo.Deliver(f.ctx); err != nil || ok {
				t.Fatal("interrupted bubble delivered", ok, err)
			}
			var committed, canceled int
			if err := f.db.QueryRow(f.ctx, `SELECT count(*) FILTER(WHERE status='COMMITTED'),count(*) FILTER(WHERE status='CANCELED') FROM reply_items`).Scan(&committed, &canceled); err != nil || committed != 1 || canceled != 2 {
				t.Fatal(committed, canceled, err)
			}
		})
	}
}

func TestV3PacingDoesNotCountSilentlyAnsweredTurn(t *testing.T) {
	f := autopilotTest(t)
	f.policy.ReplyPacing = "typing"
	f.service.Policies.Default = f.policy
	if _, err := f.service.Send(f.ctx, "u", "c", "silent-input", strings.Repeat("字", 600)); err != nil {
		t.Fatal(err)
	}
	silent := plan(0)
	silent.Action = "SILENCE"
	if err := f.repo.SchedulePlan(f.ctx, f.claim(), silent, time.Now()); err != nil {
		t.Fatal(err)
	}
	m, err := f.service.Send(f.ctx, "u", "c", "new-turn", "好")
	if err != nil {
		t.Fatal(err)
	}
	base := m.CreatedAt.Add(100 * time.Millisecond)
	if err = f.repo.SchedulePlan(f.ctx, f.claim(), plan(1), base); err != nil {
		t.Fatal(err)
	}
	var due time.Time
	if err = f.db.QueryRow(f.ctx, `SELECT due_at FROM reply_items`).Scan(&due); err != nil {
		t.Fatal(err)
	}
	if due.Sub(base) != 1700*time.Millisecond {
		t.Fatal("counted an answered turn", due.Sub(base))
	}
}

func TestV3TypingDeferralIsBoundedAndRefundsAttempt(t *testing.T) {
	f := autopilotTest(t)
	f.send("u")
	if _, err := f.db.Exec(f.ctx, `INSERT INTO conversation_presence VALUES('c','u',clock_timestamp()+interval '30 seconds')`); err != nil {
		t.Fatal(err)
	}
	j := f.claim()
	if deferred, err := f.repo.deferForTyping(f.ctx, j); err != nil || !deferred {
		t.Fatal(deferred, err)
	}
	f.noClaim()
	var attempts int
	var seconds float64
	if err := f.db.QueryRow(f.ctx, `SELECT j.attempts,extract(epoch FROM j.due_at-c.buffer_started_at) FROM reply_jobs j JOIN conversations c ON c.id=j.conversation_id`).Scan(&attempts, &seconds); err != nil || attempts != 0 || seconds != 8 {
		t.Fatal(attempts, seconds, err)
	}
	// Continued typing cannot move the original cap; expired pulses do not wait.
	for _, expired := range []bool{false, true} {
		if expired {
			if _, err := f.db.Exec(f.ctx, `UPDATE conversations SET buffer_started_at=clock_timestamp(); UPDATE conversation_presence SET expires_at=clock_timestamp()-interval '1 second'`); err != nil {
				t.Fatal(err)
			}
		} else {
			if _, err := f.db.Exec(f.ctx, `UPDATE conversations SET buffer_started_at=clock_timestamp()-interval '9 seconds'`); err != nil {
				t.Fatal(err)
			}
		}
		fresh := f.claim()
		if fresh.Attempts != 1 {
			t.Fatal("typing consumed attempts", fresh.Attempts)
		}
		if deferred, err := f.repo.deferForTyping(f.ctx, fresh); err != nil || deferred {
			t.Fatal("unbounded typing wait", deferred, err)
		}
		if _, err := f.db.Exec(f.ctx, `UPDATE reply_jobs SET status='queued',attempts=0`); err != nil {
			t.Fatal(err)
		}
	}
}

func TestV3SendClearsOwnPresenceButRetryPreservesNewTyping(t *testing.T) {
	f := autopilotTest(t)
	if _, err := f.db.Exec(f.ctx, `INSERT INTO conversation_presence VALUES('c','u',clock_timestamp()+interval '5 seconds'),('c','operator',clock_timestamp()+interval '5 seconds')`); err != nil {
		t.Fatal(err)
	}
	m := f.send("u")
	var count int
	if err := f.db.QueryRow(f.ctx, `SELECT count(*) FROM conversation_presence WHERE actor_id='u'`).Scan(&count); err != nil || count != 0 {
		t.Fatal(count, err)
	}
	if err := f.db.QueryRow(f.ctx, `SELECT count(*) FROM conversation_presence WHERE actor_id='operator'`).Scan(&count); err != nil || count != 1 {
		t.Fatal("cleared other actor", count, err)
	}
	if _, err := f.db.Exec(f.ctx, `INSERT INTO conversation_presence VALUES('c','u',clock_timestamp()+interval '5 seconds')`); err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.Send(f.ctx, "u", "c", *m.RequestID, m.Content); err != nil {
		t.Fatal(err)
	}
	if err := f.db.QueryRow(f.ctx, `SELECT count(*) FROM conversation_presence WHERE actor_id='u'`).Scan(&count); err != nil || count != 1 {
		t.Fatal("retry cleared new typing", count, err)
	}
}

func TestV3TypingCannotShortenHumanTimeout(t *testing.T) {
	f := autopilotTest(t)
	f.configure("TIMEOUT")
	f.send("u")
	if _, err := f.db.Exec(f.ctx, `INSERT INTO conversation_presence VALUES('c','u',clock_timestamp()+interval '5 seconds')`); err != nil {
		t.Fatal(err)
	}
	f.noClaim()
	var seconds float64
	if err := f.db.QueryRow(f.ctx, `SELECT extract(epoch FROM j.due_at-m.created_at) FROM reply_jobs j JOIN messages m ON m.id=j.trigger_message_id`).Scan(&seconds); err != nil || seconds != 60 {
		t.Fatal("timeout shortened", seconds, err)
	}
}
