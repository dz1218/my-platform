package behavior

import "testing"

func TestExecutionLimits(t *testing.T) {
	c, err := Load("../../config/behavior.json")
	if err != nil {
		t.Fatal(err)
	}
	p := c.For("identity_linwan")
	if p != c.For("missing") {
		t.Fatal("unexpected per-character timing rules")
	}
	if p.MaxWaitSeconds != 10 || p.DebounceSeconds != 1 {
		t.Fatal("unexpected execution limits")
	}
	p.MaxWaitSeconds = 60
	if p.Validate() == nil {
		t.Fatal("unbounded wait accepted")
	}
}
