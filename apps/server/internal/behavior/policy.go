// Package behavior defines execution limits; conversational decisions belong to the agent.
package behavior

import (
	"encoding/json"
	"fmt"
	"os"
)

type Policy struct {
	Version         string `json:"version"`
	DebounceSeconds int    `json:"debounceSeconds"`
	MaxWaitSeconds  int    `json:"maxWaitSeconds"`
	MaxAttempts     int    `json:"maxAttempts"`
	RetrySeconds    int    `json:"retrySeconds"`
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
	if p.Version == "" || p.DebounceSeconds < 1 || p.DebounceSeconds > 60 || p.MaxWaitSeconds < 1 || p.MaxWaitSeconds > 30 || p.MaxAttempts < 1 || p.MaxAttempts > 5 || p.RetrySeconds < 1 || p.RetrySeconds > 300 {
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
