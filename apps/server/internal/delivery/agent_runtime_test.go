package delivery

import (
	aicontext "companion/server/internal/ai/context"
	"companion/server/internal/ai/provider"
	"companion/server/internal/conversation"
	"companion/server/internal/identity"
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
)

func enableMemory(t *testing.T, f *autopilotFixture, id, actor string) {
	t.Helper()
	p, err := f.repo.MemoryPreferences(f.ctx, id, actor)
	if err != nil {
		t.Fatal(err)
	}
	p.Enabled = true
	p.ConsentVersion = 2
	if _, err = f.repo.SetMemoryPreferences(f.ctx, id, actor, p); err != nil {
		t.Fatal(err)
	}
}
func executionFor(r *provider.RunContext) *provider.Execution {
	if r == nil {
		return nil
	}
	return &provider.Execution{RunID: r.ID, InputHash: r.InputHash, MemoryRevision: r.MemoryRevision, GraphVersion: "test", ModelCalls: 1}
}

func TestEnrichmentBudgetKeepsContiguousPrefix(t *testing.T) {
	request := provider.ChatRequest{Kind: "CONTEXT_UPDATE", Messages: []provider.Message{{Role: "system", Content: `{"identity":{"name":"角色"}}`}}}
	for i := 1; i <= 30; i++ {
		request.Messages = append(request.Messages, provider.Message{ID: fmt.Sprint(i), Role: "user", Content: strings.Repeat("\x01", 1000)})
	}
	bounded, err := boundRunInput(request)
	if err != nil {
		t.Fatal(err)
	}
	if len(bounded.Messages) <= 1 || len(bounded.Messages) >= len(request.Messages) {
		t.Fatal("fixture did not exercise byte bound")
	}
	for i, m := range bounded.Messages[1:] {
		if m.ID != fmt.Sprint(i+1) {
			t.Fatal("cursor skipped earlier input", m.ID)
		}
	}
}

func TestAgentMemoryPagination(t *testing.T) {
	f := autopilotTest(t)
	enableMemory(t, f, "c", "u")
	for i := 0; i < 55; i++ {
		m := f.send("u")
		if err := f.repo.SaveMemory(f.ctx, "c", "u", Memory{Kind: "FACT", Content: fmt.Sprintf("记录%d", i), SourceMessageID: m.ID}, false); err != nil {
			t.Fatal(err)
		}
	}
	first, err := f.repo.MemoryCollection(f.ctx, "c", "u", 0)
	if err != nil || len(first.Items) != 50 || first.NextCursor == nil {
		t.Fatal(len(first.Items), first.NextCursor, err)
	}
	second, err := f.repo.MemoryCollection(f.ctx, "c", "u", *first.NextCursor)
	if err != nil || len(second.Items) != 5 || second.NextCursor != nil {
		t.Fatal(len(second.Items), second.NextCursor, err)
	}
	seen := map[string]bool{}
	for _, m := range first.Items {
		seen[m.ID] = true
	}
	for _, m := range second.Items {
		if seen[m.ID] {
			t.Fatal("page repeated memory")
		}
	}
	if _, err = f.repo.MemoryCollection(f.ctx, "c", "stranger", 50); err == nil {
		t.Fatal("paging bypassed memory ownership")
	}
}
func boundRequest(t *testing.T, f *autopilotFixture) (Job, provider.ChatRequest) {
	t.Helper()
	j := f.claim()
	b := aicontext.Builder{Messages: f.service.Messages, Identities: identity.Repository{DB: f.db}}
	req, err := b.Build(f.ctx, j.Conversation)
	if err != nil {
		t.Fatal(err)
	}
	req.Kind = "TURN_REPLY"
	req, err = f.repo.BindRun(f.ctx, req, "c", "TURN_REPLY", j.ClaimToken, j.TriggerID, j.Version)
	if err != nil {
		t.Fatal(err)
	}
	j.Run = req.Run
	return j, req
}

func TestAgentMemoryOwnershipAndRevocation(t *testing.T) {
	f := autopilotTest(t)
	if _, err := f.repo.SetMemoryPreferences(f.ctx, "c", "operator", MemoryPreferences{Enabled: true, Version: 1, ConsentVersion: 2}); err == nil {
		t.Fatal("operator granted participant consent")
	}
	enableMemory(t, f, "c", "u")
	f.send("u")
	j, req := boundRequest(t, f)
	if err := f.repo.ValidateRun(f.ctx, *req.Run); err != nil {
		t.Fatal(err)
	}
	forged := *req.Run
	forged.UserID = "stranger"
	if err := f.repo.ValidateRun(f.ctx, forged); err == nil {
		t.Fatal("cross-user run accepted")
	}
	p, _ := f.repo.MemoryPreferences(f.ctx, "c", "u")
	p.Enabled = false
	if _, err := f.repo.SetMemoryPreferences(f.ctx, "c", "u", p); err != nil {
		t.Fatal(err)
	}
	if err := f.repo.ValidateRun(f.ctx, *req.Run); err == nil {
		t.Fatal("revoked run survived")
	}
	if err := f.repo.SchedulePlan(f.ctx, j, provider.Reply{Action: "REPLY", Messages: []provider.PlanItem{{ClientItemKey: "1", Content: "stale"}}, Execution: executionFor(req.Run)}, time.Now()); err != nil {
		t.Fatal(err)
	}
	f.noDelivery()
}

func TestAgentHybridRetrievalAndForgetSource(t *testing.T) {
	f := autopilotTest(t)
	enableMemory(t, f, "c", "u")
	m, err := f.service.Send(f.ctx, "u", "c", "city-request", "我住在杭州")
	if err != nil {
		t.Fatal(err)
	}
	if err = f.repo.SaveMemory(f.ctx, "c", "u", Memory{Kind: "FACT", Content: "我住在杭州", SourceMessageID: m.ID}, false); err != nil {
		t.Fatal(err)
	}
	if err = f.repo.SyncDocuments(f.ctx); err != nil {
		t.Fatal(err)
	}
	// A vector query exercises pgvector even with a different lexical query.
	vector := "[1" + strings.Repeat(",0", 1023) + "]"
	if _, err = f.db.Exec(f.ctx, `UPDATE agent_documents SET embedding=$1::public.vector,embedding_model='fixture',embedding_hash=content_hash WHERE source_kind='memory'`, vector); err != nil {
		t.Fatal(err)
	}
	_, req := boundRequest(t, f)
	v := make([]float64, 1024)
	v[0] = 1
	hits, err := f.repo.SearchEvidence(f.ctx, *req.Run, "住在哪个城市", v, "fixture")
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, h := range hits {
		if h.Kind == "memory" && strings.Contains(h.Content, "杭州") {
			found = true
		}
	}
	if !found {
		t.Fatal("semantic recall missed memory", hits)
	}
	items, _ := f.repo.Memories(f.ctx, "c", "u")
	if err = f.repo.SaveMemory(f.ctx, "c", "u", items[0], true); err != nil {
		t.Fatal(err)
	}
	if _, err = f.repo.SearchEvidence(f.ctx, *req.Run, "杭州", nil, ""); err == nil {
		t.Fatal("old run retrieved deleted memory")
	}
	if err = f.repo.SyncDocuments(f.ctx); err != nil {
		t.Fatal(err)
	}
	var n int
	if err = f.db.QueryRow(f.ctx, `SELECT count(*) FROM agent_documents WHERE source_kind IN ('memory','message')`).Scan(&n); err != nil || n != 0 {
		t.Fatal("forgotten source reindexed", n, err)
	}
	b := aicontext.Builder{Messages: f.service.Messages, Identities: identity.Repository{DB: f.db}}
	request, err := b.Build(f.ctx, conversation.Conversation{ID: "c", UserID: "u", IdentityID: "identity_linwan"})
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range request.Messages {
		if strings.Contains(m.Content, "我住在杭州") {
			t.Fatal("forgotten source restored in recent context")
		}
	}
}

func TestAgentMemoryCandidatesAreConservative(t *testing.T) {
	f := autopilotTest(t)
	enableMemory(t, f, "c", "u")
	cases := []struct {
		text, key, assertion string
		automatic            bool
	}{
		{"我住在杭州", "city", "ASSERTION", true}, {"我住在上海", "city", "ASSERTION", false},
		{"如果我住在成都就好了", "city", "ASSERTION", false}, {"我的验证码是123456", "other", "ASSERTION", false},
		{"我被诊断为抑郁症", "other", "ASSERTION", false},
		{"我朋友住在杭州", "city", "ASSERTION", false},
		{"小王说我住在杭州", "city", "ASSERTION", false},
		{"我明天搬到杭州", "city", "PLAN", false},
	}
	for i, c := range cases {
		m, err := f.service.Send(f.ctx, "u", "c", c.text, c.text)
		if err != nil {
			t.Fatal(err)
		}
		tx, err := f.db.Begin(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		err = commitMemoryCandidate(f.ctx, tx, "c", m.ID, provider.MemoryProposal{SourceMessageID: m.ID, Kind: "FACT", Content: c.text, SourceQuote: c.text, Assertion: c.assertion, FactKey: c.key})
		if err != nil {
			tx.Rollback(f.ctx)
			t.Fatal(err)
		}
		if err = tx.Commit(f.ctx); err != nil {
			t.Fatal(err)
		}
		var count int
		if err = f.db.QueryRow(f.ctx, `SELECT count(*) FROM conversation_memories WHERE source_message_id=$1::bigint`, m.ID).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if (count == 1) != c.automatic {
			t.Fatalf("case %d auto=%d", i, count)
		}
	}
	var secrets int
	if err := f.db.QueryRow(f.ctx, `SELECT count(*) FROM memory_proposals WHERE content LIKE '%123456%'`).Scan(&secrets); err != nil || secrets != 0 {
		t.Fatal("credential persisted", err)
	}
}

func TestAgentRetrievalIsolationAndChineseRecall(t *testing.T) {
	f := autopilotTest(t)
	enableMemory(t, f, "c", "u")
	_, err := f.db.Exec(f.ctx, `INSERT INTO matches(id,user_id,identity_id) VALUES('mb','stranger','identity_linwan');
 INSERT INTO conversations(id,match_id,user_id,identity_id,memory_opt_in,memory_consent_version) VALUES('cb','mb','stranger','identity_linwan',true,2);
 INSERT INTO matches(id,user_id,identity_id) SELECT 'mc','u',id FROM identities WHERE id<>'identity_linwan' LIMIT 1;
 INSERT INTO conversations(id,match_id,user_id,identity_id,memory_opt_in,memory_consent_version) SELECT 'cc','mc','u',identity_id,true,2 FROM matches WHERE id='mc'`)
	if err != nil {
		t.Fatal(err)
	}
	for _, cid := range []string{"cb", "cc"} {
		tx, e := f.db.Begin(f.ctx)
		if e != nil {
			t.Fatal(e)
		}
		var iid string
		var version int64
		e = tx.QueryRow(f.ctx, `SELECT i.id,i.persona_version FROM identities i JOIN conversations c ON c.identity_id=i.id WHERE c.id=$1`, cid).Scan(&iid, &version)
		if e == nil {
			e = putDocument(f.ctx, tx, cid, "identity", iid, version, "秘密代号：其他用户或角色")
		}
		if e != nil {
			tx.Rollback(f.ctx)
			t.Fatal(e)
		}
		if e = tx.Commit(f.ctx); e != nil {
			t.Fatal(e)
		}
	}
	terms := []string{"陈嘉宁", "杭州", "西湖", "周六", "11月3日", "咖啡", "芒果", "成都", "骑行", "图书馆"}
	for i, term := range terms {
		if _, err = f.service.Send(f.ctx, "u", "c", fmt.Sprintf("recall-%03d", i), "我们说过的词是"+term); err != nil {
			t.Fatal(err)
		}
	}
	// Round-robin maintenance may visit the two other relationships first.
	for i := 0; i < 3; i++ {
		if err = f.repo.SyncDocuments(f.ctx); err != nil {
			t.Fatal(err)
		}
	}
	_, req := boundRequest(t, f)
	found := 0
	for _, term := range terms {
		hits, e := f.repo.SearchEvidence(f.ctx, *req.Run, term, nil, "")
		if e != nil {
			t.Fatal(e)
		}
		for _, hit := range hits {
			if strings.Contains(hit.Content, term) {
				found++
				break
			}
		}
	}
	if found != len(terms) {
		t.Fatalf("Chinese lexical Recall@6 = %d/%d", found, len(terms))
	}
	hits, err := f.repo.SearchEvidence(f.ctx, *req.Run, "秘密代号", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, hit := range hits {
		if strings.Contains(hit.Content, "其他用户或角色") {
			t.Fatal("cross-relationship retrieval")
		}
	}
	forged := *req.Run
	forged.ConversationID = "cb"
	if _, err = f.repo.SearchEvidence(f.ctx, forged, "秘密代号", nil, ""); err == nil {
		t.Fatal("forged scope accepted")
	}
	if err = f.repo.ObserveAgent(f.ctx); err != nil {
		t.Fatal(err)
	}
}

func TestAgentRejectsExpiredEvidenceAtFinalDelivery(t *testing.T) {
	f := autopilotTest(t)
	enableMemory(t, f, "c", "u")
	m := f.send("u")
	if err := f.repo.SaveMemory(f.ctx, "c", "u", Memory{Kind: "FACT", Content: "我住在杭州", SourceMessageID: m.ID}, false); err != nil {
		t.Fatal(err)
	}
	if err := f.repo.SyncDocuments(f.ctx); err != nil {
		t.Fatal(err)
	}
	j, req := boundRequest(t, f)
	hits, err := f.repo.SearchEvidence(f.ctx, *req.Run, "杭州", nil, "")
	if err != nil || len(hits) == 0 {
		t.Fatal(hits, err)
	}
	e := executionFor(req.Run)
	e.Evidence = hits
	if err = f.repo.SchedulePlan(f.ctx, j, provider.Reply{Action: "REPLY", PromptVersion: "test", Messages: []provider.PlanItem{{ClientItemKey: "1", Content: "记得杭州"}}, Execution: e}, time.Now().Add(-time.Second)); err != nil {
		t.Fatal(err)
	}
	if _, err = f.db.Exec(f.ctx, `UPDATE conversation_memories SET valid_until=now()-interval '1 second'`); err != nil {
		t.Fatal(err)
	}
	f.noDelivery()
}

type indexTestModel struct {
	embed func(context.Context, []string) (provider.EmbeddingResult, error)
}

func (m indexTestModel) Generate(context.Context, provider.ChatRequest) (provider.Reply, error) {
	return provider.Reply{}, errors.New("unexpected generation")
}
func (m indexTestModel) Embed(ctx context.Context, texts []string) (provider.EmbeddingResult, error) {
	return m.embed(ctx, texts)
}
func (m indexTestModel) PurgeCheckpoints(context.Context, string, int64) error { return nil }

func TestAgentIndexFailureAndStaleWrite(t *testing.T) {
	f := autopilotTest(t)
	enableMemory(t, f, "c", "u")
	f.send("u")
	w := Worker{Repo: f.repo, Model: indexTestModel{embed: func(context.Context, []string) (provider.EmbeddingResult, error) {
		return provider.EmbeddingResult{}, context.DeadlineExceeded
	}}}
	if err := w.index(f.ctx); err != nil {
		t.Fatal(err)
	}
	var attempts int
	var state string
	if err := f.db.QueryRow(f.ctx, `SELECT attempts,status FROM agent_index_jobs WHERE attempts>0`).Scan(&attempts, &state); err != nil || attempts != 1 || state != "PENDING" {
		t.Fatal(attempts, state, err)
	}
	w.Model = indexTestModel{embed: func(context.Context, []string) (provider.EmbeddingResult, error) {
		p, err := f.repo.MemoryPreferences(f.ctx, "c", "u")
		if err != nil {
			return provider.EmbeddingResult{}, err
		}
		p.Enabled = false
		if _, err = f.repo.SetMemoryPreferences(f.ctx, "c", "u", p); err != nil {
			return provider.EmbeddingResult{}, err
		}
		vector := make([]float64, 1024)
		vector[0] = 1
		return provider.EmbeddingResult{Model: "fixture", Vectors: [][]float64{vector}}, nil
	}}
	if err := w.index(f.ctx); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := f.db.QueryRow(f.ctx, `SELECT count(*) FROM agent_documents`).Scan(&count); err != nil || count != 0 {
		t.Fatal("stale embedding reinserted", count, err)
	}
}

func TestAgentClearAndIncrementalContext(t *testing.T) {
	f := autopilotTest(t)
	enableMemory(t, f, "c", "u")
	for i := 0; i < 65; i++ {
		f.send("u")
	}
	if err := f.repo.SchedulePlan(f.ctx, f.claim(), provider.Reply{Action: "SILENCE"}, time.Now()); err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	w := Worker{Repo: f.repo, Builder: aicontext.Builder{Messages: f.service.Messages, Identities: identity.Repository{DB: f.db}}, Model: contextModel(func(_ context.Context, r provider.ChatRequest) (provider.Reply, error) {
		for _, m := range r.Messages[1:] {
			if seen[m.ID] {
				t.Error("message processed twice")
			}
			seen[m.ID] = true
		}
		return provider.Reply{Action: "SILENCE", Execution: executionFor(r.Run)}, nil
	})}
	for i := 0; i < 3; i++ {
		if _, err := f.db.Exec(f.ctx, `UPDATE context_jobs SET due_at=now()`); err != nil {
			t.Fatal(err)
		}
		if err := w.enrich(f.ctx); err != nil {
			t.Fatal(err)
		}
	}
	if len(seen) != 65 {
		t.Fatal("incremental cursor skipped messages", len(seen))
	}
	p, _ := f.repo.MemoryPreferences(f.ctx, "c", "u")
	if err := f.repo.ClearMemories(f.ctx, "c", "u", p.Version); err != nil {
		t.Fatal(err)
	}
	if err := f.repo.SyncDocuments(f.ctx); err != nil {
		t.Fatal(err)
	}
	var count int
	f.db.QueryRow(f.ctx, `SELECT count(*) FROM agent_documents WHERE source_kind='message'`).Scan(&count)
	if count != 0 {
		t.Fatal("clear reindexed original history")
	}
}
