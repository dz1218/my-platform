package config

import (
	"fmt"
	"github.com/joho/godotenv"
	"net/url"
	"os"
	"strings"
)

type Config struct {
	Address, DatabaseURL, RedisURL, JWTSecret, WebOrigin, LLMURL, LLMKey, LLMModel string
	SecureCookie                                                                   bool
}

func Load() (Config, error) {
	// Server-specific settings override root defaults; actual environment always wins.
	_ = godotenv.Load(".env", "../../.env")
	c := Config{Address: value("SERVER_ADDR", "127.0.0.1:8080"), DatabaseURL: os.Getenv("DATABASE_URL"), RedisURL: value("REDIS_URL", "redis://localhost:6379/0"), JWTSecret: os.Getenv("JWT_SECRET"), WebOrigin: value("WEB_ORIGIN", "http://localhost:3011"), LLMURL: value("LLM_BASE_URL", "https://api.openai.com/v1"), LLMKey: os.Getenv("LLM_API_KEY"), LLMModel: os.Getenv("LLM_MODEL"), SecureCookie: os.Getenv("COOKIE_SECURE") == "true"}
	if c.DatabaseURL == "" || len(c.JWTSecret) < 32 {
		return c, fmt.Errorf("DATABASE_URL and JWT_SECRET (at least 32 characters) are required")
	}
	for _, raw := range []string{c.WebOrigin, c.LLMURL} {
		u, e := url.Parse(raw)
		if e != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
			return c, fmt.Errorf("invalid HTTP URL configuration")
		}
	}
	c.LLMURL = strings.TrimRight(c.LLMURL, "/")
	return c, nil
}
func value(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
