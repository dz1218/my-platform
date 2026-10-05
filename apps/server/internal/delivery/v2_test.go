package delivery

import (
	aicontext "companion/server/internal/ai/context"
	"companion/server/internal/ai/provider"
	"companion/server/internal/conversation"
	"companion/server/internal/identity"
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
)

func plan(n int) provider.Reply {
	p := provider.Reply{Action: "REPLY", PromptVersion: "mock-v2"}
	for i := 0; i < n; i++ {
		p.Messages = append(p.Messages, provider.PlanItem{ClientItemKey: fmt.Sprint(i), Content: fmt.Sprintf("气泡%d", i)})
	}
	return p
}
func TestV201V202BufferedTurnAndMaxWindow(t *testing.T) {
	f := autopilotTest(t)
	f.send("u")
	f.send("u")
	f.send("u")
	var count int
	var version int64
	if err := f.db.QueryRow(f.ctx, `SELECT count(*) FROM messages`).Scan(&count); err != nil || count != 3 {
		t.Fatal(count, err)
	}
	if err := f.db.QueryRow(f.ctx, `SELECT turn_version FROM conversations WHERE id='c'`).Scan(&version); err != nil || version != 3 {
		t.Fatal(version, err)
	}
	f.noClaim()
	if _, err := f.db.Exec(f.ctx, `UPDATE conversations SET buffer_started_at=now()-interval '9 seconds' WHERE id='c'`); err != nil {
		t.Fatal(err)
	}
	f.send("u")
	j, err := f.repo.Claim(f.ctx)
	if err != nil {
		t.Fatal("max buffer kept extending", err)
	}
	f.noClaim()
	builder := aicontext.Builder{Messages: f.service.Messages, Identities: identity.Repository{DB: f.db}}
	req, err := builder.Build(f.ctx, j.Conversation)
	if err != nil || len(req.Messages) != 5 {
		t.Fatal("not all inputs reached context", len(req.Messages), err)
	}
}
func TestV203V205V215PartialBatchAndConcurrentDelivery(t *testing.T) {
	for _, interrupt := range []string{"user", "human", "mode", "concurrent"} {
		t.Run(interrupt, func(t *testing.T) {
			f := autopilotTest(t)
			f.configure("ALWAYS")
			f.send("u")
			j := f.claim()
			if err := f.repo.SchedulePlan(f.ctx, j, plan(3), time.Now().Add(-time.Second)); err != nil {
				t.Fatal(err)
			}
			var count int
			if err := f.db.QueryRow(f.ctx, `SELECT count(*) FROM messages WHERE driver_type='ai'`).Scan(&count); err != nil || count != 0 {
				t.Fatal("prewritten draft", err)
			}
			if ok, err := f.repo.Deliver(f.ctx); err != nil || !ok {
				t.Fatal(ok, err)
			}
			switch interrupt {
			case "user":
				f.send("u")
			case "human":
				f.send("operator")
			case "mode":
				f.configure("NEVER")
			case "concurrent":
				// Race a real human transaction with the next due item, then make sure
				// every item after the human transaction is permanently invalidated.
				var wg sync.WaitGroup
				wg.Add(2)
				go func() {
					defer wg.Done()
					if _, err := f.repo.Deliver(f.ctx); err != nil {
						t.Error(err)
					}
				}()
				go func() {
					defer wg.Done()
					if _, err := f.service.Send(f.ctx, "operator", "c", "race-human", "真人回复"); err != nil {
						t.Error(err)
					}
				}()
				wg.Wait()
			}
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
			if err := f.db.QueryRow(f.ctx, `SELECT count(*) FROM messages WHERE driver_type='ai'`).Scan(&count); err != nil || count < 1 || count > 2 {
				t.Fatal(count, err)
			}
			var afterHuman int
			if err := f.db.QueryRow(f.ctx, `SELECT count(*) FROM messages WHERE driver_type='ai' AND id>(SELECT max(id) FROM messages WHERE driver_type='human')`).Scan(&afterHuman); err != nil || afterHuman != 0 {
				t.Fatal("AI after human", err)
			}
			var pending int
			if err := f.db.QueryRow(f.ctx, `SELECT count(*) FROM reply_items WHERE status='PENDING'`).Scan(&pending); err != nil || pending != 0 {
				t.Fatal("uncanceled items", pending, err)
			}
			events, err := f.service.Messages.After(f.ctx, j.Conversation, 0, 200)
			if err != nil || len(events) != count+1+map[bool]int{true: 1, false: 0}[interrupt != "mode"] {
				t.Fatal("cursor lost committed items", len(events), err)
			}
		})
	}
	t.Run("two workers deliver all items once", func(t *testing.T) {
		f := autopilotTest(t)
		f.send("u")
		if err := f.repo.SchedulePlan(f.ctx, f.claim(), plan(3), time.Now().Add(-time.Second)); err != nil {
			t.Fatal(err)
		}
		var wg sync.WaitGroup
		for i := 0; i < 12; i++ {
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
		if err := f.db.QueryRow(f.ctx, `SELECT count(DISTINCT reply_item_id) FROM messages WHERE driver_type='ai'`).Scan(&count); err != nil || count != 3 {
			t.Fatal(count, err)
		}
	})
}
func TestV206V207SilenceAndInvalidPlans(t *testing.T) {
	f := autopilotTest(t)
	f.send("u")
	j := f.claim()
	bad := plan(2)
	bad.Messages[1].ClientItemKey = bad.Messages[0].ClientItemKey
	if err := f.repo.SchedulePlan(f.ctx, j, bad, time.Now()); err == nil {
		t.Fatal("duplicate key accepted")
	}
	bad = plan(1)
	bad.Messages[0].DelayMs = 10001
	if err := f.repo.SchedulePlan(f.ctx, j, bad, time.Now()); err == nil {
		t.Fatal("delay accepted")
	}
	if err := f.repo.SchedulePlan(f.ctx, j, provider.Reply{Action: "SILENCE"}, time.Now()); err != nil {
		t.Fatal(err)
	}
	f.noDelivery()
	f.noClaim()
}
func proactiveFixture(t *testing.T) (*autopilotFixture, string) {
	f := autopilotTest(t)
	m := f.send("u")
	j := f.claim()
	if err := f.repo.SchedulePlan(f.ctx, j, provider.Reply{Action: "SILENCE"}, time.Now()); err != nil {
		t.Fatal(err)
	}
	p := defaultPreferences()
	p.UserOptIn = true
	p.MemoryOptIn = true
	p.Timezone = "UTC"
	now := time.Now().UTC()
	minute := now.Hour()*60 + now.Minute()
	p.QuietStart = (minute + 60) % 1440
	p.QuietEnd = (minute + 120) % 1440
	if err := f.repo.SavePreferences(f.ctx, "c", "operator", p, false); err != nil {
		t.Fatal(err)
	}
	if _, err := f.db.Exec(f.ctx, `UPDATE messages SET created_at=now()-interval '1 day'`); err != nil {
		t.Fatal(err)
	}
	if err := f.repo.AddOpportunity(f.ctx, "c", "u", m.ID, "面试", time.Now().Add(-time.Hour), time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	var id string
	if err := f.db.QueryRow(f.ctx, `SELECT id FROM proactive_opportunities`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return f, id
}
func TestV208V210V211ProactiveFinalGates(t *testing.T) {
	for _, gate := range []string{"restart", "optout", "never", "quiet", "presence"} {
		t.Run(gate, func(t *testing.T) {
			f, _ := proactiveFixture(t)
			if gate == "presence" {
				if _, err := f.db.Exec(f.ctx, `INSERT INTO conversation_presence VALUES('c','operator',now()-interval '1 second')`); err != nil {
					t.Fatal(err)
				}
			}
			var wg sync.WaitGroup
			for i := 0; i < 2; i++ {
				wg.Add(1)
				go func() {
					defer wg.Done()
					if err := f.repo.QueueProactive(f.ctx, f.policy); err != nil {
						t.Error(err)
					}
				}()
			}
			wg.Wait()
			j := f.claim()
			if j.Kind != "PROACTIVE" {
				t.Fatal(j)
			}
			if gate == "optout" {
				p, err := f.repo.Preferences(f.ctx, "c", "operator")
				if err != nil {
					t.Fatal(err)
				}
				p.UserOptIn = false
				if err = f.repo.SavePreferences(f.ctx, "c", "operator", p, false); err != nil {
					t.Fatal(err)
				}
			}
			if err := f.repo.SchedulePlan(f.ctx, j, plan(2), time.Now().Add(-time.Second)); err != nil {
				t.Fatal(err)
			}
			switch gate {
			case "never":
				f.configure("NEVER")
			case "quiet":
				if _, err := f.db.Exec(f.ctx, `UPDATE proactive_preferences SET quiet_start=0,quiet_end=0`); err != nil {
					t.Fatal(err)
				}
			}
			if gate == "optout" || gate == "never" || gate == "quiet" {
				f.noDelivery()
				return
			}
			restarted := Repository{DB: f.db}
			for i := 0; i < 4; i++ {
				if _, err := restarted.Deliver(f.ctx); err != nil {
					t.Fatal(err)
				}
			}
			if err := restarted.QueueProactive(f.ctx, f.policy); err != nil {
				t.Fatal(err)
			}
			f.noClaim()
			var count int
			if err := f.db.QueryRow(f.ctx, `SELECT count(DISTINCT reply_batch_id) FROM messages WHERE message_kind='PROACTIVE'`).Scan(&count); err != nil || count != 1 {
				t.Fatal(count, err)
			}
		})
	}
}
func TestV209QuietHours(t *testing.T) {
	for _, x := range []struct {
		at    string
		zone  string
		quiet bool
	}{{"2026-10-02T14:00:00Z", "Asia/Shanghai", true}, {"2026-10-02T00:59:00Z", "Asia/Shanghai", true}, {"2026-10-02T01:00:00Z", "Asia/Shanghai", false}, {"2026-10-02T14:00:00Z", "America/New_York", false}} {
		now, _ := time.Parse(time.RFC3339, x.at)
		if QuietHours(now, x.zone, 1320, 540) != x.quiet {
			t.Fatal(x)
		}
	}
}
func TestV212V214MemoryDeletionAndDailyStateVersions(t *testing.T) {
	f := autopilotTest(t)
	m := f.send("u")
	p := defaultPreferences()
	p.MemoryOptIn = true
	if err := f.repo.SavePreferences(f.ctx, "c", "operator", p, false); err != nil {
		t.Fatal(err)
	}
	if err := f.repo.SaveMemory(f.ctx, "c", "u", Memory{Kind: "FACT", Content: "明天面试", SourceMessageID: m.ID}, false); err != nil {
		t.Fatal(err)
	}
	items, err := f.repo.Memories(f.ctx, "c", "u")
	if err != nil || len(items) != 1 {
		t.Fatal(items, err)
	}
	if err = f.repo.SaveMemory(f.ctx, "c", "u", items[0], true); err != nil {
		t.Fatal(err)
	}
	if err = f.repo.SaveMemory(f.ctx, "c", "u", Memory{Kind: "FACT", Content: "明天面试", SourceMessageID: m.ID}, false); err != nil {
		t.Fatal(err)
	}
	builder := aicontext.Builder{Messages: f.service.Messages, Identities: identity.Repository{DB: f.db}}
	req, err := builder.Build(f.ctx, conversation.Conversation{ID: "c", UserID: "u", IdentityID: "identity_linwan"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(req.Messages[0].Content, `"memories":[]`) {
		t.Fatal("deleted memory in context")
	}
	d := DailyState{Fictional: true, CurrentActivity: "虚构阅读", ExpiresAt: time.Now().Add(time.Hour)}
	if err = f.repo.SaveDailyState(f.ctx, "c", "operator", d); err != nil {
		t.Fatal(err)
	}
	if err = f.repo.SaveDailyState(f.ctx, "c", "operator", d); err == nil {
		t.Fatal("stale state overwrote human")
	}
	d.Version = 1
	if err = f.repo.SaveDailyState(f.ctx, "c", "operator", d); err != nil {
		t.Fatal(err)
	}
	if err = f.repo.SaveDailyState(f.ctx, "c", "operator", d); err == nil {
		t.Fatal("stale update accepted")
	}
}

func TestContextEnrichmentConsentSourcesAndDeletionFence(t *testing.T) {
	f := autopilotTest(t)
	m := f.send("u")
	p := defaultPreferences()
	p.MemoryOptIn = true
	if err := f.repo.SavePreferences(f.ctx, "c", "operator", p, false); err != nil {
		t.Fatal(err)
	}
	var version int64
	if err := f.db.QueryRow(f.ctx, `SELECT settings_version FROM conversations WHERE id='c'`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if _, err := f.db.Exec(f.ctx, `INSERT INTO context_jobs(conversation_id,through_message_id,settings_version,status,claim_token) VALUES('c',$1::bigint,$2,'RUNNING','lease')`, m.ID, version); err != nil {
		t.Fatal(err)
	}
	proposal := provider.Reply{Action: "SILENCE", Summary: "用户明确提到面试", MemoryProposals: []provider.MemoryProposal{{SourceMessageID: m.ID, Kind: "FACT", Content: "明天面试"}, {SourceMessageID: "999999", Kind: "FACT", Content: "无效来源"}}}
	if err := f.repo.commitEnrichment(f.ctx, "c", m.ID, "lease", version, proposal); err != nil {
		t.Fatal(err)
	}
	pending, err := f.repo.MemoryProposals(f.ctx, "c", "u")
	if err != nil || len(pending) != 1 || pending[0].Provenance != "USER_ASSERTED" {
		t.Fatal(pending, err)
	}
	memories, err := f.repo.Memories(f.ctx, "c", "u")
	if err != nil || len(memories) != 0 {
		t.Fatal("unconfirmed memory persisted", err)
	}
	if err = f.repo.SaveMemory(f.ctx, "c", "u", pending[0], true); err != nil {
		t.Fatal(err)
	}
	if _, err = f.db.Exec(f.ctx, `UPDATE context_jobs SET status='RUNNING' WHERE conversation_id='c'`); err != nil {
		t.Fatal(err)
	}
	if err = f.repo.commitEnrichment(f.ctx, "c", m.ID, "lease", version, proposal); err != nil {
		t.Fatal(err)
	}
	var summary string
	if err = f.db.QueryRow(f.ctx, `SELECT summary FROM conversations WHERE id='c'`).Scan(&summary); err != nil || summary != "" {
		t.Fatal("stale summary survived deletion", err)
	}
	pending, err = f.repo.MemoryProposals(f.ctx, "c", "u")
	if err != nil || len(pending) != 0 {
		t.Fatal("rejected proposal resurrected", err)
	}
}
func TestDailyTemplatesNeverOverwriteHumanEdits(t *testing.T) {
	f := autopilotTest(t)
	if err := f.repo.RefreshDailyStates(f.ctx); err != nil {
		t.Fatal(err)
	}
	state, err := f.repo.DailyState(f.ctx, "c", "u")
	if err != nil || !state.Fictional {
		t.Fatal(state, err)
	}
	first := state.Version
	if err = f.repo.RefreshDailyStates(f.ctx); err != nil {
		t.Fatal(err)
	}
	state, err = f.repo.DailyState(f.ctx, "c", "u")
	if err != nil || state.Version != first {
		t.Fatal("template not cached", err)
	}
	state.CurrentActivity = "真人编辑的虚拟日常"
	state.ExpiresAt = time.Now().Add(time.Hour)
	if err = f.repo.SaveDailyState(f.ctx, "c", "operator", state); err != nil {
		t.Fatal(err)
	}
	if _, err = f.db.Exec(f.ctx, `UPDATE identity_daily_state SET expires_at=now()-interval '1 hour'`); err != nil {
		t.Fatal(err)
	}
	if err = f.repo.RefreshDailyStates(f.ctx); err != nil {
		t.Fatal(err)
	}
	state, err = f.repo.DailyState(f.ctx, "c", "u")
	if err != nil || state.CurrentActivity != "真人编辑的虚拟日常" {
		t.Fatal("human state overwritten", err)
	}
}
func TestPreferencesRequireInheritedIdentity(t *testing.T) {
	f := autopilotTest(t)
	p := defaultPreferences()
	p.UserOptIn = true
	p.MemoryOptIn = true
	p.AllowProactiveAI = true
	assertDenied := func(actor string) {
		t.Helper()
		if _, err := f.repo.Preferences(f.ctx, "c", actor); err == nil {
			t.Fatalf("%s read settings without inheriting the identity", actor)
		}
		for _, manager := range []bool{false, true} {
			if err := f.repo.SavePreferences(f.ctx, "c", actor, p, manager); err == nil {
				t.Fatalf("%s changed settings without inheriting the identity (policy=%v)", actor, manager)
			}
		}
	}
	assertDenied("u")
	assertDenied("stranger")
	if err := f.repo.SavePreferences(f.ctx, "c", "operator", p, false); err != nil {
		t.Fatal(err)
	}
	saved, err := f.repo.Preferences(f.ctx, "c", "operator")
	if err != nil || !saved.MemoryOptIn || !saved.UserOptIn || saved.AllowProactiveAI {
		t.Fatal("settings endpoint changed the independent proactive policy", saved, err)
	}
	p = saved
	p.AllowProactiveAI = true
	if err := f.repo.SavePreferences(f.ctx, "c", "operator", p, true); err != nil {
		t.Fatal(err)
	}
	saved, err = f.repo.Preferences(f.ctx, "c", "operator")
	if err != nil || !saved.AllowProactiveAI || !saved.MemoryOptIn || !saved.UserOptIn {
		t.Fatal("policy update changed other settings", saved, err)
	}
	p = saved
	if _, err := f.db.Exec(f.ctx, `INSERT INTO conversation_takeovers(conversation_id,operator_id) VALUES('c','stranger')`); err != nil {
		t.Fatal(err)
	}
	assertDenied("stranger")
	if _, err := f.repo.Preferences(f.ctx, "c", "operator"); err != nil {
		t.Fatal("legacy assignment removed inheritor's settings access", err)
	}
	// An invalid self-assignment must not grant a chat participant management rights.
	if _, err := f.db.Exec(f.ctx, `UPDATE conversation_takeovers SET operator_id='u' WHERE conversation_id='c'`); err != nil {
		t.Fatal(err)
	}
	assertDenied("u")
}

type contextModel func(context.Context, provider.ChatRequest) (provider.Reply, error)

func (f contextModel) Generate(ctx context.Context, r provider.ChatRequest) (provider.Reply, error) {
	return f(ctx, r)
}
func TestEnrichmentWorkerUsesDurableJobAndNeverSends(t *testing.T) {
	f := autopilotTest(t)
	for i := 0; i < 20; i++ {
		f.send("u")
	}
	if err := f.repo.SchedulePlan(f.ctx, f.claim(), provider.Reply{Action: "SILENCE"}, time.Now()); err != nil {
		t.Fatal(err)
	}
	p := defaultPreferences()
	p.MemoryOptIn = true
	if err := f.repo.SavePreferences(f.ctx, "c", "operator", p, false); err != nil {
		t.Fatal(err)
	}
	calls := 0
	w := Worker{Repo: f.repo, Builder: aicontext.Builder{Messages: f.service.Messages, Identities: identity.Repository{DB: f.db}}, Model: contextModel(func(_ context.Context, r provider.ChatRequest) (provider.Reply, error) {
		calls++
		if r.Kind != "CONTEXT_UPDATE" {
			t.Error("wrong task kind")
		}
		return provider.Reply{Action: "SILENCE", Summary: "用户分享了近况", MemoryProposals: []provider.MemoryProposal{{SourceMessageID: r.Messages[1].ID, Kind: "FACT", Content: "经用户确认后保存"}}}, nil
	})}
	if err := w.enrich(f.ctx); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatal("enrichment not invoked", calls)
	}
	if err := w.enrich(f.ctx); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatal("duplicate enrichment", calls)
	}
	proposals, err := f.repo.MemoryProposals(f.ctx, "c", "u")
	if err != nil || len(proposals) != 1 {
		t.Fatal(proposals, err)
	}
	f.noDelivery()
}
