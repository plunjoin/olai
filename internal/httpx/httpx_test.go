package httpx

import (
	"context"
	"crypto/tls"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"olai/internal/config"
	"olai/internal/settings"
	"olai/internal/store"
)

func newSettingsManager(t *testing.T) *settings.Manager {
	t.Helper()
	db, err := store.Open(context.Background(), config.Config{DatabaseURL: filepath.Join(t.TempDir(), "httpx.db")})
	if err != nil {
		t.Fatalf("open temp store: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return settings.New(db)
}

func TestSecureRequest(t *testing.T) {
	manager := newSettingsManager(t)
	cases := []struct {
		name            string
		origin          string
		trustProxy      string
		forwardedProto  string
		secureTransport bool
		want            bool
	}{
		{"plain http", "", "false", "", false, false},
		{"direct tls", "", "false", "", true, true},
		{"https site origin", "https://example.com", "false", "", false, true},
		{"http site origin", "http://example.com", "false", "", false, false},
		{"trusted proxy https", "", "true", "https", false, true},
		{"trusted proxy first value", "", "true", "https, http", false, true},
		{"trusted proxy uppercase", "", "true", "HTTPS", false, true},
		{"trusted proxy http", "", "true", "http", false, false},
		{"trusted proxy http first value", "", "true", "http, https", false, false},
		{"untrusted proxy https", "", "false", "https", false, false},
		{"http origin with trusted proxy https", "http://example.com", "true", "https", false, true},
		{"https origin with untrusted proxy http", "https://example.com", "false", "http", false, true},
		{"http origin with direct tls", "http://example.com", "false", "", true, true},
		{"malformed origin fails closed", "example.com", "false", "", false, true},
		{"opaque http origin fails closed", "http:example.com", "false", "", false, true},
		{"port-only http origin fails closed", "http://:8080", "false", "", false, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("SITE_ORIGIN", tc.origin)
			t.Setenv("TRUST_PROXY", tc.trustProxy)
			request := httptest.NewRequest(http.MethodGet, "http://example.test/api/status", nil)
			if tc.secureTransport {
				request.TLS = &tls.ConnectionState{}
			}
			if tc.forwardedProto != "" {
				request.Header.Set("X-Forwarded-Proto", tc.forwardedProto)
			}
			if got := SecureRequest(request, manager); got != tc.want {
				t.Fatalf("SecureRequest = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestSameOrigin(t *testing.T) {
	manager := newSettingsManager(t)
	cases := []struct {
		name            string
		origin          string
		trustProxy      string
		forwardedProto  string
		secureTransport bool
		originHeader    string
		want            bool
	}{
		{"plain http", "", "false", "", false, "http://example.test", true},
		{"plain https mismatch", "", "false", "", false, "https://example.test", false},
		{"direct tls", "", "false", "", true, "https://example.test", true},
		{"direct tls http mismatch", "", "false", "", true, "http://example.test", false},
		{"trusted proxy https", "", "true", "https", false, "https://example.test", true},
		{"trusted proxy https http mismatch", "", "true", "https", false, "http://example.test", false},
		{"untrusted proxy https", "", "false", "https", false, "https://example.test", false},
		{"configured origin", "https://example.com", "false", "", false, "https://example.com", true},
		{"configured origin default port", "https://example.com:443", "false", "", false, "https://example.com", true},
		{"configured origin host mismatch", "https://example.com", "false", "", false, "https://example.test", false},
		{"missing origin header", "", "false", "", false, "", false},
		{"null origin header", "", "false", "", false, "null", false},
		{"https origin rejects http origin on its host", "https://example.test", "false", "", false, "http://example.test", false},
		{"http origin with trusted proxy https", "http://example.test", "true", "https", false, "https://example.test", true},
		{"http origin with direct tls", "http://example.test", "false", "", true, "https://example.test", true},
		{"hostless origin falls back", "http:example.com", "false", "", false, "http://example.test", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("SITE_ORIGIN", tc.origin)
			t.Setenv("TRUST_PROXY", tc.trustProxy)
			request := httptest.NewRequest(http.MethodPost, "http://example.test/api/auth/login", nil)
			if tc.secureTransport {
				request.TLS = &tls.ConnectionState{}
			}
			if tc.forwardedProto != "" {
				request.Header.Set("X-Forwarded-Proto", tc.forwardedProto)
			}
			request.Header.Set("Origin", tc.originHeader)
			if got := SameOrigin(request, manager); got != tc.want {
				t.Fatalf("SameOrigin = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestRequestOrigin(t *testing.T) {
	manager := newSettingsManager(t)
	cases := []struct {
		name            string
		origin          string
		trustProxy      string
		forwardedProto  string
		secureTransport bool
		want            string
	}{
		{"plain http", "", "false", "", false, "http://example.test"},
		{"direct tls", "", "false", "", true, "https://example.test"},
		{"trusted proxy https", "", "true", "https", false, "https://example.test"},
		{"trusted proxy http", "", "true", "http", false, "http://example.test"},
		{"untrusted proxy https", "", "false", "https", false, "http://example.test"},
		{"configured origin wins", "https://example.com", "false", "", false, "https://example.com"},
		{"configured origin canonicalized", "HTTPS://Example.COM:443/", "false", "", false, "https://example.com"},
		{"configured origin beats proxy", "http://example.com", "true", "https", false, "http://example.com"},
		{"malformed origin falls back", "http:example.com", "false", "", false, "http://example.test"},
		{"opaque origin falls back to proxy", "http:example.com", "true", "https", false, "https://example.test"},
		{"port-only origin falls back", "http://:8080", "false", "", false, "http://example.test"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("SITE_ORIGIN", tc.origin)
			t.Setenv("TRUST_PROXY", tc.trustProxy)
			request := httptest.NewRequest(http.MethodGet, "http://example.test/api/status", nil)
			if tc.secureTransport {
				request.TLS = &tls.ConnectionState{}
			}
			if tc.forwardedProto != "" {
				request.Header.Set("X-Forwarded-Proto", tc.forwardedProto)
			}
			if got := RequestOrigin(request, manager); got != tc.want {
				t.Fatalf("RequestOrigin = %q, want %q", got, tc.want)
			}
		})
	}
}
