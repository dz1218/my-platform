package behavior

import (
	"encoding/json"
	"testing"
)

func TestExecutionLimits(t *testing.T) {
	c, err := Load("../../config/behavior.json")
	if err != nil {
		t.Fatal(err)
	}
	p := c.For("identity_linwan")
	if p != c.For("missing") {
		t.Fatal("unexpected per-character timing rules")
	}
	if p.MaxWaitSeconds != 10 || p.DebounceSeconds != 1 || p.ReplyPacing != "typing" {
		t.Fatal("unexpected execution limits")
	}
	p.MaxWaitSeconds = 60
	if p.Validate() == nil {
		t.Fatal("unbounded wait accepted")
	}
}

func TestPacingSnapshotCompatibility(t *testing.T) {
	c, err := Load("../../config/behavior.json")
	if err != nil {
		t.Fatal(err)
	}
	p := c.Default
	b, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	var copy Policy
	if err = json.Unmarshal(b, &copy); err != nil || copy != p {
		t.Fatal(copy, err)
	}
	copy.ReplyPacing = ""
	if err = copy.Validate(); err != nil {
		t.Fatal("legacy pacing rejected", err)
	}
	copy.ReplyPacing = "random"
	if copy.Validate() == nil {
		t.Fatal("invalid pacing accepted")
	}
}
