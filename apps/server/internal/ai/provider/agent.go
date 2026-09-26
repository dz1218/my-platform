package provider

import (
	"bufio"
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
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Authorization", "Bearer "+a.Token)
	res, err := a.Client.Do(req)
	if err != nil {
		return Reply{}, fmt.Errorf("agent unavailable: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return Reply{}, fmt.Errorf("agent returned HTTP %d", res.StatusCode)
	}
	if !strings.HasPrefix(res.Header.Get("Content-Type"), "text/event-stream") {
		return Reply{}, fmt.Errorf("agent did not return SSE")
	}
	return readReply(res.Body)
}

func readReply(body io.Reader) (Reply, error) {
	scanner := bufio.NewScanner(io.LimitReader(body, 1024*1024))
	scanner.Buffer(make([]byte, 4096), 256*1024)
	event, data := "", ""
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			if event == "error" {
				return Reply{}, fmt.Errorf("agent generation failed")
			}
			if event == "reply" {
				var reply Reply
				if err := json.Unmarshal([]byte(data), &reply); err != nil {
					return Reply{}, fmt.Errorf("invalid agent reply event")
				}
				if reply.PromptVersion == "" {
					return Reply{}, fmt.Errorf("missing prompt version")
				}
				switch reply.Action {
				case "", "reply":
					if strings.TrimSpace(reply.Content) == "" || len(reply.Content) > 32000 || reply.WaitSeconds != 0 {
						return Reply{}, fmt.Errorf("invalid reply action")
					}
				case "wait":
					if reply.Content != "" || reply.WaitSeconds < 1 || reply.WaitSeconds > 30 {
						return Reply{}, fmt.Errorf("invalid wait action")
					}
				default:
					return Reply{}, fmt.Errorf("invalid agent action")
				}
				return reply, nil
			}
			event, data = "", ""
			continue
		}
		if strings.HasPrefix(line, ":") {
			continue
		}
		field, value, _ := strings.Cut(line, ":")
		value = strings.TrimPrefix(value, " ")
		switch field {
		case "event":
			event = value
		case "data":
			data += value + "\n"
		}
	}
	if err := scanner.Err(); err != nil {
		return Reply{}, fmt.Errorf("agent stream failed: %w", err)
	}
	return Reply{}, fmt.Errorf("agent stream ended without reply")
}
