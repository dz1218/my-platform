// Package behavior controls delivery rhythm independently of prompts and models.
package behavior

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"time"
	"unicode/utf8"
)

type Policy struct {
	Version             string `json:"version"`
	DebounceSeconds     int    `json:"debounceSeconds"`
	MinDelaySeconds     int    `json:"minDelaySeconds"`
	MaxDelaySeconds     int    `json:"maxDelaySeconds"`
	CharactersPerSecond int    `json:"charactersPerSecond"`
	MaxTypingSeconds    int    `json:"maxTypingSeconds"`
	MaxAttempts         int    `json:"maxAttempts"`
	RetrySeconds        int    `json:"retrySeconds"`
}
type Catalog struct {
	Default    Policy
	Identities map[string]Policy
}

func Load(path string) (Catalog, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Catalog{}, err
	}
	var raw struct {
		Version    string                     `json:"version"`
		Default    Policy                     `json:"default"`
		Identities map[string]json.RawMessage `json:"identities"`
	}
	if err = json.Unmarshal(data, &raw); err != nil {
		return Catalog{}, err
	}
	raw.Default.Version = raw.Version
	if err = raw.Default.Validate(); err != nil {
		return Catalog{}, err
	}
	c := Catalog{Default: raw.Default, Identities: map[string]Policy{}}
	for id, override := range raw.Identities {
		p := raw.Default
		if err = json.Unmarshal(override, &p); err != nil {
			return c, err
		}
		if err = p.Validate(); err != nil {
			return c, fmt.Errorf("identity %s: %w", id, err)
		}
		c.Identities[id] = p
	}
	return c, nil
}
func (p Policy) Validate() error {
	if p.Version == "" || p.DebounceSeconds < 1 || p.DebounceSeconds > 60 || p.MinDelaySeconds < 1 || p.MaxDelaySeconds < p.MinDelaySeconds || p.MaxDelaySeconds > 3600 || p.CharactersPerSecond < 1 || p.MaxTypingSeconds < 1 || p.MaxTypingSeconds > 120 || p.MaxAttempts < 1 || p.MaxAttempts > 5 || p.RetrySeconds < 1 || p.RetrySeconds > 300 {
		return fmt.Errorf("invalid behavior policy")
	}
	return nil
}
func (c Catalog) For(identityID string) Policy {
	if p, ok := c.Identities[identityID]; ok {
		return p
	}
	return c.Default
}

// Delivery is never immediate, even if generation already exceeded reading delay.
// random is injected so the policy can be tested without sleeping.
func (p Policy) DeliverAt(requested, generated time.Time, content string, random float64) time.Time {
	random = math.Max(0, math.Min(1, random))
	delay := float64(p.MinDelaySeconds) + random*float64(p.MaxDelaySeconds-p.MinDelaySeconds)
	reading := requested.Add(time.Duration(delay * float64(time.Second)))
	typing := math.Min(float64(p.MaxTypingSeconds), math.Max(1, float64(utf8.RuneCountInString(content))/float64(p.CharactersPerSecond)))
	ready := generated.Add(time.Duration(typing * float64(time.Second)))
	if reading.After(ready) {
		return reading
	}
	return ready
}
