package behavior

import (
	"testing"
	"time"
)

func TestDeliveryTiming(t *testing.T) {
	c, err := Load("../../config/behavior.json")
	if err != nil {
		t.Fatal(err)
	}
	p := c.For("identity_linwan")
	start := time.Unix(1000, 0)
	if p.MinDelaySeconds != 10 || c.For("missing").MinDelaySeconds != 8 {
		t.Fatal("override fallback broken")
	}
	if due := p.DeliverAt(start, start, "你好", 0); due.Before(start.Add(10 * time.Second)) {
		t.Fatal("reply sent too early")
	}
	late := start.Add(time.Minute)
	if due := p.DeliverAt(start, late, "你好", 0); !due.After(late) {
		t.Fatal("must not deliver immediately after generation")
	}
	if due := p.DeliverAt(start, start, "你好", 1); due.After(start.Add(30 * time.Second)) {
		t.Fatal("reading delay exceeded configured maximum")
	}
	p.CharactersPerSecond = 0
	if p.Validate() == nil {
		t.Fatal("invalid policy accepted")
	}
}
