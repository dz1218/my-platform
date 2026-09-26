package httpapi

import (
	"context"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"companion/server/internal/conversation"
	"companion/server/pkg/response"
	"github.com/gin-gonic/gin"
	"golang.org/x/net/websocket"
)

type fakeSocketBackend struct {
	mu       sync.Mutex
	messages []conversation.Message
}

func (b *fakeSocketBackend) Owned(_ context.Context, user, id string) (conversation.Conversation, error) {
	if user != "owner" || id != "owned" {
		return conversation.Conversation{}, response.BadRequest("not owned")
	}
	return conversation.Conversation{ID: id, UserID: user}, nil
}
func (b *fakeSocketBackend) History(context.Context, conversation.Conversation, int64, int) (conversation.Page, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return conversation.Page{Items: append([]conversation.Message{}, b.messages...)}, nil
}
func (b *fakeSocketBackend) Send(_ context.Context, _, _, requestID, content string) (conversation.Message, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for _, message := range b.messages {
		if *message.RequestID == requestID {
			return message, nil
		}
	}
	message := conversation.Message{ID: "1", Content: content, RequestID: &requestID}
	b.messages = append(b.messages, message)
	return message, nil
}
func TestChatSocketDeliveryAndReconnect(t *testing.T) {
	gin.SetMode(gin.TestMode)
	backend := &fakeSocketBackend{messages: []conversation.Message{}}
	router := gin.New()
	router.Use(func(c *gin.Context) { c.Set("userID", "owner") })
	router.GET("/:id", socketHandler(backend, "http://web", func(_ context.Context, _ string) error { return nil }))
	server := httptest.NewServer(router)
	defer server.Close()
	dial := func(id, origin string) (*websocket.Conn, error) {
		return websocket.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/"+id, "", origin)
	}
	if ws, err := dial("other", "http://web"); err == nil {
		ws.Close()
		t.Fatal("foreign conversation allowed")
	}
	if ws, err := dial("owned", "http://evil"); err == nil {
		ws.Close()
		t.Fatal("foreign origin allowed")
	}
	ws, err := dial("owned", "http://web")
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()
	read := func(want string) {
		t.Helper()
		_ = ws.SetDeadline(time.Now().Add(3 * time.Second))
		var event struct {
			Type    string               `json:"type"`
			Page    conversation.Page    `json:"page"`
			Message conversation.Message `json:"message"`
		}
		if err := websocket.JSON.Receive(ws, &event); err != nil {
			t.Fatal(err)
		}
		if event.Type != want {
			t.Fatalf("want %s, got %s", want, event.Type)
		}
		if want == "accepted" && event.Message.Content != "hello" {
			t.Fatal("missing persisted acknowledgement")
		}
	}
	read("history")
	command := chatCommand{Type: "send", RequestID: "request-123", Content: "hello"}
	if err := websocket.JSON.Send(ws, command); err != nil {
		t.Fatal(err)
	}
	read("accepted")
	read("history")
	ws.Close()
	ws, err = dial("owned", "http://web")
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()
	read("history")
	if err := websocket.JSON.Send(ws, command); err != nil {
		t.Fatal(err)
	}
	read("accepted")
}
