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
		{"empty", `{"content":"","promptVersion":"v1"}`, 200, false},
		{"missing version", `{"content":"你好"}`, 200, false},
		{"unavailable", "sensitive error body", 503, false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			a := NewAgent("http://agent", "private-token")
			a.Client = &http.Client{Transport: transport(func(req *http.Request) (*http.Response, error) {
				if req.URL.Path != "/internal/reply" || req.Header.Get("Authorization") != "Bearer private-token" {
					t.Fatal("invalid internal request")
				}
				return &http.Response{StatusCode: tt.status, Body: io.NopCloser(strings.NewReader(tt.body))}, nil
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
