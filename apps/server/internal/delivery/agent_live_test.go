package delivery

import (
	"bytes"
	aicontext "companion/server/internal/ai/context"
	"companion/server/internal/ai/provider"
	"companion/server/internal/identity"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Explicit live opt-in: uses only synthetic messages in an isolated DB schema.
// Exercise the actual Node service, Go leases, private callbacks and final send.
func TestAgentLivePipeline(t *testing.T) {
	if os.Getenv("COMPANION_LIVE_PIPELINE") != "1" {
		t.Skip("set COMPANION_LIVE_PIPELINE=1 for real model pipeline and shadow smoke")
	}
	for _, mode := range []string{"langgraph", "shadow"} {
		t.Run(mode, func(t *testing.T) {
			f := autopilotTest(t)
			enableMemory(t, f, "c", "u")
			token := strings.Repeat("synthetic-service-token-", 2)
			callback := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer "+token {
					w.WriteHeader(401)
					return
				}
				switch r.URL.Path {
				case "/internal/companion/validate":
					var run provider.RunContext
					if json.NewDecoder(r.Body).Decode(&run) != nil {
						w.WriteHeader(400)
						return
					}
					if f.repo.ValidateRun(r.Context(), run) != nil {
						w.WriteHeader(409)
						return
					}
					json.NewEncoder(w).Encode(map[string]bool{"ok": true})
				case "/internal/companion/search":
					var input struct {
						Run    provider.RunContext `json:"run"`
						Query  string              `json:"query"`
						Vector []float64           `json:"vector"`
						Model  string              `json:"model"`
					}
					if json.NewDecoder(r.Body).Decode(&input) != nil {
						w.WriteHeader(400)
						return
					}
					hits, err := f.repo.SearchEvidence(r.Context(), input.Run, input.Query, input.Vector, input.Model)
					if err != nil {
						w.WriteHeader(409)
						return
					}
					json.NewEncoder(w).Encode(map[string]any{"items": hits})
				default:
					w.WriteHeader(404)
				}
			}))
			defer callback.Close()
			listener, err := net.Listen("tcp", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			port := listener.Addr().(*net.TCPAddr).Port
			listener.Close()
			agentDir, err := filepath.Abs("../../../agent")
			if err != nil {
				t.Fatal(err)
			}
			node := os.Getenv("COMPANION_EVAL_NODE")
			if node == "" {
				node = "node"
			}
			ctx, cancel := context.WithTimeout(f.ctx, 3*time.Minute)
			defer cancel()
			cmd := exec.CommandContext(ctx, node, "--import", "tsx", "src/main.ts")
			cmd.Dir = agentDir
			cmd.Env = append(os.Environ(), "NODE_ENV=test", "AGENT_HOST=127.0.0.1", "AGENT_PORT="+strconv.Itoa(port), "AGENT_TOKEN="+token, "AGENT_DATABASE_URL="+os.Getenv("TEST_DATABASE_URL"), "AGENT_SERVER_URL="+callback.URL, "COMPANION_RUNTIME="+mode, "COMPANION_ROLLOUT_PERCENT=100", "EMBEDDING_API_KEY=")
			// Capture metadata only; inspect after Wait, avoiding concurrent buffer reads.
			var logs bytes.Buffer
			cmd.Stdout = &logs
			cmd.Stderr = io.Discard
			if err = cmd.Start(); err != nil {
				t.Fatal(err)
			}
			defer func() {
				cancel()
				_ = cmd.Wait()
				if mode == "shadow" && !strings.Contains(logs.String(), `"event":"companion_shadow"`) {
					t.Error("shadow graph did not complete; legacy fallback alone is insufficient")
				}
			}()
			url := fmt.Sprintf("http://127.0.0.1:%d", port)
			client := &http.Client{Timeout: time.Second}
			ready := false
			for until := time.Now().Add(10 * time.Second); time.Now().Before(until); {
				response, e := client.Get(url + "/health")
				if e == nil {
					response.Body.Close()
					if response.StatusCode == 200 {
						ready = true
						break
					}
				}
				time.Sleep(100 * time.Millisecond)
			}
			if !ready {
				t.Fatal("live Agent not ready; migrate checkpoints and configure existing LLM credentials")
			}
			_, err = f.service.Send(f.ctx, "u", "c", "pipeline-"+mode, "我住在杭州")
			if err != nil {
				t.Fatal(err)
			}
			if _, err = f.db.Exec(f.ctx, `UPDATE reply_jobs SET version=$1 WHERE conversation_id='c'`, time.Now().UnixMicro()); err != nil {
				t.Fatal(err)
			}
			j := f.claim()
			worker := Worker{Repo: f.repo, Builder: aicontext.Builder{Messages: f.service.Messages, Identities: identity.Repository{DB: f.db}}, Model: provider.NewAgent(url, token)}
			worker.generate(ctx, j)
			var actualGraph string
			if err = f.db.QueryRow(f.ctx, `SELECT agent_execution->>'graphVersion' FROM reply_batches WHERE conversation_id='c'`).Scan(&actualGraph); err != nil {
				t.Fatal("no sendable candidate", err)
			}
			if mode == "langgraph" && !strings.HasPrefix(actualGraph, "companion-graph-") {
				t.Fatal(actualGraph)
			}
			if mode == "shadow" && actualGraph != "legacy" {
				t.Fatal("shadow candidate reached delivery", actualGraph)
			}
			if _, err = f.db.Exec(f.ctx, `UPDATE reply_items SET due_at=now()-interval '1 second';UPDATE reply_jobs SET due_at=now()-interval '1 second'`); err != nil {
				t.Fatal(err)
			}
			if sent, e := f.repo.Deliver(f.ctx); e != nil || !sent {
				t.Fatal("candidate not delivered", sent, e)
			}
			var count int
			if err = f.db.QueryRow(f.ctx, `SELECT count(*) FROM messages WHERE driver_type='ai'`).Scan(&count); err != nil || count < 1 {
				t.Fatal(count, err)
			}
			t.Logf("%s: real Node graph + Go lease/callback/final delivery passed", mode)
		})
	}
}
