package delivery

import (
	aicontext "companion/server/internal/ai/context"
	"companion/server/internal/ai/provider"
	"companion/server/internal/identity"
	"companion/server/internal/matching"
	"context"
	"encoding/json"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

func testCatalog() identity.Catalog {
	return identity.Catalog{SchemaVersion: 1, Occupations: []identity.OccupationTemplate{{Code: "editor", Name: "编辑", MinAge: 22}}, Identities: []identity.CatalogIdentity{{ID: "identity_linwan", Name: "林晚", Age: 27, Gender: "FEMALE", City: "上海", Background: "在上海从事图书编辑。", OccupationCode: "editor", Persona: identity.Persona{Personality: "坦诚，有耐心", SpeakingStyle: "自然完整的句子", Interests: []string{"阅读"}, CareerStage: "有五年编辑经验", Backstory: "毕业后进入出版行业", Goals: "做好一本新书"}}}}
}
func importTestCatalog(t *testing.T, f *autopilotFixture, c identity.Catalog) CatalogResult {
	t.Helper()
	result, err := f.repo.ImportCatalog(f.ctx, c, false)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestCatalogImportDryRunIdempotenceAndOwnership(t *testing.T) {
	f := autopilotTest(t)
	c := testCatalog()
	preview, err := f.repo.ImportCatalog(f.ctx, c, true)
	if err != nil || preview.Updated != 1 || preview.AffectedConversations != 1 {
		t.Fatal(preview, err)
	}
	i, err := (identity.Repository{DB: f.db}).Get(f.ctx, "identity_linwan")
	if err != nil || i.OccupationCode != "" || i.PersonaVersion != 1 {
		t.Fatal("dry run mutated identity", i, err)
	}
	result := importTestCatalog(t, f, c)
	if result.Updated != 1 || result.AffectedConversations != 1 {
		t.Fatal(result)
	}
	m := f.send("u")
	old := f.claim()
	result = importTestCatalog(t, f, c)
	if result.Unchanged != 1 || result.Updated != 0 || result.AffectedConversations != 0 {
		t.Fatal("identical import invalidated conversations", result)
	}
	if ok, err := f.repo.Current(f.ctx, old); err != nil || !ok {
		t.Fatal("idempotent import retired current lease", err)
	}
	i, err = (identity.Repository{DB: f.db}).Get(f.ctx, "identity_linwan")
	if err != nil || i.PersonaVersion != 2 || i.Occupation != "编辑" {
		t.Fatal(i, err)
	}
	var owner, content string
	if err = f.db.QueryRow(f.ctx, `SELECT user_id FROM identity_inheritances WHERE identity_id='identity_linwan'`).Scan(&owner); err != nil || owner != "operator" {
		t.Fatal("owner changed", owner, err)
	}
	if err = f.db.QueryRow(f.ctx, `SELECT content FROM messages WHERE id=$1`, m.ID).Scan(&content); err != nil || content != m.Content {
		t.Fatal("history changed", content, err)
	}
	// Reject the entire file if an update changes an inherited identity's gender.
	newRole := c.Identities[0]
	newRole.ID = "identity_new"
	newRole.Age = 28
	c.Identities = append(c.Identities, newRole)
	c.Identities[0].Gender = "MALE"
	if _, err = f.repo.ImportCatalog(f.ctx, c, false); err == nil {
		t.Fatal("inherited gender changed")
	}
	var count int
	if err = f.db.QueryRow(f.ctx, `SELECT count(*) FROM identities WHERE id='identity_new'`).Scan(&count); err != nil || count != 0 {
		t.Fatal("partial import survived failure", count, err)
	}
}

func TestCatalogImportInvalidatesAllSharedConversations(t *testing.T) {
	f := autopilotTest(t)
	c := testCatalog()
	importTestCatalog(t, f, c)
	other, err := (matching.Repository{DB: f.db}).Create(f.ctx, "stranger", "identity_linwan")
	if err != nil {
		t.Fatal(err)
	}
	f.send("u")
	old := f.claim()
	if _, err = f.service.Send(f.ctx, "stranger", other.ConversationID, "other-user-message", "你好"); err != nil {
		t.Fatal(err)
	}
	c.Identities[0].Persona.Personality = "沉稳，喜欢直接表达"
	result := importTestCatalog(t, f, c)
	if result.AffectedConversations != 2 {
		t.Fatal(result)
	}
	if ok, err := f.repo.Current(f.ctx, old); err != nil || ok {
		t.Fatal("old shared identity lease remains current", err)
	}
	f.schedule(old)
	f.noDelivery()
	var count int
	if err = f.db.QueryRow(f.ctx, `SELECT count(*) FROM reply_jobs j JOIN conversations c ON c.id=j.conversation_id WHERE c.identity_id='identity_linwan' AND j.status='queued' AND j.settings_version=c.settings_version`).Scan(&count); err != nil || count != 2 {
		t.Fatal("unanswered shared conversations not refreshed", count, err)
	}
	i, err := (identity.Repository{DB: f.db}).Get(f.ctx, "identity_suhe")
	if err != nil || i.PersonaVersion != 1 {
		t.Fatal("unrelated identity changed", i, err)
	}
}

func TestCatalogImportCancelsOnlyUnsentBatchItems(t *testing.T) {
	f := autopilotTest(t)
	c := testCatalog()
	importTestCatalog(t, f, c)
	f.send("u")
	job := f.claim()
	if err := f.repo.SchedulePlan(f.ctx, job, plan(3), time.Now().Add(-time.Second)); err != nil {
		t.Fatal(err)
	}
	if delivered, err := f.repo.Deliver(f.ctx); err != nil || !delivered {
		t.Fatal(delivered, err)
	}
	c.Identities[0].Persona.Goals = "完成一本新的散文集"
	importTestCatalog(t, f, c)
	if delivered, err := f.repo.Deliver(f.ctx); err != nil || delivered {
		t.Fatal("stale remaining bubble delivered", err)
	}
	var committed, canceled int
	if err := f.db.QueryRow(f.ctx, `SELECT count(*) FILTER(WHERE status='COMMITTED'),count(*) FILTER(WHERE status='CANCELED') FROM reply_items`).Scan(&committed, &canceled); err != nil || committed != 1 || canceled != 2 {
		t.Fatal(committed, canceled, err)
	}
	f.noClaim()
}

func TestCatalogImportRetiresOldContextLease(t *testing.T) {
	f := autopilotTest(t)
	c := testCatalog()
	importTestCatalog(t, f, c)
	m := f.send("u")
	if _, err := f.db.Exec(f.ctx, `UPDATE conversations SET memory_opt_in=true,summary='旧人设摘要',summary_through_message_id=$1 WHERE id='c'`, m.ID); err != nil {
		t.Fatal(err)
	}
	var version int64
	if err := f.db.QueryRow(f.ctx, `SELECT settings_version FROM conversations WHERE id='c'`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if _, err := f.db.Exec(f.ctx, `INSERT INTO context_jobs(conversation_id,through_message_id,settings_version,status,claim_token,lease_until) VALUES('c',$1,$2,'RUNNING','old-context-lease',now()+interval '1 minute')`, m.ID, version); err != nil {
		t.Fatal(err)
	}
	c.Identities[0].Persona.SpeakingStyle = "表达直接，不频繁使用昵称"
	importTestCatalog(t, f, c)
	if err := f.repo.commitEnrichment(f.ctx, "c", m.ID, "old-context-lease", version, provider.Reply{Action: "SILENCE", Summary: "旧人设重新写入", MemoryProposals: []provider.MemoryProposal{{SourceMessageID: m.ID, Kind: "FACT", Content: "不应提交"}}}); err != nil {
		t.Fatal(err)
	}
	var summary, status string
	var count int
	var through *int64
	var claim *string
	if err := f.db.QueryRow(f.ctx, `SELECT summary,summary_through_message_id,(SELECT count(*) FROM memory_proposals) FROM conversations WHERE id='c'`).Scan(&summary, &through, &count); err != nil || summary != "" || through != nil || count != 0 {
		t.Fatal(summary, through, count, err)
	}
	if err := f.db.QueryRow(f.ctx, `SELECT status,claim_token FROM context_jobs WHERE conversation_id='c'`).Scan(&status, &claim); err != nil || status != "DONE" || claim != nil {
		t.Fatal("obsolete context job will retry", status, claim, err)
	}
}

func TestCatalogPagesFiltersSelectionAndPrivateFields(t *testing.T) {
	f := autopilotTest(t)
	c := testCatalog()
	for n := 0; n < 6; n++ {
		i := c.Identities[0]
		i.ID = "catalog_" + string(rune('a'+n))
		i.Name = "编辑" + string(rune('甲'+n))
		i.Age = 30 + n
		if n == 5 {
			i.Gender = "MALE"
		}
		c.Identities = append(c.Identities, i)
	}
	importTestCatalog(t, f, c)
	r := identity.Repository{DB: f.db}
	filters, err := identity.ParseFilters(url.Values{"occupationCode": {"editor"}, "pageSize": {"2"}})
	if err != nil {
		t.Fatal(err)
	}
	p, err := r.DiscoverPage(f.ctx, "operator", filters)
	if err != nil || p.Total != 6 || len(p.Items) != 2 || p.NextPage == nil || *p.NextPage != 2 {
		t.Fatal(p, err)
	}
	if p.Items[0].ID != "catalog_a" || p.Items[1].ID != "catalog_b" {
		t.Fatal("unstable ordering", p.Items)
	}
	filters.Page = 2
	p2, err := r.DiscoverPage(f.ctx, "operator", filters)
	if err != nil || p2.Items[0].ID != "catalog_c" {
		t.Fatal(p2, err)
	}
	filters.Page = 4
	last, err := r.DiscoverPage(f.ctx, "operator", filters)
	if err != nil || len(last.Items) != 0 || last.NextPage != nil || last.Total != 6 {
		t.Fatal(last, err)
	}
	filters.Page = 1
	filters.AgeMin = 32
	filters.AgeMax = 34
	options, err := r.InheritancePage(f.ctx, "stranger", filters)
	if err != nil || options.Total != 3 || options.AvailableTotal != 3 {
		t.Fatal(options, err)
	}
	filters.AgeMin = 18
	filters.AgeMax = 50
	filters.Q = "%"
	empty, err := r.DiscoverPage(f.ctx, "operator", filters)
	if err != nil || empty.Total != 0 {
		t.Fatal("wildcard search was not literal", empty, err)
	}
	state, err := r.InheritanceState(f.ctx, "stranger", false, "identity_linwan")
	if err != nil || len(state.Items) != 0 || state.Selected == nil || state.Selected.Available || state.Selected.Occupation != "编辑" {
		t.Fatal(state, err)
	}
	state, err = r.InheritanceState(f.ctx, "stranger", false, "catalog_f")
	if err != nil || state.Selected != nil {
		t.Fatal("opposite gender selected identity leaked", state, err)
	}
	raw, err := json.Marshal(p)
	if err != nil || strings.Contains(string(raw), "persona") || strings.Contains(string(raw), "speakingStyle") {
		t.Fatal("private persona in public page", string(raw), err)
	}
}

func TestCatalogImportConcurrentMatchCreation(t *testing.T) {
	f := autopilotTest(t)
	c := testCatalog()
	importTestCatalog(t, f, c)
	c.Identities[0].Persona.Goals = "编辑一本长篇小说"
	ctx, cancel := context.WithTimeout(f.ctx, 10*time.Second)
	defer cancel()
	var wg sync.WaitGroup
	wg.Add(2)
	start := make(chan struct{})
	var importErr, matchErr error
	var match matching.Match
	go func() { defer wg.Done(); <-start; _, importErr = f.repo.ImportCatalog(ctx, c, false) }()
	go func() {
		defer wg.Done()
		<-start
		match, matchErr = (matching.Repository{DB: f.db}).Create(ctx, "stranger", "identity_linwan")
	}()
	close(start)
	wg.Wait()
	if importErr != nil || matchErr != nil {
		t.Fatal(importErr, matchErr)
	}
	if match.Identity.Occupation != "编辑" {
		t.Fatal("new match did not load public profile", match)
	}
	i, err := (identity.Repository{DB: f.db}).Get(f.ctx, match.Identity.ID)
	if err != nil || i.Persona.Goals != "编辑一本长篇小说" {
		t.Fatal(i, err)
	}
}

func TestCatalogImportConcurrentInheritanceProtectsGender(t *testing.T) {
	f := autopilotTest(t)
	c := testCatalog()
	c.Identities[0].ID = "identity_suhe"
	c.Identities[0].Gender = "MALE"
	ctx, cancel := context.WithTimeout(f.ctx, 10*time.Second)
	defer cancel()
	var wg sync.WaitGroup
	wg.Add(2)
	start := make(chan struct{})
	var importErr, inheritErr error
	go func() { defer wg.Done(); <-start; _, importErr = f.repo.ImportCatalog(ctx, c, false) }()
	go func() {
		defer wg.Done()
		<-start
		inheritErr = f.repo.InheritIdentity(ctx, "stranger", "identity_suhe", f.service.Policies)
	}()
	close(start)
	wg.Wait()
	if importErr == nil && inheritErr == nil {
		t.Fatal("incompatible import and inheritance both succeeded")
	}
	if importErr != nil && inheritErr != nil {
		t.Fatal("neither concurrent operation could finish", importErr, inheritErr)
	}
	var mismatch bool
	if err := f.db.QueryRow(f.ctx, `SELECT EXISTS(SELECT 1 FROM identity_inheritances h JOIN identities i ON i.id=h.identity_id JOIN users u ON u.id=h.user_id WHERE i.gender<>u.gender)`).Scan(&mismatch); err != nil || mismatch {
		t.Fatal("concurrent import broke inherited gender", err)
	}
}

func TestCatalogImportConcurrentDeliveryRejectsStaleRemainder(t *testing.T) {
	f := autopilotTest(t)
	c := testCatalog()
	importTestCatalog(t, f, c)
	f.send("u")
	job := f.claim()
	if err := f.repo.SchedulePlan(f.ctx, job, plan(3), time.Now().Add(-time.Second)); err != nil {
		t.Fatal(err)
	}
	c.Identities[0].Persona.Goals = "校对长篇小说"
	ctx, cancel := context.WithTimeout(f.ctx, 10*time.Second)
	defer cancel()
	var wg sync.WaitGroup
	wg.Add(2)
	start := make(chan struct{})
	var importErr, deliveryErr error
	go func() { defer wg.Done(); <-start; _, importErr = f.repo.ImportCatalog(ctx, c, false) }()
	go func() { defer wg.Done(); <-start; _, deliveryErr = f.repo.Deliver(ctx) }()
	close(start)
	wg.Wait()
	if importErr != nil || deliveryErr != nil {
		t.Fatal(importErr, deliveryErr)
	}
	if delivered, err := f.repo.Deliver(f.ctx); err != nil || delivered {
		t.Fatal("old persona sent after import completed", err)
	}
	var pending int
	if err := f.db.QueryRow(f.ctx, `SELECT count(*) FROM reply_items WHERE status='PENDING'`).Scan(&pending); err != nil || pending != 0 {
		t.Fatal("stale batch survived import", pending, err)
	}
}

func TestCatalogImportPreservesConfirmedMemoriesAndUserScopedContext(t *testing.T) {
	f := autopilotTest(t)
	catalog := testCatalog()
	importTestCatalog(t, f, catalog)
	other, err := (matching.Repository{DB: f.db}).Create(f.ctx, "stranger", "identity_linwan")
	if err != nil {
		t.Fatal(err)
	}
	users := []struct {
		actor, conversation, content string
		memory                       Memory
	}{
		{actor: "u", conversation: "c", content: "用户甲喜欢猫，但不养宠物"},
		{actor: "stranger", conversation: other.ConversationID, content: "用户乙周六学习陶艺"},
	}
	for n := range users {
		u := &users[n]
		preferences := defaultPreferences()
		preferences.MemoryOptIn = true
		if err = f.repo.SavePreferences(f.ctx, u.conversation, "operator", preferences, false); err != nil {
			t.Fatal(err)
		}
		message, err := f.service.Send(f.ctx, u.actor, u.conversation, "confirmed-memory-source", u.content)
		if err != nil {
			t.Fatal(err)
		}
		// Confirm through the same owner-authorized repository operation used by
		// the memory API, rather than inserting a synthetic database memory row.
		if err = f.repo.SaveMemory(f.ctx, u.conversation, u.actor, Memory{Kind: "PREFERENCE", Content: u.content, SourceMessageID: message.ID}, false); err != nil {
			t.Fatal(err)
		}
		memories, err := f.repo.Memories(f.ctx, u.conversation, u.actor)
		if err != nil || len(memories) != 1 {
			t.Fatal(memories, err)
		}
		u.memory = memories[0]
		if n == 0 {
			// Retain a non-default version too, catching a delete/reinsert that
			// happens to preserve content but resets memory identity or version.
			u.memory.Content = "用户甲喜欢猫，但目前不养宠物"
			if err = f.repo.SaveMemory(f.ctx, u.conversation, u.actor, u.memory, false); err != nil {
				t.Fatal(err)
			}
			memories, err = f.repo.Memories(f.ctx, u.conversation, u.actor)
			if err != nil || len(memories) != 1 || memories[0].Version != 2 {
				t.Fatal(memories, err)
			}
			u.memory = memories[0]
		}
		if _, err = f.db.Exec(f.ctx, `UPDATE conversations SET summary='旧人设摘要',summary_through_message_id=$2 WHERE id=$1`, u.conversation, message.ID); err != nil {
			t.Fatal(err)
		}
	}
	previous, err := (identity.Repository{DB: f.db}).Get(f.ctx, "identity_linwan")
	if err != nil {
		t.Fatal(err)
	}
	catalog.Identities[0].Persona.Personality = "沉稳，喜欢坦率表达自己的看法"
	catalog.Identities[0].Persona.Goals = "为新作者编辑第一本散文集"
	result := importTestCatalog(t, f, catalog)
	if result.Updated != 1 || result.AffectedConversations != 2 {
		t.Fatal(result)
	}
	builder := aicontext.Builder{Identities: identity.Repository{DB: f.db}, Messages: f.service.Messages}
	for n, u := range users {
		memories, err := f.repo.Memories(f.ctx, u.conversation, u.actor)
		if err != nil || len(memories) != 1 || memories[0] != u.memory {
			t.Fatalf("%s confirmed memory changed during import: %+v %v", u.actor, memories, err)
		}
		conversation, err := f.service.Messages.Accessible(f.ctx, u.actor, u.conversation)
		if err != nil {
			t.Fatal(err)
		}
		request, err := builder.Build(f.ctx, conversation)
		if err != nil {
			t.Fatal(err)
		}
		var facts struct {
			Identity struct {
				ID, Occupation string
				Persona        identity.Persona
				PersonaVersion int64
			}
			Summary  string
			Memories []struct{ Kind, Content, Provenance string }
		}
		if err = json.Unmarshal([]byte(request.Messages[0].Content), &facts); err != nil {
			t.Fatal(err)
		}
		if facts.Identity.ID != "identity_linwan" || facts.Identity.Occupation != "编辑" || facts.Identity.PersonaVersion != previous.PersonaVersion+1 || facts.Identity.Persona.Personality != catalog.Identities[0].Persona.Personality || facts.Identity.Persona.Goals != catalog.Identities[0].Persona.Goals {
			t.Fatalf("%s did not receive current shared persona: %+v", u.actor, facts.Identity)
		}
		if facts.Summary != "" || len(facts.Memories) != 1 || facts.Memories[0].Content != u.memory.Content || facts.Memories[0].Kind != "PREFERENCE" || facts.Memories[0].Provenance != "USER_ASSERTED" {
			t.Fatalf("%s context lost confirmed memory or retained stale summary: %+v", u.actor, facts)
		}
		encoded, err := json.Marshal(request)
		if err != nil || strings.Contains(string(encoded), users[1-n].memory.Content) || strings.Contains(string(encoded), users[1-n].content) || strings.Contains(string(encoded), "旧人设摘要") {
			t.Fatalf("%s request mixed another user's facts or stale summary", u.actor)
		}
		var summary string
		var through *int64
		if err = f.db.QueryRow(f.ctx, `SELECT summary,summary_through_message_id FROM conversations WHERE id=$1`, u.conversation).Scan(&summary, &through); err != nil || summary != "" || through != nil {
			t.Fatal("derived summary was not cleared in storage", summary, through, err)
		}
	}
}
