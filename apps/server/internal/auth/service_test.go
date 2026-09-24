package auth

import (
	"encoding/hex"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"golang.org/x/crypto/scrypt"
	"strings"
	"testing"
	"time"
)

func TestPasswords(t *testing.T) {
	password := "correct horse battery"
	hash, _ := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	salt := "0123456789abcdef0123456789abcdef"
	old, _ := scrypt.Key([]byte(password), []byte(salt), 16384, 8, 1, 64)
	for _, stored := range []string{string(hash), salt + ":" + hex.EncodeToString(old)} {
		if !verifyPassword(password, stored) || verifyPassword("wrong", stored) {
			t.Fatal("password verification failed")
		}
	}
	for _, stored := range []string{"", ":", "x:y", "$2broken"} {
		if verifyPassword(password, stored) {
			t.Fatal("accepted invalid hash")
		}
	}
}
func TestSessions(t *testing.T) {
	s := Service{Secret: strings.Repeat("s", 32)}
	token, err := s.Token("user-a")
	if err != nil {
		t.Fatal(err)
	}
	if id, err := s.Verify(token); err != nil || id != "user-a" {
		t.Fatal(id, err)
	}
	for _, claims := range []jwt.RegisteredClaims{
		{Subject: "user-a", Issuer: "companion", ExpiresAt: jwt.NewNumericDate(time.Now().Add(-time.Hour))},
		{Subject: "user-a", Issuer: "wrong", ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))},
		{Subject: "user-a", Issuer: "companion"},
	} {
		raw, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(s.Secret))
		if _, err := s.Verify(raw); err == nil {
			t.Fatal("accepted invalid claims")
		}
	}
	wrong := Service{Secret: strings.Repeat("x", 32)}
	if _, err := wrong.Verify(token); err == nil {
		t.Fatal("accepted bad signature")
	}
}
