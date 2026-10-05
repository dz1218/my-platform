package delivery

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	aicontext "companion/server/internal/ai/context"
	"companion/server/internal/ai/provider"
	"companion/server/internal/behavior"
	"companion/server/internal/conversation"
	"companion/server/internal/identity"
	"companion/server/pkg/response"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type autopilotFixture struct {
	t        *testing.T
	ctx      context.Context
	db       *pgxpool.Pool
	repo     Repository
	service  Service
	policy   behavior.Policy
	sequence int
}

func autopilotTest(t *testing.T) *autopilotFixture {
	t.Helper()
	db := testDB(t)
	ctx := context.Background()
	_, err := db.Exec(ctx, `INSERT INTO users(id,email,password_hash,name,gender) VALUES('operator','operator@example.test','unused','Operator','FEMALE'),('stranger','stranger@example.test','unused','Stranger','FEMALE'); INSERT INTO identity_inheritances(identity_id,user_id) VALUES('identity_linwan','operator')`)
	if err != nil {
		t.Fatal(err)
	}
	p := behavior.Policy{Version: "autopilot-test", DebounceSeconds: 1, MaxWaitSeconds: 10, MaxAttempts: 3, RetrySeconds: 1}
	r := Repository{DB: db}
	return &autopilotFixture{t: t, ctx: ctx, db: db, repo: r, policy: p, service: Service{Repo: r, Messages: conversation.Repository{DB: db}, Policies: behavior.Catalog{Default: p}}}
}
func (f *autopilotFixture) configure(mode string) AutoReply {
	f.t.Helper()
	if _, err := f.repo.Configure(f.ctx, "c", "operator", "", 0, "HUMAN", f.policy); err != nil {
		f.t.Fatal(err)
	}
	s, err := f.repo.Configure(f.ctx, "c", "operator", mode, 60, "", f.policy)
	if err != nil {
		f.t.Fatal(err)
	}
	return s
}
func (f *autopilotFixture) send(actor string) conversation.Message {
	f.t.Helper()
	f.sequence++
	m, err := f.service.Send(f.ctx, actor, "c", fmt.Sprintf("request-%03d", f.sequence), fmt.Sprintf("message %d", f.sequence))
	if err != nil {
		f.t.Fatal(err)
	}
	return m
}
func (f *autopilotFixture) claim() Job {
	f.t.Helper()
	if _, err := f.db.Exec(f.ctx, `UPDATE reply_jobs SET due_at=now()-interval '1 second' WHERE conversation_id='c'`); err != nil {
		f.t.Fatal(err)
	}
	j, err := f.repo.Claim(f.ctx)
	if err != nil {
		f.t.Fatal(err)
	}
	return j
}
func (f *autopilotFixture) noClaim() {
	f.t.Helper()
	if _, err := f.repo.Claim(f.ctx); !errors.Is(err, pgx.ErrNoRows) {
		f.t.Fatalf("unexpected claim: %v", err)
	}
}
func (f *autopilotFixture) schedule(j Job) {
	f.t.Helper()
	if err := f.repo.Schedule(f.ctx, j, "AI reply", "test", time.Now().Add(-time.Second)); err != nil {
		f.t.Fatal(err)
	}
}
func (f *autopilotFixture) noDelivery() {
	f.t.Helper()
	if ok, err := f.repo.Deliver(f.ctx); ok || err != nil {
		f.t.Fatalf("unexpected delivery: %v %v", ok, err)
	}
	var count int
	if err := f.db.QueryRow(f.ctx, `SELECT count(*) FROM messages WHERE driver_type='ai'`).Scan(&count); err != nil || count != 0 {
		f.t.Fatalf("AI message persisted: %d %v", count, err)
	}
}
func TestAutopilotModesAndCoalescing(t *testing.T) {
	t.Run("never", func(t *testing.T) {
		f := autopilotTest(t)
		f.configure("NEVER")
		m := f.send("u")
		if m.Source != "USER" {
			t.Fatal(m)
		}
		f.noClaim()
		var count int
		if err := f.db.QueryRow(f.ctx, `SELECT count(*) FROM reply_jobs`).Scan(&count); err != nil || count != 0 {
			t.Fatal(count, err)
		}
	})
	t.Run("timeout coalesces three messages and refreshes deadline", func(t *testing.T) {
		f := autopilotTest(t)
		f.configure("TIMEOUT")
		first := f.send("u")
		f.send("u")
		last := f.send("u")
		var trigger string
		var due time.Time
		var turn int64
		if err := f.db.QueryRow(f.ctx, `SELECT trigger_message_id::text,due_at,turn_version FROM reply_jobs WHERE conversation_id='c'`).Scan(&trigger, &due, &turn); err != nil {
			t.Fatal(err)
		}
		if trigger != last.ID || trigger == first.ID || turn != 3 || due.Sub(last.CreatedAt) != 60*time.Second {
			t.Fatal(trigger, due, turn, last)
		}
		f.noClaim()
		j := f.claim()
		f.schedule(j)
		var wg sync.WaitGroup
		for i := 0; i < 8; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				if _, err := f.repo.Deliver(f.ctx); err != nil {
					t.Error(err)
				}
			}()
		}
		wg.Wait()
		var count int
		if err := f.db.QueryRow(f.ctx, `SELECT count(*) FROM messages WHERE driver_type='ai'`).Scan(&count); err != nil || count != 1 {
			t.Fatal(count, err)
		}
		f.schedule(j)
		if ok, err := f.repo.Deliver(f.ctx); ok || err != nil {
			t.Fatal("retried completed job", ok, err)
		}
	})
	t.Run("always uses server debounce", func(t *testing.T) {
		f := autopilotTest(t)
		f.configure("ALWAYS")
		m := f.send("u")
		var due time.Time
		if err := f.db.QueryRow(f.ctx, `SELECT due_at FROM reply_jobs`).Scan(&due); err != nil || due.Sub(m.CreatedAt) != time.Second {
			t.Fatal(due, err)
		}
		f.schedule(f.claim())
		if ok, err := f.repo.Deliver(f.ctx); !ok || err != nil {
			t.Fatal(ok, err)
		}
	})
	t.Run("AI owned still replies with never human policy", func(t *testing.T) {
		f := autopilotTest(t)
		f.send("u")
		f.schedule(f.claim())
		if ok, err := f.repo.Deliver(f.ctx); !ok || err != nil {
			t.Fatal(ok, err)
		}
	})
}
func TestHumanReplyInvalidatesEveryUncommittedStage(t *testing.T) {
	for _, stage := range []string{"queued", "generating", "scheduled"} {
		t.Run(stage, func(t *testing.T) {
			f := autopilotTest(t)
			f.configure("TIMEOUT")
			f.send("u")
			var j Job
			if stage != "queued" {
				j = f.claim()
			}
			if stage == "scheduled" {
				f.schedule(j)
			}
			human := f.send("operator")
			if human.Source != "HUMAN" || human.Sender.ID != "identity_linwan" {
				t.Fatal(human)
			}
			if stage != "queued" {
				f.schedule(j)
			}
			f.noDelivery()
			f.noClaim()
			var actor string
			if err := f.db.QueryRow(f.ctx, `SELECT actor_id FROM messages WHERE id=$1::bigint`, human.ID).Scan(&actor); err != nil || actor != "operator" {
				t.Fatal(actor, err)
			}
			// Network retry acknowledges the original human message, without advancing the turn.
			repeated, err := f.service.Send(f.ctx, "operator", "c", *human.RequestID, human.Content)
			if err != nil || repeated.ID != human.ID {
				t.Fatal(repeated, err)
			}
			var turn int64
			if err = f.db.QueryRow(f.ctx, `SELECT turn_version FROM conversations`).Scan(&turn); err != nil || turn != 2 {
				t.Fatal(turn, err)
			}
		})
	}
}
func TestSettingsInvalidateGenerationAndReevaluatePendingTurn(t *testing.T) {
	f := autopilotTest(t)
	f.configure("TIMEOUT")
	f.send("u")
	old := f.claim()
	f.configure("NEVER")
	f.schedule(old)
	f.noDelivery()
	f.noClaim()
	f.configure("ALWAYS")
	fresh := f.claim()
	if fresh.Version <= old.Version {
		t.Fatal("version reused")
	}
	if ok, err := f.repo.Current(f.ctx, old); ok || err != nil {
		t.Fatal("old job still current", err)
	}
	if ok, err := f.repo.Current(f.ctx, fresh); !ok || err != nil {
		t.Fatal("new job not current", err)
	}
	f.schedule(fresh)
	// Final validation must stand on its own even if invalidation did not run.
	if _, err := f.db.Exec(f.ctx, `UPDATE conversations SET settings_version=settings_version+1`); err != nil {
		t.Fatal(err)
	}
	f.noDelivery()
	var status string
	if err := f.db.QueryRow(f.ctx, `SELECT status FROM reply_jobs`).Scan(&status); err != nil || status != "cancelled" {
		t.Fatal(status, err)
	}
}
func TestTakeoverAuthorizationAndAudit(t *testing.T) {
	f := autopilotTest(t)
	for _, actor := range []string{"u", "stranger"} {
		if _, err := f.repo.Configure(f.ctx, "c", actor, "NEVER", 60, "", f.policy); err == nil {
			t.Fatal("unauthorized settings", actor)
		}
		if _, err := f.repo.Configure(f.ctx, "c", actor, "", 0, "HUMAN", f.policy); err == nil {
			t.Fatal("unauthorized takeover", actor)
		}
	}
	if _, err := f.service.Send(f.ctx, "operator", "c", "request-human", "hello"); err == nil {
		t.Fatal("human sent before takeover")
	}
	if _, err := f.service.Send(f.ctx, "stranger", "c", "request-other", "hello"); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatal(err)
	}
	for _, mode := range []string{"", "invalid"} {
		if _, err := f.repo.Configure(f.ctx, "c", "operator", mode, 60, "", f.policy); err == nil {
			t.Fatal("invalid mode accepted")
		}
	}
	if _, err := f.repo.Configure(f.ctx, "c", "operator", "TIMEOUT", -1, "", f.policy); err == nil {
		t.Fatal("invalid delay accepted")
	}
	s := f.configure("TIMEOUT")
	same := f.configure("TIMEOUT")
	if same.Version != s.Version {
		t.Fatal("idempotent configuration changed version")
	}
	for _, actor := range []string{"u", "operator"} {
		settings, err := f.repo.Settings(f.ctx, "c", actor)
		if err != nil || settings.CanManage != (actor == "operator") {
			t.Fatal(settings, err)
		}
	}
	f.send("u")
	f.send("operator")
	if _, err := f.repo.Configure(f.ctx, "c", "operator", "", 0, "AI", f.policy); err != nil {
		t.Fatal(err)
	}
	f.noClaim() // Do not reply to the human's own message after release.
	_, err := f.service.Send(f.ctx, "operator", "c", "request-after", "hello")
	var public *response.Error
	if !errors.As(err, &public) || public.Status != 403 {
		t.Fatal(err)
	}
	var count int
	if err = f.db.QueryRow(f.ctx, `SELECT count(*) FROM conversation_audit WHERE actor_id='operator'`).Scan(&count); err != nil || count != 3 {
		t.Fatal(count, err)
	}
	conv, _ := f.service.Messages.Accessible(f.ctx, "u", "c")
	page, err := f.service.Messages.History(f.ctx, conv, 0, 50)
	if err != nil || len(page.Items) != 2 || page.Items[0].Source != "USER" || page.Items[1].Source != "HUMAN" {
		t.Fatal(page, err)
	}
}
func TestClaimsAndGenerationAreExclusiveAcrossWorkers(t *testing.T) {
	f := autopilotTest(t)
	f.configure("ALWAYS")
	f.send("u")
	if _, err := f.db.Exec(f.ctx, `UPDATE reply_jobs SET due_at=now()-interval '1 second'`); err != nil {
		t.Fatal(err)
	}
	jobs := make(chan Job, 8)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			j, err := f.repo.Claim(f.ctx)
			if err == nil {
				jobs <- j
			} else if !errors.Is(err, pgx.ErrNoRows) {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	close(jobs)
	if len(jobs) != 1 {
		t.Fatalf("got %d claims", len(jobs))
	}
	old := <-jobs
	release, ok, err := f.repo.generationLock(f.ctx, "c")
	if err != nil || !ok {
		t.Fatal(ok, err)
	}
	defer release()
	f.send("u")
	fresh := f.claim()
	if _, ok, err = f.repo.generationLock(f.ctx, "c"); err != nil || ok {
		t.Fatal("overlapping generation", ok, err)
	}
	if err = f.repo.deferBusy(f.ctx, fresh); err != nil {
		t.Fatal(err)
	}
	release()
	fresh = f.claim()
	if fresh.Attempts != 1 {
		t.Fatal("busy lock consumed retry budget", fresh.Attempts)
	}
	f.schedule(old)
	f.noDelivery()
	f.schedule(fresh)
	restarted := Repository{DB: f.db}
	if ok, err := restarted.Deliver(f.ctx); !ok || err != nil {
		t.Fatal(ok, err)
	}
}

type blockingModel struct {
	started chan provider.ChatRequest
	finish  chan struct{}
}

func (m blockingModel) Generate(ctx context.Context, request provider.ChatRequest) (provider.Reply, error) {
	select {
	case m.started <- request:
	case <-ctx.Done():
		return provider.Reply{}, ctx.Err()
	}
	select {
	case <-m.finish:
		return provider.Reply{Content: "too late", PromptVersion: "test", Action: "reply"}, nil
	case <-ctx.Done():
		return provider.Reply{}, ctx.Err()
	}
}
func TestWorkerDiscardsReplyWhenHumanSendsDuringModelCall(t *testing.T) {
	f := autopilotTest(t)
	f.configure("TIMEOUT")
	f.send("u")
	j := f.claim()
	model := blockingModel{started: make(chan provider.ChatRequest, 1), finish: make(chan struct{})}
	worker := Worker{Repo: f.repo, Builder: aicontext.Builder{Identities: identity.Repository{DB: f.db}, Messages: f.service.Messages}, Model: model}
	ctx, cancel := context.WithTimeout(f.ctx, 10*time.Second)
	defer cancel()
	done := make(chan struct{})
	go func() { defer close(done); worker.generate(ctx, j) }()
	select {
	case request := <-model.started:
		if request.AllowWait {
			t.Fatal("model controls scheduling")
		}
	case <-ctx.Done():
		t.Fatal("model never started")
	}
	f.send("operator")
	close(model.finish)
	select {
	case <-done:
	case <-ctx.Done():
		t.Fatal("worker did not finish")
	}
	f.noDelivery()
}

func TestLegacyAssignmentCannotTransferInheritedIdentity(t *testing.T) {
	f := autopilotTest(t)
	f.configure("ALWAYS")
	f.send("u")
	job := f.claim()
	for _, operatorID := range []string{"u", "stranger", ""} {
		if err := f.repo.AssignOperator(f.ctx, "c", operatorID, "operator", f.service.Policies); err == nil {
			t.Fatal("legacy assignment transferred or revoked inherited identity", operatorID)
		}
	}
	if _, err := f.db.Exec(f.ctx, `INSERT INTO conversation_takeovers(conversation_id,operator_id) VALUES('c','stranger')`); err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.Messages.Accessible(f.ctx, "stranger", "c"); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatal("legacy operator gained read access", err)
	}
	if _, err := f.service.Send(f.ctx, "stranger", "c", "request-legacy", "hello"); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatal("legacy operator sent as inherited identity", err)
	}
	items, err := f.repo.Assignments(f.ctx, "stranger")
	if err != nil || len(items) != 0 {
		t.Fatal("legacy operator received inherited conversations", items, err)
	}
	items, err = f.repo.Assignments(f.ctx, "operator")
	if err != nil || len(items) != 1 || items[0].ParticipantName != "User" {
		t.Fatal("inheritor lost conversation", items, err)
	}
	s, err := f.repo.Settings(f.ctx, "c", "operator")
	if err != nil || s.OwnerType != "HUMAN" || s.Mode != "ALWAYS" || !s.CanManage {
		t.Fatal("rejected assignment changed ownership or policy", s, err)
	}
	if current, err := f.repo.Current(f.ctx, job); err != nil || !current {
		t.Fatal("rejected assignment invalidated the active job", err)
	}
	f.schedule(job)
	if ok, err := f.repo.Deliver(f.ctx); !ok || err != nil {
		t.Fatal(ok, err)
	}
}

func TestMessageEventsCatchUpBeyondHistoryWindow(t *testing.T) {
	f := autopilotTest(t)
	f.configure("NEVER")
	for i := 0; i < 55; i++ {
		f.send("u")
	}
	conv, err := f.service.Messages.Accessible(f.ctx, "operator", "c")
	if err != nil {
		t.Fatal(err)
	}
	page, err := f.service.Messages.History(f.ctx, conv, 0, 50)
	if err != nil || len(page.Items) != 50 {
		t.Fatal(page, err)
	}
	events, err := f.service.Messages.After(f.ctx, conv, 0, 200)
	if err != nil || len(events) != 55 {
		t.Fatal(len(events), err)
	}
	if events[0].Content != "message 1" || events[54].Content != "message 55" {
		t.Fatal("events not ordered")
	}
}
