package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"olai/internal/store"
)

func proxySetting(t *testing.T, db *store.DB, key, value string) {
	t.Helper()
	if _, err := db.ExecContext(context.Background(), `INSERT INTO app_settings (key, value, updated_at, updated_by)
		VALUES (?, ?, 0, 'test') ON CONFLICT (key) DO UPDATE SET value = excluded.value`, key, value); err != nil {
		t.Fatalf("set %s: %v", key, err)
	}
}

func proxyUpstream(t *testing.T) *httptest.Server {
	t.Helper()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("\x89PNG\r\n\x1a\nfake image"))
	}))
	t.Cleanup(upstream.Close)
	return upstream
}

func proxyRequest(app *Server, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPost, "/api/generate/image", strings.NewReader(body))
	request.Host = "example.com"
	request.RemoteAddr = "198.51.100.7:1234"
	request.Header.Set("Origin", "http://example.com")
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	app.Handler().ServeHTTP(recorder, request)
	return recorder
}

func proxyModelSettings(t *testing.T, db *store.DB, upstream *httptest.Server) {
	t.Helper()
	proxySetting(t, db, "AI_API_BASE_URL", upstream.URL)
	proxySetting(t, db, "AI_API_KEY", "test-key")
	proxySetting(t, db, "GUEST_DAILY_GENERATION_LIMIT", "100")
}

func proxyModelHeader(t *testing.T, recorder *httptest.ResponseRecorder) string {
	t.Helper()
	raw := recorder.Header().Get("X-Olai-Model")
	label, err := url.PathUnescape(raw)
	if err != nil {
		t.Fatalf("decode X-Olai-Model %q: %v", raw, err)
	}
	return label
}

func TestProxyStampsServerDefaultModelAlias(t *testing.T) {
	app, db, _ := memoryTestApp(t)
	upstream := proxyUpstream(t)
	proxyModelSettings(t, db, upstream)
	proxySetting(t, db, "AI_IMAGE_MODEL", "upstream-default-image")
	if err := db.UpsertModel(context.Background(), store.ModelRow{
		PublicID: "mdl_cccccccccccccccccccccccc", UpstreamID: "upstream-default-image",
		Alias: "Fake Banana 2", Kind: "image", Enabled: true, Prices: "{}",
	}); err != nil {
		t.Fatalf("upsert model: %v", err)
	}

	recorder := proxyRequest(app, `{"prompt":"a quiet cat"}`)
	if recorder.Code != http.StatusOK {
		t.Fatalf("generation status = %d: %s", recorder.Code, recorder.Body.String())
	}
	// The server default is not selectable in the browser, so its alias must be
	// resolved from the catalog; the upstream ID must never reach the header.
	label := proxyModelHeader(t, recorder)
	if label != "Fake Banana 2" {
		t.Fatalf("X-Olai-Model = %q, want the catalog alias", label)
	}
	if strings.Contains(recorder.Header().Get("X-Olai-Model"), "upstream-default") {
		t.Fatalf("X-Olai-Model leaked the upstream model ID: %q", recorder.Header().Get("X-Olai-Model"))
	}
}

func TestProxyStampsSelectedModelAlias(t *testing.T) {
	app, db, _ := memoryTestApp(t)
	upstream := proxyUpstream(t)
	proxyModelSettings(t, db, upstream)
	proxySetting(t, db, "AI_IMAGE_MODEL", "upstream-default-image")
	const publicID = "mdl_dddddddddddddddddddddddd"
	if err := db.UpsertModel(context.Background(), store.ModelRow{
		PublicID: publicID, UpstreamID: "upstream-chosen-image",
		Alias: "Chosen Model", Kind: "image", Enabled: true, Prices: "{}",
	}); err != nil {
		t.Fatalf("upsert model: %v", err)
	}

	recorder := proxyRequest(app, `{"prompt":"a quiet dog","modelId":"`+publicID+`"}`)
	if recorder.Code != http.StatusOK {
		t.Fatalf("generation status = %d: %s", recorder.Code, recorder.Body.String())
	}
	if label := proxyModelHeader(t, recorder); label != "Chosen Model" {
		t.Fatalf("X-Olai-Model = %q, want the selected alias", label)
	}
	if strings.Contains(recorder.Header().Get("X-Olai-Model"), "upstream-chosen") {
		t.Fatalf("X-Olai-Model leaked the upstream model ID: %q", recorder.Header().Get("X-Olai-Model"))
	}
}
