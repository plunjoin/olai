package server

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

type titleUpstreamRecorder struct {
	mu       sync.Mutex
	payloads []map[string]any
	replies  []string
	status   int
}

func titleUpstream(t *testing.T, replies ...string) (*httptest.Server, *titleUpstreamRecorder) {
	t.Helper()
	recorder := &titleUpstreamRecorder{replies: replies}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var payload map[string]any
		_ = json.Unmarshal(body, &payload)
		recorder.mu.Lock()
		recorder.payloads = append(recorder.payloads, payload)
		reply := "夏日海风"
		if len(recorder.replies) > 0 {
			reply = recorder.replies[0]
			recorder.replies = recorder.replies[1:]
		}
		status := recorder.status
		recorder.mu.Unlock()
		if status != 0 {
			w.WriteHeader(status)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []any{map[string]any{"message": map[string]any{"content": reply}}},
		})
	}))
	t.Cleanup(upstream.Close)
	return upstream, recorder
}

func (r *titleUpstreamRecorder) call(t *testing.T, index int) map[string]any {
	t.Helper()
	r.mu.Lock()
	defer r.mu.Unlock()
	if index >= len(r.payloads) {
		t.Fatalf("upstream call %d missing, got %d", index, len(r.payloads))
	}
	return r.payloads[index]
}

func titleRequest(t *testing.T, app *Server, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/api/title", strings.NewReader(body))
	request.Host = "example.com"
	request.RemoteAddr = "198.51.100.20:1234"
	request.Header.Set("Origin", "http://example.com")
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	app.Handler().ServeHTTP(recorder, request)
	return recorder
}

func decodeTitle(t *testing.T, recorder *httptest.ResponseRecorder) string {
	t.Helper()
	var result struct {
		Title string `json:"title"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode title %q: %v", recorder.Body.String(), err)
	}
	return result.Title
}

func titleMessage(payload map[string]any, index int) string {
	messages, _ := payload["messages"].([]any)
	if index >= len(messages) {
		return ""
	}
	message, _ := messages[index].(map[string]any)
	content, _ := message["content"].(string)
	return content
}

// Titles must use the configured default chat model (AI_CHAT_MODEL) and write
// in the language the client is currently using.
func TestTitleUsesDefaultChatModelAndLocale(t *testing.T) {
	app, db, _ := memoryTestApp(t)
	upstream, recorder := titleUpstream(t, "“ 夏日海风。 ", "A quiet harbor")
	proxyModelSettings(t, db, upstream)
	proxySetting(t, db, "AI_CHAT_MODEL", "default-chat-model")
	proxySetting(t, db, "AI_IMAGE_MODEL", "image-model")

	response := titleRequest(t, app, `{"kind":"work","text":"一片安静的海，傍晚的浪","locale":"zh-CN"}`)
	if response.Code != http.StatusOK {
		t.Fatalf("zh title = %d body=%s", response.Code, response.Body.String())
	}
	if title := decodeTitle(t, response); title != "夏日海风" {
		t.Fatalf("zh title = %q, want cleaned title", title)
	}
	payload := recorder.call(t, 0)
	if payload["model"] != "default-chat-model" {
		t.Fatalf("model = %v, want the configured default chat model", payload["model"])
	}
	zhPrompt := titleMessage(payload, 1)
	for _, want := range []string{"中文标题", "一片安静的海，傍晚的浪"} {
		if !strings.Contains(zhPrompt, want) {
			t.Fatalf("zh prompt missing %q: %s", want, zhPrompt)
		}
	}

	// The body locale wins even when the request headers would detect Chinese.
	response = titleRequest(t, app, `{"kind":"conversation","text":"Help me plan a quiet weekend","reply":"Sure, let's start with Saturday.","locale":"en"}`)
	if response.Code != http.StatusOK {
		t.Fatalf("en title = %d body=%s", response.Code, response.Body.String())
	}
	if title := decodeTitle(t, response); title != "A quiet harbor" {
		t.Fatalf("en title = %q", title)
	}
	enPayload := recorder.call(t, 1)
	enPrompt := titleMessage(enPayload, 1)
	for _, want := range []string{"English title", "Help me plan a quiet weekend", "Sure, let's start with Saturday."} {
		if !strings.Contains(enPrompt, want) {
			t.Fatalf("en prompt missing %q: %s", want, enPrompt)
		}
	}
	if strings.Contains(enPrompt, "中文") {
		t.Fatalf("English title prompt must not ask for Chinese: %s", enPrompt)
	}
}

// A failing or unconfigured model must not turn into a user-visible error: the
// client keeps its local fallback title.
func TestTitleFallsBackQuietly(t *testing.T) {
	t.Setenv("AI_API_KEY", "")
	t.Setenv("AI_API_BASE_URL", "")
	app, _, _ := memoryTestApp(t)
	response := titleRequest(t, app, `{"kind":"work","text":"海边日落","locale":"zh-CN"}`)
	if response.Code != http.StatusOK || decodeTitle(t, response) != "" {
		t.Fatalf("unconfigured title = %d %q", response.Code, response.Body.String())
	}

	app, db, _ := memoryTestApp(t)
	upstream, recorder := titleUpstream(t)
	recorder.status = http.StatusBadGateway
	proxyModelSettings(t, db, upstream)
	response = titleRequest(t, app, `{"kind":"conversation","text":"聊聊今天","locale":"zh-CN"}`)
	if response.Code != http.StatusOK || decodeTitle(t, response) != "" {
		t.Fatalf("failed upstream title = %d %q", response.Code, response.Body.String())
	}
}

func TestTitleRejectsInvalidRequests(t *testing.T) {
	app, _, _ := memoryTestApp(t)
	if response := titleRequest(t, app, `{"kind":"video","text":"x"}`); response.Code != http.StatusBadRequest {
		t.Fatalf("bad kind = %d body=%s", response.Code, response.Body.String())
	}
	if response := titleRequest(t, app, `{"kind":"work","text":"   "}`); response.Code != http.StatusBadRequest {
		t.Fatalf("blank text = %d body=%s", response.Code, response.Body.String())
	}
	request := httptest.NewRequest(http.MethodPost, "/api/title", strings.NewReader(`{"kind":"work","text":"x"}`))
	request.Host = "example.com"
	request.Header.Set("Origin", "https://attacker.example")
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	app.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("cross-origin title = %d body=%s", recorder.Code, recorder.Body.String())
	}
}
