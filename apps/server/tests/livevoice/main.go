// Local-only browser integration fixture. Never connects to the application DB.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"sync"

	"companion/server/internal/auth"
	"companion/server/internal/livekit"
	"github.com/gin-gonic/gin"
)

func value(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func main() {
	gin.SetMode(gin.TestMode)
	livekitURL := value("LIVEKIT_TEST_URL", "http://127.0.0.1:7880")
	upstream, err := url.Parse(livekitURL)
	if err != nil {
		log.Fatal(err)
	}
	var rpcMu sync.Mutex
	rpcCalls := make(map[string]int)
	proxy := httputil.NewSingleHostReverseProxy(upstream)
	proxy.ModifyResponse = func(response *http.Response) error {
		if !strings.HasSuffix(response.Request.URL.Path, "/ListRooms") || response.StatusCode != http.StatusOK {
			return nil
		}
		var result struct {
			Rooms []json.RawMessage `json:"rooms"`
		}
		if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
			return err
		}
		_ = response.Body.Close()
		filtered := result.Rooms[:0]
		for _, raw := range result.Rooms {
			var room struct {
				Name string `json:"name"`
			}
			if json.Unmarshal(raw, &room) == nil && strings.HasPrefix(room.Name, "voice-e2e-") {
				filtered = append(filtered, raw)
			}
		}
		result.Rooms = filtered
		data, err := json.Marshal(result)
		if err != nil {
			return err
		}
		response.Body = io.NopCloser(bytes.NewReader(data))
		response.ContentLength = int64(len(data))
		response.Header.Del("Content-Length")
		return nil
	}
	rpcProxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		method := r.URL.Path[strings.LastIndex(r.URL.Path, "/")+1:]
		data, err := io.ReadAll(r.Body)
		var input struct {
			Room string `json:"room"`
			Name string `json:"name"`
		}
		if err != nil || json.Unmarshal(data, &input) != nil || (method != "ListRooms" && !strings.HasPrefix(input.Room, "voice-e2e-") && !strings.HasPrefix(input.Name, "voice-e2e-")) {
			http.Error(w, "test rooms only", http.StatusForbidden)
			return
		}
		r.Body = io.NopCloser(bytes.NewReader(data))
		rpcMu.Lock()
		rpcCalls[method]++
		rpcMu.Unlock()
		proxy.ServeHTTP(w, r)
	}))
	defer rpcProxy.Close()
	cfg := livekit.Config{URL: strings.Replace(livekitURL, "http", "ws", 1), InternalURL: rpcProxy.URL,
		APIKey: value("LIVEKIT_TEST_API_KEY", "devkey"), APISecret: value("LIVEKIT_TEST_API_SECRET", "devsecretdevsecretdevsecretdevsec")}
	authentication := auth.Handler{Service: auth.Service{Secret: "voice-browser-fixture-only"}}
	hostToken, err := authentication.Service.Token("live-test-host")
	if err != nil {
		log.Fatal(err)
	}
	viewerToken, err := authentication.Service.Token("live-test-viewer")
	if err != nil {
		log.Fatal(err)
	}
	router := gin.New()
	var webhookMu sync.Mutex
	webhookCounts := make(map[string]map[string]int)
	router.Use(gin.Recovery(), func(c *gin.Context) {
		var eventName, eventRoom string
		if c.Request.URL.Path == livekit.WebhookPath {
			// Limit this local fixture to rooms created by browser tests, including
			// notifications delivered directly by an optional test LiveKit server.
			data, err := io.ReadAll(io.LimitReader(c.Request.Body, 1<<20))
			var event struct {
				Event string `json:"event"`
				Room  struct {
					Name string `json:"name"`
				} `json:"room"`
			}
			if err != nil || json.Unmarshal(data, &event) != nil || !strings.HasPrefix(event.Room.Name, "voice-e2e-") {
				c.AbortWithStatus(404)
				return
			}
			c.Request.Body = io.NopCloser(bytes.NewReader(data))
			eventName, eventRoom = event.Event, event.Room.Name
		}
		if c.Request.URL.Path != "/health" && c.Request.URL.Path != "/__sync" && c.Request.URL.Path != livekit.WebhookPath && c.Request.URL.Path != livekit.RoomSocketPath && c.Request.URL.Path != livekit.RoomSocketTicketPath {
			parts := strings.Split(c.Request.URL.Path, "/")
			if len(parts) < 5 || !strings.HasPrefix(parts[4], "voice-e2e-") {
				c.AbortWithStatus(404)
				return
			}
		}
		if cookie, _ := c.Cookie(auth.CookieName); cookie == "live-test-host" {
			c.Request.Header.Set("Cookie", auth.CookieName+"="+hostToken)
		} else if cookie == "live-test-viewer" {
			c.Request.Header.Set("Cookie", auth.CookieName+"="+viewerToken)
		}
		c.Next()
		if eventName != "" && c.Writer.Status() == http.StatusNoContent {
			webhookMu.Lock()
			if webhookCounts[eventRoom] == nil {
				webhookCounts[eventRoom] = make(map[string]int)
			}
			webhookCounts[eventRoom][eventName]++
			webhookMu.Unlock()
		}
	})
	router.GET("/health", func(c *gin.Context) {
		webhookMu.Lock()
		defer webhookMu.Unlock()
		rpcMu.Lock()
		defer rpcMu.Unlock()
		c.JSON(200, gin.H{"ok": true, "webhookEvents": webhookCounts, "rpcCalls": rpcCalls})
	})
	handler := livekit.Handler{Client: livekit.NewClient(cfg), Auth: authentication}
	router.POST("/__sync", func(c *gin.Context) {
		if err := handler.SyncRooms(c.Request.Context()); err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
	livekit.Register(router.Group("/api/v1"), cfg, authentication)
	livekit.RegisterWebhook(router, cfg, authentication, nil)
	livekit.RegisterRealtime(router, cfg, authentication, nil, "http://127.0.0.1:3012")
	// The proxy makes startup synchronization and targeted closing retries safe
	// even when the developer's LiveKit contains unrelated non-test rooms.
	go livekit.RunRoomMaintenance(context.Background(), cfg, authentication)
	log.Fatal(http.ListenAndServe(value("LIVEKIT_TEST_BIND", "127.0.0.1:18182"), router))
}
