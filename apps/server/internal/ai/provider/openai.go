package provider

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type OpenAI struct {
	BaseURL, APIKey, Model string
	Client                 *http.Client
}

func NewOpenAI(base, key, model string) *OpenAI {
	return &OpenAI{BaseURL: strings.TrimRight(base, "/"), APIKey: key, Model: model, Client: &http.Client{Timeout: 90 * time.Second}}
}
func (p *OpenAI) Stream(ctx context.Context, request ChatRequest, handler StreamHandler) error {
	if p.APIKey == "" || p.Model == "" {
		return errors.New("LLM_API_KEY and LLM_MODEL are required for chat")
	}
	body, err := json.Marshal(map[string]interface{}{"model": p.Model, "messages": request.Messages, "stream": true, "max_completion_tokens": 1000})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.BaseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+p.APIKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	resp, err := p.Client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("LLM returned HTTP %d", resp.StatusCode)
	}
	return parseStream(resp.Body, handler)
}
func parseStream(reader io.Reader, handler StreamHandler) error {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 4096), 1024*1024)
	var data []string
	finished := false
	dispatch := func() (bool, error) {
		if len(data) == 0 {
			return false, nil
		}
		raw := strings.Join(data, "\n")
		data = nil
		if raw == "[DONE]" {
			if !finished {
				return false, errors.New("LLM stream missing finish reason")
			}
			return true, nil
		}
		var chunk struct {
			Error   *json.RawMessage `json:"error"`
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
					Refusal string `json:"refusal"`
				} `json:"delta"`
				FinishReason *string `json:"finish_reason"`
			} `json:"choices"`
		}
		if err := json.Unmarshal([]byte(raw), &chunk); err != nil {
			return false, fmt.Errorf("invalid LLM stream: %w", err)
		}
		if chunk.Error != nil {
			return false, errors.New("LLM stream error")
		}
		for _, choice := range chunk.Choices {
			if choice.Delta.Refusal != "" {
				return false, errors.New("LLM declined response")
			}
			if choice.Delta.Content != "" {
				if err := handler(choice.Delta.Content); err != nil {
					return false, err
				}
			}
			if choice.FinishReason != nil {
				if *choice.FinishReason != "stop" {
					return false, fmt.Errorf("LLM incomplete response: %s", *choice.FinishReason)
				}
				finished = true
			}
		}
		return false, nil
	}
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			done, err := dispatch()
			if err != nil {
				return err
			}
			if done {
				return nil
			}
		} else if strings.HasPrefix(line, "data:") {
			data = append(data, strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	done, err := dispatch()
	if err != nil {
		return err
	}
	if done {
		return nil
	}
	return io.ErrUnexpectedEOF
}
