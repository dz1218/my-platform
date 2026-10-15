package auth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"companion/server/pkg/response"
)

type SMSSender interface {
	Configured() bool
	Send(context.Context, string, string) error
}
type AlibabaSMS struct {
	AccessKeyID, AccessKeySecret, SignName, TemplateCode, CodeParameter string
	Client                                                              *http.Client
}

func (s AlibabaSMS) Configured() bool {
	return s.AccessKeyID != "" && s.AccessKeySecret != "" && s.SignName != "" && s.TemplateCode != ""
}
func smsUnavailable() error {
	return &response.Error{Status: 503, Code: "sms_unavailable", Message: "短信发送暂不可用，请稍后再试"}
}

// ACS3 signing contract: https://help.aliyun.com/zh/sdk/product-overview/v3-request-structure-and-signature
func signAlibaba(req *http.Request, keyID, secret, nonce string, now time.Time) {
	empty := sha256.Sum256(nil)
	payload := hex.EncodeToString(empty[:])
	headers := map[string]string{"host": req.URL.Host, "x-acs-action": "SendSmsVerifyCode", "x-acs-version": "2017-05-25", "x-acs-date": now.UTC().Format("2006-01-02T15:04:05Z"), "x-acs-signature-nonce": nonce, "x-acs-content-sha256": payload}
	keys := make([]string, 0, len(headers))
	for k := range headers {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var canonical strings.Builder
	for _, k := range keys {
		canonical.WriteString(k + ":" + headers[k] + "\n")
		if k != "host" {
			req.Header.Set(k, headers[k])
		}
	}
	signedHeaders := strings.Join(keys, ";")
	requestHash := sha256.Sum256([]byte(req.Method + "\n/\n" + req.URL.RawQuery + "\n" + canonical.String() + "\n" + signedHeaders + "\n" + payload))
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte("ACS3-HMAC-SHA256\n" + hex.EncodeToString(requestHash[:])))
	req.Header.Set("Authorization", "ACS3-HMAC-SHA256 Credential="+keyID+",SignedHeaders="+signedHeaders+",Signature="+hex.EncodeToString(mac.Sum(nil)))
}
func (s AlibabaSMS) Send(ctx context.Context, phone, code string) error {
	if !s.Configured() {
		return &response.Error{Status: 503, Code: "sms_not_configured", Message: "短信服务尚未配置完成"}
	}
	parameter := s.CodeParameter
	if parameter == "" {
		parameter = "code"
	}
	template, _ := json.Marshal(map[string]string{parameter: code, "min": "5"})
	query := url.Values{"PhoneNumber": {phone}, "CountryCode": {"86"}, "CodeLength": {"6"}, "ValidTime": {"300"}, "Interval": {"60"}, "ReturnVerifyCode": {"false"}, "AutoRetry": {"0"}, "SignName": {s.SignName}, "TemplateCode": {s.TemplateCode}, "TemplateParam": {string(template)}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://dypnsapi.aliyuncs.com/?"+strings.ReplaceAll(query.Encode(), "+", "%20"), nil)
	if err != nil {
		return smsUnavailable()
	}
	nonce, err := randomToken()
	if err != nil {
		return smsUnavailable()
	}
	signAlibaba(req, s.AccessKeyID, s.AccessKeySecret, nonce, time.Now())
	client := s.Client
	if client == nil {
		client = &http.Client{Timeout: 8 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	res, err := client.Do(req)
	if err != nil {
		return smsUnavailable()
	}
	defer res.Body.Close()
	var result struct {
		Code      string
		RequestID string
		Success   bool
	}
	if json.NewDecoder(io.LimitReader(res.Body, 64<<10)).Decode(&result) != nil {
		return smsUnavailable()
	}
	if res.StatusCode != 200 || result.Code != "OK" || !result.Success {
		// Never log the signed URL, credentials, phone, code, or provider message.
		slog.Warn("SMS provider rejected request", "code", result.Code, "request_id", result.RequestID)
		return smsUnavailable()
	}
	return nil
}
