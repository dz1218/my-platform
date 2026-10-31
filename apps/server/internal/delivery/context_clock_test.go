package delivery

import (
	aicontext "companion/server/internal/ai/context"
	"companion/server/internal/conversation"
	"companion/server/internal/identity"
	"context"
	"encoding/json"
	"testing"
	"time"
)

func TestContextClockWithoutMemoryOrProactiveAuthorization(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	builder := aicontext.Builder{Messages: conversation.Repository{DB: db}, Identities: identity.Repository{DB: db}}
	// Existing relationships can predate preferences; the LEFT JOIN must keep
	// their identity context and current date even with memory disabled.
	if _, err := db.Exec(ctx, `DELETE FROM proactive_preferences WHERE conversation_id='c'; UPDATE conversations SET memory_opt_in=false WHERE id='c'`); err != nil {
		t.Fatal(err)
	}
	for _, zone := range []string{"Asia/Shanghai", "America/Los_Angeles"} {
		if zone != "Asia/Shanghai" {
			if _, err := db.Exec(ctx, `INSERT INTO proactive_preferences(conversation_id,timezone) VALUES('c',$1)`, zone); err != nil {
				t.Fatal(err)
			}
		}
		started := time.Now()
		request, err := builder.Build(ctx, conversation.Conversation{ID: "c", UserID: "u", IdentityID: "identity_linwan"})
		if err != nil {
			t.Fatal(err)
		}
		var facts struct {
			Clock struct {
				Date     string `json:"date"`
				TimeZone string `json:"timeZone"`
			} `json:"clock"`
			Memories []any `json:"memories"`
		}
		if err := json.Unmarshal([]byte(request.Messages[0].Content), &facts); err != nil {
			t.Fatal(err)
		}
		location, _ := time.LoadLocation(zone)
		if facts.Clock.TimeZone != zone || (facts.Clock.Date != started.In(location).Format("2006-01-02") && facts.Clock.Date != time.Now().In(location).Format("2006-01-02")) {
			t.Fatalf("missing or incorrect conversation clock: %+v", facts.Clock)
		}
		if len(facts.Memories) != 0 {
			t.Fatal("clock must not enable long-term memory")
		}
	}
}
