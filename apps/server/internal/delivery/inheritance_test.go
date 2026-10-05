package delivery

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"companion/server/internal/auth"
	"companion/server/internal/behavior"
	"companion/server/internal/conversation"
	"companion/server/internal/identity"
	"companion/server/internal/matching"
	"companion/server/pkg/response"
	"github.com/jackc/pgx/v5"
)

func inheritanceTest(t *testing.T) *autopilotFixture {
	t.Helper()
	db := testDB(t)
	ctx := context.Background()
	if _, err := db.Exec(ctx, `INSERT INTO users(id,email,password_hash,name) VALUES('operator','operator@example.test','unused','Operator'),('stranger','stranger@example.test','unused','Stranger'); INSERT INTO conversation_takeovers(conversation_id,operator_id) VALUES('c','operator')`); err != nil {
		t.Fatal(err)
	}
	p := behavior.Policy{Version: "inheritance-test", DebounceSeconds: 1, MaxWaitSeconds: 10, MaxAttempts: 3, RetrySeconds: 1}
	repo := Repository{DB: db}
	return &autopilotFixture{t: t, ctx: ctx, db: db, repo: repo, policy: p, service: Service{Repo: repo, Messages: conversation.Repository{DB: db}, Policies: behavior.Catalog{Default: p}}}
}

func inheritanceCode(t *testing.T, err error, code string) {
	t.Helper()
	var e *response.Error
	if !errors.As(err, &e) || e.Code != code {
		t.Fatalf("want %s, got %v", code, err)
	}
}

func TestInheritanceOwnAccountAndAllIdentityChats(t *testing.T) {
	f := inheritanceTest(t)
	if _, err := f.db.Exec(f.ctx, `UPDATE users SET gender='FEMALE'`); err != nil {
		t.Fatal(err)
	}
	if _, err := f.repo.Settings(f.ctx, "c", "operator"); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("legacy assignment still grants access: %v", err)
	}
	if items, err := f.repo.Assignments(f.ctx, "operator"); err != nil || len(items) != 0 {
		t.Fatalf("legacy assignment listed: %+v %v", items, err)
	}
	matches := matching.Repository{DB: f.db}
	ownBefore, err := matches.Create(f.ctx, "stranger", "identity_linwan")
	if err != nil {
		t.Fatal(err)
	}
	cached, err := f.service.Messages.Accessible(f.ctx, "stranger", ownBefore.ConversationID)
	if err != nil {
		t.Fatal(err)
	}
	f.send("u")
	oldJob := f.claim()
	if err = f.repo.InheritIdentity(f.ctx, "stranger", "identity_linwan", f.service.Policies); err != nil {
		t.Fatal(err)
	}
	if current, err := f.repo.Current(f.ctx, oldJob); err != nil || current {
		t.Fatalf("old generation survived claim: %v %v", current, err)
	}
	settings, err := f.repo.Settings(f.ctx, "c", "stranger")
	if err != nil || !settings.CanManage || settings.OwnerType != "HUMAN" || settings.Mode != "TIMEOUT" || settings.DelaySeconds != 120 {
		t.Fatalf("new owner settings: %+v %v", settings, err)
	}
	if _, err = f.service.Send(f.ctx, "stranger", "c", "inherited-human-send", "我在这里"); err != nil {
		t.Fatal(err)
	}
	history, err := f.service.Messages.History(f.ctx, conversation.Conversation{ID: "c", UserID: "u", IdentityID: "identity_linwan"}, 0, 50)
	if err != nil {
		t.Fatal(err)
	}
	last := history.Items[len(history.Items)-1]
	if last.Source != "HUMAN" || last.Sender.ID != "identity_linwan" {
		t.Fatalf("wrong inherited sender: %+v", last)
	}
	if _, err = f.service.Messages.Accessible(f.ctx, "operator", "c"); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("stale legacy assignment access: %v", err)
	}
	if _, err = f.repo.Configure(f.ctx, "c", "operator", "NEVER", 120, "", f.policy); err == nil {
		t.Fatal("stale operator configured claimed identity")
	}
	if _, err = f.repo.Preferences(f.ctx, "c", "operator"); err == nil {
		t.Fatal("stale operator read preferences")
	}
	p, err := f.repo.Preferences(f.ctx, "c", "stranger")
	if err != nil {
		t.Fatal(err)
	}
	if err = f.repo.SavePreferences(f.ctx, "c", "stranger", p, false); err != nil {
		t.Fatal(err)
	}
	if err = f.repo.SaveDailyState(f.ctx, "c", "stranger", DailyState{Fictional: true, CurrentActivity: "整理书架", Mood: "平静", ExpiresAt: time.Now().Add(time.Hour)}); err != nil {
		t.Fatal(err)
	}
	if err = f.repo.SaveDailyState(f.ctx, "c", "operator", DailyState{Fictional: true, CurrentActivity: "旧接管者", ExpiresAt: time.Now().Add(time.Hour)}); err == nil {
		t.Fatal("stale operator changed shared daily state")
	}
	if err = f.repo.AssignOperator(f.ctx, "c", "operator", "operator", f.service.Policies); err == nil {
		t.Fatal("admin override bypassed permanent owner")
	}
	// Existing self-chat is hidden, and cached authorization cannot bypass this.
	if _, err = matches.Create(f.ctx, "stranger", "identity_linwan"); err == nil {
		t.Fatal("matched own identity")
	}
	if _, err = f.service.Messages.Accessible(f.ctx, "stranger", ownBefore.ConversationID); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("old self chat remains accessible: %v", err)
	}
	if _, err = f.repo.SendAs(f.ctx, cached, "stranger", "stale-self-send", "self", f.policy); err == nil {
		t.Fatal("stale self send accepted")
	}
	ownChats, err := matches.List(f.ctx, "stranger")
	if err != nil || len(ownChats) != 0 {
		t.Fatalf("self match listed: %+v %v", ownChats, err)
	}
	assignments, err := f.repo.Assignments(f.ctx, "stranger")
	if err != nil || len(assignments) != 1 || assignments[0].ConversationID != "c" {
		t.Fatalf("assignments included self: %+v %v", assignments, err)
	}
	// Later matches arrive under the inherited identity automatically.
	future, err := matches.Create(f.ctx, "operator", "identity_linwan")
	if err != nil {
		t.Fatal(err)
	}
	futureSettings, err := f.repo.Settings(f.ctx, future.ConversationID, "stranger")
	if err != nil || !futureSettings.CanManage || futureSettings.OwnerType != "HUMAN" {
		t.Fatalf("future chat ownership: %+v %v", futureSettings, err)
	}
	if _, err = f.service.Send(f.ctx, "stranger", future.ConversationID, "future-human-send", "你好"); err != nil {
		t.Fatal(err)
	}
	// The same login retains its own participant identity with other companions.
	personal, err := matches.Create(f.ctx, "stranger", "identity_suhe")
	if err != nil {
		t.Fatal(err)
	}
	message, err := f.service.Send(f.ctx, "stranger", personal.ConversationID, "own-account-send", "你好苏禾")
	if err != nil || message.Source != "USER" || message.Sender.ID != "stranger" {
		t.Fatalf("own account send: %+v %v", message, err)
	}
	personalSettings, err := f.repo.Settings(f.ctx, personal.ConversationID, "stranger")
	if err != nil || personalSettings.CanManage {
		t.Fatalf("own account gained companion settings: %+v %v", personalSettings, err)
	}
	if _, err = f.repo.Configure(f.ctx, personal.ConversationID, "stranger", "NEVER", 120, "", f.policy); err == nil {
		t.Fatal("owner managed unrelated identity")
	}
	user, err := (auth.Repository{DB: f.db}).ByID(f.ctx, "stranger")
	if err != nil || user.InheritedIdentity == nil || user.InheritedIdentity.ID != "identity_linwan" || !user.OnboardingCompleted {
		t.Fatalf("me state: %+v %v", user, err)
	}
	for _, sql := range []string{`DELETE FROM identity_inheritances WHERE user_id='stranger'`, `UPDATE identity_inheritances SET user_id='operator' WHERE user_id='stranger'`} {
		if _, err = f.db.Exec(f.ctx, sql); err == nil {
			t.Fatal("permanent claim was changed")
		}
	}
}

func TestInheritanceGenderAndOnboarding(t *testing.T) {
	f := inheritanceTest(t)
	ids := identity.Repository{DB: f.db}
	state, err := ids.Inheritance(f.ctx, "u")
	if err != nil || state.Gender != nil || state.OnboardingCompleted || state.Identity != nil || len(state.Items) != 3 {
		t.Fatalf("legacy state: %+v %v", state, err)
	}
	for _, item := range state.Items {
		if item.Available {
			t.Fatal("missing gender allowed a claim")
		}
	}
	inheritanceCode(t, f.repo.InheritIdentity(f.ctx, "u", "identity_linwan", f.service.Policies), "invalid_request")
	if err = ids.SkipInheritance(f.ctx, "u"); err != nil {
		t.Fatal(err)
	}
	if err = ids.SetGender(f.ctx, "u", "MALE"); err != nil {
		t.Fatal(err)
	}
	inheritanceCode(t, f.repo.InheritIdentity(f.ctx, "u", "identity_linwan", f.service.Policies), "gender_mismatch")
	if _, err = f.db.Exec(f.ctx, `INSERT INTO identities(id,name,age,gender) VALUES('male_identity','沈舟',27,'MALE')`); err != nil {
		t.Fatal(err)
	}
	if err = ids.SetGender(f.ctx, "operator", "FEMALE"); err != nil {
		t.Fatal(err)
	}
	inheritanceCode(t, f.repo.InheritIdentity(f.ctx, "operator", "male_identity", f.service.Policies), "gender_mismatch")
	if err = f.repo.InheritIdentity(f.ctx, "u", "male_identity", f.service.Policies); err != nil {
		t.Fatal(err)
	}
	if err = f.repo.InheritIdentity(f.ctx, "u", "male_identity", f.service.Policies); err != nil {
		t.Fatal("repeat same claim should be idempotent", err)
	}
	inheritanceCode(t, f.repo.InheritIdentity(f.ctx, "u", "identity_suhe", f.service.Policies), "already_inherited")
	inheritanceCode(t, ids.SetGender(f.ctx, "u", "FEMALE"), "gender_set")
	state, err = ids.Inheritance(f.ctx, "u")
	if err != nil || !state.OnboardingCompleted || state.Identity == nil || state.Identity.ID != "male_identity" {
		t.Fatalf("claimed state: %+v %v", state, err)
	}
	service := auth.Service{Repo: auth.Repository{DB: f.db}}
	if _, err = service.Register(f.ctx, "new@example.test", "New", "password123", true, ""); err == nil {
		t.Fatal("registration accepted missing gender")
	}
	created, err := service.Register(f.ctx, "new@example.test", "New", "password123", true, "FEMALE")
	if err != nil || created.Gender == nil || *created.Gender != "FEMALE" || created.OnboardingCompleted || created.InheritedIdentity != nil {
		t.Fatalf("registration state: %+v %v", created, err)
	}
}

func TestInheritanceConcurrentClaims(t *testing.T) {
	for _, sameUser := range []bool{false, true} {
		t.Run(map[bool]string{false: "one_identity", true: "one_account"}[sameUser], func(t *testing.T) {
			f := inheritanceTest(t)
			if _, err := f.db.Exec(f.ctx, `UPDATE users SET gender='FEMALE'`); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(f.ctx, 10*time.Second)
			defer cancel()
			start := make(chan struct{})
			results := make(chan error, 2)
			for n := 0; n < 2; n++ {
				go func(n int) {
					user, id := "operator", "identity_linwan"
					if n == 1 {
						if sameUser {
							id = "identity_suhe"
						} else {
							user = "stranger"
						}
					}
					<-start
					results <- f.repo.InheritIdentity(ctx, user, id, f.service.Policies)
				}(n)
			}
			close(start)
			success := 0
			for n := 0; n < 2; n++ {
				err := <-results
				if err == nil {
					success++
				} else {
					code := "identity_unavailable"
					if sameUser {
						code = "already_inherited"
					}
					inheritanceCode(t, err, code)
				}
			}
			if success != 1 {
				t.Fatalf("got %d winners", success)
			}
			var count int
			if err := f.db.QueryRow(f.ctx, `SELECT count(*) FROM identity_inheritances`).Scan(&count); err != nil || count != 1 {
				t.Fatalf("claims %d %v", count, err)
			}
		})
	}
}

func TestInheritanceConcurrentMatchCreation(t *testing.T) {
	f := inheritanceTest(t)
	if _, err := f.db.Exec(f.ctx, `UPDATE users SET gender='FEMALE'`); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(f.ctx, 10*time.Second)
	defer cancel()
	matches := matching.Repository{DB: f.db}
	var wg sync.WaitGroup
	wg.Add(2)
	var claimErr, matchErr error
	var m matching.Match
	start := make(chan struct{})
	go func() {
		defer wg.Done()
		<-start
		claimErr = f.repo.InheritIdentity(ctx, "stranger", "identity_suhe", behavior.Catalog{Default: f.policy})
	}()
	go func() { defer wg.Done(); <-start; m, matchErr = matches.Create(ctx, "operator", "identity_suhe") }()
	close(start)
	wg.Wait()
	if claimErr != nil || matchErr != nil {
		t.Fatalf("claim/match race: %v %v", claimErr, matchErr)
	}
	settings, err := f.repo.Settings(f.ctx, m.ConversationID, "stranger")
	if err != nil || !settings.CanManage || settings.OwnerType != "HUMAN" || settings.Mode != "TIMEOUT" {
		t.Fatalf("race lost ownership: %+v %v", settings, err)
	}
}
