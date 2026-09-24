package provider

import (
 "context"
 "io"
 "net/http"
 "strings"
 "testing"
)
func TestStreamProtocol(t *testing.T){
 good:="data: {\"choices\":[{\"delta\":{\"content\":\"你好\"},\"finish_reason\":null}]}\r\n\r\ndata: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n"
 for _,tt:=range []struct{name,body string;ok bool}{
  {"complete",good,true},
  {"truncated",strings.Split(good,"data: [DONE]")[0],false},
  {"missing_finish","data: [DONE]\n\n",false},
  {"malformed","data: {broken}\n\n",false},
  {"upstream_error","data: {\"error\":{\"message\":\"failure\"}}\n\n",false},
  {"length_limit","data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"length\"}]}\n\n",false},
 }{t.Run(tt.name,func(t *testing.T){var content strings.Builder;err:=parseStream(strings.NewReader(tt.body),func(s string)error{content.WriteString(s);return nil});if (err==nil)!=tt.ok{t.Fatalf("error=%v",err)};if tt.ok&&content.String()!="你好"{t.Fatal(content.String())}})}
}
type transport func(*http.Request)(*http.Response,error)
func(f transport)RoundTrip(r *http.Request)(*http.Response,error){return f(r)}
func TestProviderDoesNotExposeUpstreamBody(t *testing.T){
 p:=NewOpenAI("https://example.test/v1","secret","configured-model")
 p.Client=&http.Client{Transport:transport(func(r *http.Request)(*http.Response,error){if r.URL.Path!="/v1/chat/completions"||r.Header.Get("Authorization")!="Bearer secret"{t.Fatal("invalid provider request")};return &http.Response{StatusCode:429,Body:io.NopCloser(strings.NewReader("sensitive provider details"))},nil})}
 err:=p.Stream(context.Background(),ChatRequest{},func(string)error{return nil});if err==nil||strings.Contains(err.Error(),"sensitive"){t.Fatalf("unsafe error: %v",err)}
}
