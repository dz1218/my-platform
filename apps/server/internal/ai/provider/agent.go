package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Agent delegates all model access and graph execution to the private TS service.
// Go owns authorization, history, durable jobs and delivery.
type Agent struct {
	URL, Token string
	Client     *http.Client
}

func NewAgent(url, token string) *Agent {
	return &Agent{URL: strings.TrimRight(url, "/"), Token: token, Client: &http.Client{Timeout: 95 * time.Second}}
}
func (a *Agent) Generate(ctx context.Context, input ChatRequest) (Reply, error) {
	body, err := json.Marshal(input)
	if err != nil {
		return Reply{}, err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", a.URL+"/internal/reply", bytes.NewReader(body))
	if err != nil {
		return Reply{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+a.Token)
	res, err := a.Client.Do(req)
	if err != nil {
		return Reply{}, fmt.Errorf("agent unavailable: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return Reply{}, fmt.Errorf("agent returned HTTP %d", res.StatusCode)
	}
	var reply Reply
	if err = json.NewDecoder(io.LimitReader(res.Body, 65536)).Decode(&reply); err != nil {
		return reply, err
	}
	if strings.TrimSpace(reply.Content) == "" || len(reply.Content) > 32000 || reply.PromptVersion == "" {
		return Reply{}, fmt.Errorf("invalid agent reply")
	}
	return reply, nil
}
