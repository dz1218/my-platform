package auth

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

type smsTransport func(*http.Request) (*http.Response, error)

func (f smsTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestAlibabaSMS(t *testing.T) {
	s := AlibabaSMS{AccessKeyID: "test-id", AccessKeySecret: "test-secret", SignName: "恒创联众", TemplateCode: "100001"}
	for _, status := range []string{"OK", "Forbidden"} {
		s.Client = &http.Client{Transport: smsTransport(func(r *http.Request) (*http.Response, error) {
			if r.URL.Host != "dypnsapi.aliyuncs.com" || r.Header.Get("X-Acs-Action") != "SendSmsVerifyCode" || r.Method != "POST" {
				t.Fatal("wrong SMS endpoint")
			}
			var params map[string]string
			if err := json.Unmarshal([]byte(r.URL.Query().Get("TemplateParam")), &params); err != nil {
				t.Fatal(err)
			}
			if params["code"] != "123456" || params["min"] != "5" || r.URL.Query().Get("PhoneNumber") != "13800138000" || r.URL.Query().Get("TemplateCode") != "100001" {
				t.Fatal("incorrect SMS parameters")
			}
			if !strings.HasPrefix(r.Header.Get("Authorization"), "ACS3-HMAC-SHA256 Credential=test-id,") {
				t.Fatal("missing signature")
			}
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"Code":"` + status + `","Success":` + map[string]string{"OK": "true", "Forbidden": "false"}[status] + `}`))}, nil
		})}
		err := s.Send(context.Background(), "13800138000", "123456")
		if status == "OK" && err != nil {
			t.Fatal(err)
		}
		if status != "OK" {
			requireCode(t, err, "sms_unavailable")
		}
	}
	requireCode(t, (AlibabaSMS{}).Send(context.Background(), "13800138000", "123456"), "sms_not_configured")
}
func TestAlibabaSignatureBindsRequest(t *testing.T) {
	r, _ := http.NewRequest("POST", "https://dypnsapi.aliyuncs.com/?PhoneNumber=13800138000", nil)
	signAlibaba(r, "test-id", "test-secret", "nonce", time.Date(2026, 10, 15, 1, 2, 3, 0, time.UTC))
	original := r.Header.Get("Authorization")
	signAlibaba(r, "test-id", "changed-secret", "nonce", time.Date(2026, 10, 15, 1, 2, 3, 0, time.UTC))
	if original == r.Header.Get("Authorization") {
		t.Fatal("signature ignores key")
	}
}
