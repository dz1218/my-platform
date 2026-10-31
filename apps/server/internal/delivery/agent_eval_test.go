package delivery

import (
	"companion/server/internal/ai/provider"
	"encoding/json"
	"os"
	"testing"
)

// Optional real-model artifact admission. The normal suite already tests the
// deterministic policy; this additionally commits actual extracted proposals
// into isolated PostgreSQL schemas rather than guessing precision in TypeScript.
func TestAgentLiveMemoryAdmission(t *testing.T) {
	path := os.Getenv("COMPANION_EVAL_RESULTS")
	if path == "" {
		t.Skip("set COMPANION_EVAL_RESULTS for real-model extraction admission")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var artifact struct {
		DatasetHash string `json:"datasetHash"`
		Results     []struct {
			ID       string         `json:"id"`
			Kind     string         `json:"kind"`
			Text     string         `json:"text"`
			Error    string         `json:"error"`
			Expected bool           `json:"expectedAutomatic"`
			Plan     provider.Reply `json:"plan"`
		} `json:"results"`
	}
	if err = json.Unmarshal(raw, &artifact); err != nil {
		t.Fatal(err)
	}
	saved, correct, cases := 0, 0, 0
	for _, c := range artifact.Results {
		if c.Kind != "CONTEXT_UPDATE" {
			continue
		}
		cases++
		t.Run(c.ID, func(t *testing.T) {
			if c.Error != "" {
				t.Fatal("model case failed", c.Error)
			}
			f := autopilotTest(t)
			enableMemory(t, f, "c", "u")
			m, e := f.service.Send(f.ctx, "u", "c", "eval-"+c.ID, c.Text)
			if e != nil {
				t.Fatal(e)
			}
			tx, e := f.db.Begin(f.ctx)
			if e != nil {
				t.Fatal(e)
			}
			defer tx.Rollback(f.ctx)
			for _, proposal := range c.Plan.MemoryProposals {
				if proposal.SourceMessageID == "1" {
					proposal.SourceMessageID = m.ID
				}
				if e = commitMemoryCandidate(f.ctx, tx, "c", m.ID, proposal); e != nil {
					t.Fatal(e)
				}
			}
			if e = tx.Commit(f.ctx); e != nil {
				t.Fatal(e)
			}
			var count int
			if e = f.db.QueryRow(f.ctx, `SELECT count(*) FROM conversation_memories WHERE deleted_at IS NULL`).Scan(&count); e != nil {
				t.Fatal(e)
			}
			saved += count
			if c.Expected {
				correct += count
			}
			if (count > 0) != c.Expected {
				t.Errorf("auto memory count=%d expected=%v", count, c.Expected)
			}
		})
	}
	if cases == 0 {
		t.Fatal("no memory evaluation cases")
	}
	precision := 0.0
	if saved > 0 {
		precision = float64(correct) / float64(saved)
	}
	t.Logf("actual Go admission: cases=%d saved=%d correct=%d precision=%.4f", cases, saved, correct, precision)
	if path := os.Getenv("COMPANION_EVAL_REPORT"); path != "" && !t.Failed() {
		raw, e := os.ReadFile(path)
		if e != nil {
			t.Fatal(e)
		}
		report := map[string]any{}
		if e = json.Unmarshal(raw, &report); e != nil {
			t.Fatal(e)
		}
		if report["datasetHash"] != artifact.DatasetHash {
			t.Fatal("report dataset mismatch")
		}
		report["automaticMemoryPrecision"] = precision
		report["automaticMemorySamples"] = cases
		report["automaticMemoriesSaved"] = saved
		raw, e = json.MarshalIndent(report, "", "  ")
		if e != nil {
			t.Fatal(e)
		}
		if e = os.WriteFile(path, raw, 0600); e != nil {
			t.Fatal(e)
		}
	}
}
