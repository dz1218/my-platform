package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

type EmbeddingResult struct {
	Model   string      `json:"model"`
	Vectors [][]float64 `json:"vectors"`
}
type IndexModel interface {
	Embed(context.Context, []string) (EmbeddingResult, error)
	PurgeCheckpoints(context.Context, string, int64) error
}

func (a *Agent) internalJSON(ctx context.Context, path string, input, output any) error {
	body, err := json.Marshal(input)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", a.URL+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+a.Token)
	res, err := a.Client.Do(req)
	if err != nil {
		return fmt.Errorf("agent unavailable")
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		if res.StatusCode == 503 {
			var failure struct {
				Error string `json:"error"`
			}
			if json.NewDecoder(io.LimitReader(res.Body, 1024)).Decode(&failure) == nil && failure.Error == "busy" {
				return ErrBusy
			}
		}
		return fmt.Errorf("agent internal HTTP %d", res.StatusCode)
	}
	if output == nil {
		return nil
	}
	return json.NewDecoder(io.LimitReader(res.Body, 512*1024)).Decode(output)
}
func (a *Agent) Embed(ctx context.Context, texts []string) (EmbeddingResult, error) {
	var out EmbeddingResult
	err := a.internalJSON(ctx, "/internal/embeddings", map[string]any{"texts": texts}, &out)
	return out, err
}
func (a *Agent) PurgeCheckpoints(ctx context.Context, id string, revision int64) error {
	return a.internalJSON(ctx, "/internal/checkpoints/purge", map[string]any{"conversationId": id, "beforeRevision": revision}, nil)
}
