package config

import (
	"companion/server/internal/auth"
	"companion/server/internal/livekit"
	"encoding/json"
	"fmt"
	"github.com/joho/godotenv"
	"net"
	"net/url"
	"os"
	"strings"
)

type Config struct {
	SMS                                                                                      auth.AlibabaSMS
	ResetSMS                                                                                 auth.AlibabaSMS
	LiveKit                                                                                  livekit.Config
	Address, DatabaseURL, RedisURL, JWTSecret, WebOrigin, AgentURL, AgentToken, BehaviorFile string
	TrustedProxies                                                                           []string
	SecureCookie                                                                             bool
}

func Load() (Config, error) {
	// Server-specific settings override root defaults; actual environment always wins.
	_ = godotenv.Load(".env", "../../.env")
	c := Config{Address: value("SERVER_ADDR", "127.0.0.1:8080"), DatabaseURL: os.Getenv("DATABASE_URL"), RedisURL: value("REDIS_URL", "redis://localhost:6379/0"), JWTSecret: os.Getenv("JWT_SECRET"), WebOrigin: value("WEB_ORIGIN", "http://localhost:3011"), AgentURL: value("AGENT_URL", "http://127.0.0.1:8081"), AgentToken: os.Getenv("AGENT_TOKEN"), BehaviorFile: value("BEHAVIOR_CONFIG", "config/behavior.json"), SecureCookie: os.Getenv("COOKIE_SECURE") == "true"}
	c.SMS = auth.AlibabaSMS{AccessKeyID: os.Getenv("ALIBABA_CLOUD_ACCESS_KEY_ID"), AccessKeySecret: os.Getenv("ALIBABA_CLOUD_ACCESS_KEY_SECRET"), SignName: os.Getenv("SMS_SIGN_NAME"), TemplateCode: os.Getenv("SMS_TEMPLATE_CODE"), CodeParameter: value("SMS_CODE_PARAMETER", "code")}
	c.ResetSMS = c.SMS
	c.ResetSMS.TemplateCode = value("SMS_RESET_TEMPLATE_CODE", "100003")
	c.LiveKit = livekit.Config{URL: os.Getenv("LIVEKIT_URL"), InternalURL: os.Getenv("LIVEKIT_INTERNAL_URL"), APIKey: os.Getenv("LIVEKIT_API_KEY"), APISecret: os.Getenv("LIVEKIT_API_SECRET"), AgentName: value("LIVEKIT_AGENT_NAME", "room-assistant")}
	c.LiveKit.ScopedLocks = os.Getenv("LIVE_ROOM_SCOPED_LOCKS") == "true"
	if raw := os.Getenv("LIVE_ROOM_LIMITS"); raw != "" {
		if err := json.Unmarshal([]byte(raw), &c.LiveKit.Limits); err != nil {
			return c, fmt.Errorf("invalid LIVE_ROOM_LIMITS JSON")
		}
	}
	if raw := os.Getenv("TRUSTED_PROXY_CIDRS"); raw != "" {
		for _, part := range strings.Split(raw, ",") {
			cidr := strings.TrimSpace(part)
			if _, _, err := net.ParseCIDR(cidr); err != nil {
				return c, fmt.Errorf("invalid TRUSTED_PROXY_CIDRS")
			}
			c.TrustedProxies = append(c.TrustedProxies, cidr)
		}
	}
	if err := c.LiveKit.Validate(); err != nil {
		return c, err
	}
	if c.DatabaseURL == "" || len(c.JWTSecret) < 32 {
		return c, fmt.Errorf("DATABASE_URL and JWT_SECRET (at least 32 characters) are required")
	}
	for _, raw := range []string{c.WebOrigin, c.AgentURL} {
		u, e := url.Parse(raw)
		if e != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
			return c, fmt.Errorf("invalid HTTP URL configuration")
		}
	}
	c.AgentURL = strings.TrimRight(c.AgentURL, "/")
	if len(c.AgentToken) < 32 {
		return c, fmt.Errorf("AGENT_TOKEN (at least 32 characters) is required")
	}
	return c, nil
}
func value(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
