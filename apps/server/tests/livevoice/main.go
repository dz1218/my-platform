// Local-only browser integration fixture. Never connects to the application DB.
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

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
	url := value("LIVEKIT_TEST_URL", "http://127.0.0.1:7880")
	cfg := livekit.Config{URL: strings.Replace(url, "http", "ws", 1), InternalURL: url,
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
	var testRooms sync.Map
	router.Use(gin.Recovery(), func(c *gin.Context) {
		if c.Request.URL.Path != "/health" {
			parts := strings.Split(c.Request.URL.Path, "/")
			if len(parts) < 6 || !strings.HasPrefix(parts[4], "voice-e2e-") {
				c.AbortWithStatus(404)
				return
			}
			testRooms.Store(parts[4], true)
		}
		if cookie, _ := c.Cookie(auth.CookieName); cookie == "live-test-host" {
			c.Request.Header.Set("Cookie", auth.CookieName+"="+hostToken)
		} else if cookie == "live-test-viewer" {
			c.Request.Header.Set("Cookie", auth.CookieName+"="+viewerToken)
		}
		c.Next()
	})
	router.GET("/health", func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) })
	livekit.Register(router.Group("/api/v1"), cfg, authentication)
	// Only sweep rooms created by these tests, never another local user's rooms.
	go func() {
		h := livekit.Handler{Client: livekit.NewClient(cfg), Auth: authentication}
		for range time.Tick(5 * time.Second) {
			testRooms.Range(func(key, _ any) bool { _ = h.ReconcileVoiceRoom(context.Background(), key.(string)); return true })
		}
	}()
	log.Fatal(http.ListenAndServe("127.0.0.1:18182", router))
}
