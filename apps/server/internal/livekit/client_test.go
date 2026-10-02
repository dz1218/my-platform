package livekit

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestConfigValidation(t *testing.T) {
	for _, tc := range []struct {
		cfg   Config
		valid bool
	}{
		{Config{}, true},
		{Config{URL: "ws://localhost:7880", APIKey: "key", APISecret: "secret"}, true},
		{Config{URL: "wss://public.example", InternalURL: "http://livekit:7880", APIKey: "key", APISecret: "secret"}, true},
		{Config{URL: "ws://localhost:7880"}, false},
		{Config{InternalURL: "http://livekit:7880"}, false},
		{Config{URL: "file:///tmp/socket", APIKey: "key", APISecret: "secret"}, false},
		{Config{URL: "ws://user:password@host", APIKey: "key", APISecret: "secret"}, false},
		{Config{URL: "ws://host?secret=1", APIKey: "key", APISecret: "secret"}, false},
		{Config{URL: "ws://host", InternalURL: "ftp://host", APIKey: "key", APISecret: "secret"}, false},
	} {
		if err := tc.cfg.Validate(); (err == nil) != tc.valid {
			t.Errorf("valid=%v: %v", tc.valid, err)
		}
	}
}
func TestTransportCancellationAndNoRedirects(t *testing.T) {
	var leaked bool
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { leaked = true }))
	defer destination.Close()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, destination.URL, http.StatusTemporaryRedirect)
	}))
	defer upstream.Close()
	client := NewClient(Config{URL: "ws" + strings.TrimPrefix(upstream.URL, "http"), APIKey: "key", APISecret: "secret"})
	if _, err := client.ListRooms(context.Background()); err == nil || leaked {
		t.Fatal("redirect must fail without forwarding credentials")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := client.ListRooms(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation lost: %v", err)
	}
	client.http.Timeout = 10 * time.Millisecond
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(100 * time.Millisecond):
		}
	}))
	defer slow.Close()
	client.config.URL = slow.URL
	if _, err := client.ListRooms(context.Background()); err == nil {
		t.Fatal("missing timeout")
	}
}
func TestDispatchCamelCase(t *testing.T) {
	var item Dispatch
	if err := json.Unmarshal([]byte(`{"id":"id","room":"room","agentName":"assistant","metadata":"{}"}`), &item); err != nil || item.AgentName != "assistant" || item.Metadata != "{}" {
		t.Fatalf("decode: %+v %v", item, err)
	}
}
