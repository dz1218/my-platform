package provider

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

// ValidatePlan is repeated at the authoritative Go boundary, including for mocks.
func ValidatePlan(p Reply) error {
	if p.Action != "REPLY" && p.Action != "SILENCE" {
		return fmt.Errorf("invalid plan action")
	}
	if p.Action == "SILENCE" && len(p.Messages) != 0 {
		return fmt.Errorf("silence has messages")
	}
	if p.Action == "REPLY" && (len(p.Messages) < 1 || len(p.Messages) > 3) {
		return fmt.Errorf("invalid item count")
	}
	keys := map[string]bool{}
	chars, delay := 0, 0
	for _, m := range p.Messages {
		n := utf8.RuneCountInString(m.Content)
		if strings.TrimSpace(m.Content) == "" || n > 500 || m.ClientItemKey == "" || len(m.ClientItemKey) > 80 || keys[m.ClientItemKey] || m.DelayMs < 0 || m.DelayMs > 10000 {
			return fmt.Errorf("invalid plan item")
		}
		keys[m.ClientItemKey] = true
		chars += n
		delay += m.DelayMs
	}
	if chars > 500 || delay > 20000 {
		return fmt.Errorf("plan exceeds budget")
	}
	return nil
}
