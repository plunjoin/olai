package server

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"olai/internal/auth"
	"olai/internal/config"
	"olai/internal/httpx"
	"olai/internal/store"
)

func memoryTestApp(t *testing.T) (*Server, *store.DB, string) {
	t.Helper()
	ctx := context.Background()
	db, err := store.Open(ctx, config.Config{DatabaseURL: filepath.Join(t.TempDir(), "test.db")})
	if err != nil {
		t.Fatalf("open temp store: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if _, err := db.ExecContext(ctx, `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES ('u1', 'u1@example.com', 'hash', 0, 0)`); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES ('SETUP_COMPLETED', 'true', 0, 'test')`); err != nil {
		t.Fatalf("mark setup complete: %v", err)
	}
	token := strings.Repeat("a", 64)
	if err := db.CreateSession(ctx, httpx.Hash(token), "u1", time.Now().Add(time.Hour).UnixMilli()); err != nil {
		t.Fatalf("create session: %v", err)
	}
	return New(config.Config{}, db, nil, nil), db, token
}

func memoryRequest(t *testing.T, app *Server, method, target, body, token string) *httptest.ResponseRecorder {
	t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	request := httptest.NewRequest(method, target, reader)
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		request.AddCookie(&http.Cookie{Name: auth.SessionCookie, Value: token})
	}
	recorder := httptest.NewRecorder()
	app.Handler().ServeHTTP(recorder, request)
	return recorder
}

func decodeObject(t *testing.T, recorder *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var value map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &value); err != nil {
		t.Fatalf("decode response %q: %v", recorder.Body.String(), err)
	}
	return value
}

func TestMemoryAPIRoundTrip(t *testing.T) {
	app, db, token := memoryTestApp(t)

	recorder := memoryRequest(t, app, "GET", "/api/memory", "", token)
	if recorder.Code != http.StatusOK {
		t.Fatalf("list status = %d: %s", recorder.Code, recorder.Body.String())
	}
	state := decodeObject(t, recorder)
	if state["enabled"] != true || state["autoCapture"] != false || len(state["memories"].([]any)) != 0 {
		t.Fatalf("unexpected defaults: %#v", state)
	}

	recorder = memoryRequest(t, app, "POST", "/api/memory", `{"content":"  用户叫约翰。  "}`, token)
	if recorder.Code != http.StatusCreated {
		t.Fatalf("create status = %d: %s", recorder.Code, recorder.Body.String())
	}
	created := decodeObject(t, recorder)["memory"].(map[string]any)
	id, _ := created["id"].(string)
	if id == "" || created["content"] != "用户叫约翰。" || created["source"] != "manual" {
		t.Fatalf("unexpected created memory: %#v", created)
	}

	recorder = memoryRequest(t, app, "POST", "/api/memory", `{"content":"用户叫约翰。"}`, token)
	if recorder.Code != http.StatusConflict {
		t.Fatalf("duplicate create status = %d: %s", recorder.Code, recorder.Body.String())
	}

	recorder = memoryRequest(t, app, "PUT", "/api/memory/"+id, `{"content":"用户叫 John。"}`, token)
	if recorder.Code != http.StatusOK {
		t.Fatalf("update status = %d: %s", recorder.Code, recorder.Body.String())
	}

	recorder = memoryRequest(t, app, "GET", "/api/memory", "", token)
	items := decodeObject(t, recorder)["memories"].([]any)
	if len(items) != 1 || items[0].(map[string]any)["content"] != "用户叫 John。" {
		t.Fatalf("list after update: %#v", items)
	}

	// Turning memory off also forces automatic capture off, and chat injection
	// must stop even though the saved note remains.
	recorder = memoryRequest(t, app, "PUT", "/api/memory/settings", `{"enabled":false,"autoCapture":true}`, token)
	if recorder.Code != http.StatusOK {
		t.Fatalf("settings status = %d: %s", recorder.Code, recorder.Body.String())
	}
	saved := decodeObject(t, recorder)
	if saved["enabled"] != false || saved["autoCapture"] != false {
		t.Fatalf("server must force autoCapture off when memory is off: %#v", saved)
	}
	if contents, err := db.ChatMemories(context.Background(), "u1"); err != nil || len(contents) != 0 {
		t.Fatalf("disabled memory injected %#v err=%v", contents, err)
	}

	recorder = memoryRequest(t, app, "DELETE", "/api/memory/"+id, "", token)
	if recorder.Code != http.StatusOK {
		t.Fatalf("delete status = %d: %s", recorder.Code, recorder.Body.String())
	}
	recorder = memoryRequest(t, app, "DELETE", "/api/memory/"+id, "", token)
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("second delete status = %d", recorder.Code)
	}
}

func TestMemoryAPIRequiresAccountAndSameOrigin(t *testing.T) {
	app, _, token := memoryTestApp(t)

	recorder := memoryRequest(t, app, "GET", "/api/memory", "", "")
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous list status = %d", recorder.Code)
	}

	request := httptest.NewRequest("POST", "/api/memory", strings.NewReader(`{"content":"x"}`))
	request.Host = "example.com"
	request.Header.Set("Origin", "https://evil.example")
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(&http.Cookie{Name: auth.SessionCookie, Value: token})
	recorder = httptest.NewRecorder()
	app.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("cross-site create status = %d", recorder.Code)
	}
}

func TestMemoryExtractIsSilentWhenCaptureIsOff(t *testing.T) {
	app, _, token := memoryTestApp(t)
	recorder := memoryRequest(t, app, "POST", "/api/memory/extract", `{"messages":[{"role":"user","content":"我更喜欢简洁的回答"}]}`, token)
	if recorder.Code != http.StatusOK {
		t.Fatalf("extract status = %d: %s", recorder.Code, recorder.Body.String())
	}
	if items := decodeObject(t, recorder)["memories"].([]any); len(items) != 0 {
		t.Fatalf("capture off must create nothing: %#v", items)
	}
}

func TestMemoryContentNormalization(t *testing.T) {
	content, ok := normalizeMemoryContent("  喜欢\n简洁   的回答  ")
	if !ok || content != "喜欢 简洁 的回答" {
		t.Fatalf("normalize = %q ok=%v", content, ok)
	}
	if _, ok := normalizeMemoryContent("   "); ok {
		t.Fatal("blank memory must be rejected")
	}
	if _, ok := normalizeMemoryContent(strings.Repeat("很", 281)); ok {
		t.Fatal("overlong memory must be rejected")
	}
	if _, ok := normalizeMemoryContent(42); ok {
		t.Fatal("non-string memory must be rejected")
	}
}

func TestMemoryTurnsBoundInput(t *testing.T) {
	raw := []any{}
	for index := 0; index < 10; index++ {
		raw = append(raw, map[string]any{"role": "user", "content": strings.Repeat("x", 5000)})
	}
	turns := memoryTurns(raw)
	if len(turns) == 0 || len(turns) > 6 {
		t.Fatalf("turn count = %d", len(turns))
	}
	total := 0
	for _, turn := range turns {
		if len(turn.Content) > 4000 {
			t.Fatalf("turn not truncated: %d", len(turn.Content))
		}
		total += len(turn.Content)
	}
	if total > memoryExtractInput {
		t.Fatalf("extraction input too large: %d", total)
	}
	if got := memoryTurns([]any{map[string]any{"role": "system", "content": "x"}}); len(got) != 0 {
		t.Fatalf("system role must be dropped: %#v", got)
	}
}
