package provider

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

type transport func(*http.Request) (*http.Response, error)

func (f transport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestAgentContract(t *testing.T) {
	for _, tt := range []struct {
		name, body string
		status     int
		ok         bool
	}{
		{"whole reply", `{"content":"你好","promptVersion":"v1"}`, 200, true},
		{"contextual", `{"content":"你好","promptVersion":"v2","action":"reply"}`, 200, true},
		{"invalid action", `{"content":"你好","promptVersion":"v2","action":"wait forever"}`, 200, false},
		{"wait", `{"action":"wait","waitSeconds":5,"promptVersion":"v2"}`, 200, true},
		{"wait with draft", `{"action":"wait","content":"hi","waitSeconds":5,"promptVersion":"v2"}`, 200, false},
		{"unbounded wait", `{"action":"wait","waitSeconds":100,"promptVersion":"v2"}`, 200, false},
		{"empty", `{"content":"","promptVersion":"v1"}`, 200, false},
		{"missing version", `{"content":"你好"}`, 200, false},
		{"unavailable", "sensitive error body", 503, false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			a := NewAgent("http://agent", "private-token")
			a.Client = &http.Client{Transport: transport(func(req *http.Request) (*http.Response, error) {
				if req.URL.Path != "/internal/reply" || req.Header.Get("Authorization") != "Bearer private-token" || req.Header.Get("Accept") != "text/event-stream" {
					t.Fatal("invalid internal request")
				}
				return &http.Response{StatusCode: tt.status, Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader("event: reply\ndata: " + tt.body + "\n\n"))}, nil
			})}
			_, err := a.Generate(context.Background(), ChatRequest{})
			if (err == nil) != tt.ok {
				t.Fatalf("error=%v", err)
			}
			if err != nil && strings.Contains(err.Error(), "sensitive") {
				t.Fatal("error body leaked")
			}
		})
	}
}

func TestAgentStreamFailures(t *testing.T) {
	for _, body := range []string{": heartbeat\n\n", "event: reply\ndata: {}", "event: error\ndata: {\"error\":\"secret\"}\n\n", "event: reply\ndata: invalid\n\n"} {
		if _, err := readReply(strings.NewReader(body)); err == nil {
			t.Fatalf("accepted incomplete/invalid stream: %q", body)
		}
	}
	reply, err := readReply(strings.NewReader(": heartbeat\r\n\r\nevent: reply\r\ndata: {\r\ndata: \"content\":\"你好\",\"promptVersion\":\"v1\"}\r\n\r\n"))
	if err != nil || reply.Content != "你好" {
		t.Fatalf("multiline SSE: %v", err)
	}
}
