package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"olai/internal/auth"
)

// sessionGet drives one request through the API mux with exactly the cookies
// given, so tests can plant duplicate and untrusted cookies that a browser
// would never produce through the normal login flow.
func sessionGet(t *testing.T, app *Server, path string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, path, nil)
	for _, cookie := range cookies {
		request.AddCookie(cookie)
	}
	recorder := httptest.NewRecorder()
	app.mux.ServeHTTP(recorder, request)
	return recorder
}

func decodeUserID(t *testing.T, recorder *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct {
		User *struct {
			ID string `json:"id"`
		} `json:"user"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode /api/auth/me: %v", err)
	}
	if body.User == nil {
		return ""
	}
	return body.User.ID
}

func TestPortalSessionCookieTrust(t *testing.T) {
	ctx := context.Background()
	app, user, token := profileTestServer(t)
	other, err := app.DB.CreateUser(ctx, "user-2", "user-2@example.com", "hash", true)
	if err != nil {
		t.Fatalf("create second user: %v", err)
	}
	otherToken := strings.Repeat("d", 64)
	if err := app.DB.CreateSession(ctx, auth.Hash(otherToken), other.ID, time.Now().Add(time.Hour).UnixMilli()); err != nil {
		t.Fatalf("create second session: %v", err)
	}

	bare := &http.Cookie{Name: auth.SessionCookie, Value: token}
	host := &http.Cookie{Name: auth.HostSessionCookie, Value: token}
	otherBare := &http.Cookie{Name: auth.SessionCookie, Value: otherToken}

	cases := []struct {
		name    string
		origin  string
		cookies []*http.Cookie
		wantID  string
	}{
		{"https bare cookie", "https://example.com", []*http.Cookie{bare}, ""},
		{"https host cookie", "https://example.com", []*http.Cookie{host}, user.ID},
		{"https host beats bare", "https://example.com", []*http.Cookie{host, otherBare}, user.ID},
		{"https host ignores duplicate bare", "https://example.com",
			[]*http.Cookie{host, otherBare, otherBare}, user.ID},
		{"https duplicate host", "https://example.com", []*http.Cookie{host, host}, ""},
		{"http bare cookie", "", []*http.Cookie{bare}, user.ID},
		{"http duplicate bare", "", []*http.Cookie{bare, bare}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("SITE_ORIGIN", tc.origin)
			recorder := sessionGet(t, app, "/api/auth/me", tc.cookies...)
			if recorder.Code != http.StatusOK {
				t.Fatalf("/api/auth/me = %d, body = %s", recorder.Code, recorder.Body.String())
			}
			if got := decodeUserID(t, recorder); got != tc.wantID {
				t.Fatalf("user id = %q, want %q", got, tc.wantID)
			}
		})
	}
}

// An HTTPS portal login must issue the same authoritative cookie the read path
// expects; a bare cookie would be ignored on the next request.
func TestPortalLoginIssuesHostCookieOnHTTPS(t *testing.T) {
	ctx := context.Background()
	app, _, _ := profileTestServer(t)
	hash, err := auth.PasswordHash("portal-password", "")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	if _, err := app.DB.CreateUser(ctx, "user-2", "user-2@example.com", hash, true); err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Setenv("SITE_ORIGIN", "https://example.com")

	request := httptest.NewRequest(http.MethodPost, "/api/auth/login",
		strings.NewReader(`{"email":"user-2@example.com","password":"portal-password"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://example.com")
	recorder := httptest.NewRecorder()
	app.mux.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("portal login = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var host, bare *http.Cookie
	for _, cookie := range recorder.Result().Cookies() {
		if cookie.Value == "" {
			continue
		}
		switch cookie.Name {
		case auth.HostSessionCookie:
			host = cookie
		case auth.SessionCookie:
			bare = cookie
		}
	}
	if host == nil || !host.Secure || !host.HttpOnly || host.Path != "/" {
		t.Fatalf("host session cookie = %#v, want Secure HttpOnly Path=/", host)
	}
	if host.Domain != "" {
		t.Fatalf("host session cookie domain = %q, want empty", host.Domain)
	}
	if bare != nil {
		t.Fatalf("HTTPS login also issued bare session cookie %q", bare.Name)
	}
}

// An HTTPS console login must issue the same authoritative cookie the read
// path expects; a bare cookie would be ignored on the next request.
func TestAdminLoginIssuesHostCookieOnHTTPS(t *testing.T) {
	ctx := context.Background()
	app, db := adminTestServer(t)
	hash, err := auth.PasswordHash("admin-password", "")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	if _, err := db.CreateAdminAccount(ctx, "admin-1", "admin@example.com", hash, nil); err != nil {
		t.Fatalf("create admin: %v", err)
	}
	t.Setenv("SITE_ORIGIN", "https://example.com")

	request := httptest.NewRequest(http.MethodPost, "/api/admin/auth/login",
		strings.NewReader(`{"email":"admin@example.com","password":"admin-password"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://example.com")
	recorder := httptest.NewRecorder()
	app.mux.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("admin login = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var host, bare *http.Cookie
	for _, cookie := range recorder.Result().Cookies() {
		if cookie.Value == "" {
			continue
		}
		switch cookie.Name {
		case auth.HostAdminSessionCookie:
			host = cookie
		case auth.AdminSessionCookie:
			bare = cookie
		}
	}
	if host == nil || !host.Secure || !host.HttpOnly || host.Path != "/" {
		t.Fatalf("host admin cookie = %#v, want Secure HttpOnly Path=/", host)
	}
	if host.Domain != "" {
		t.Fatalf("host admin cookie domain = %q, want empty", host.Domain)
	}
	if bare != nil {
		t.Fatalf("HTTPS login also issued bare admin cookie %q", bare.Name)
	}
}

func TestAdminSessionCookieTrust(t *testing.T) {
	ctx := context.Background()
	app, db := adminTestServer(t)
	admin, err := db.CreateAdminAccount(ctx, "admin-1", "admin@example.com", "hash", nil)
	if err != nil {
		t.Fatalf("create admin: %v", err)
	}
	otherAdmin, err := db.CreateAdminAccount(ctx, "admin-2", "other-admin@example.com", "hash", nil)
	if err != nil {
		t.Fatalf("create second admin: %v", err)
	}
	token := strings.Repeat("a", 64)
	otherToken := strings.Repeat("d", 64)
	expires := time.Now().Add(time.Hour).UnixMilli()
	if err := db.CreateAdminSession(ctx, auth.Hash(token), admin.ID, expires); err != nil {
		t.Fatalf("create admin session: %v", err)
	}
	if err := db.CreateAdminSession(ctx, auth.Hash(otherToken), otherAdmin.ID, expires); err != nil {
		t.Fatalf("create second admin session: %v", err)
	}

	bare := &http.Cookie{Name: auth.AdminSessionCookie, Value: token}
	host := &http.Cookie{Name: auth.HostAdminSessionCookie, Value: token}
	otherBare := &http.Cookie{Name: auth.AdminSessionCookie, Value: otherToken}

	cases := []struct {
		name    string
		origin  string
		cookies []*http.Cookie
		status  int
		wantID  string
	}{
		{"https bare cookie", "https://example.com", []*http.Cookie{bare}, http.StatusUnauthorized, ""},
		{"https host cookie", "https://example.com", []*http.Cookie{host}, http.StatusOK, admin.ID},
		{"https host beats bare", "https://example.com", []*http.Cookie{host, otherBare}, http.StatusOK, admin.ID},
		{"https host ignores duplicate bare", "https://example.com",
			[]*http.Cookie{host, otherBare, otherBare}, http.StatusOK, admin.ID},
		{"https duplicate host", "https://example.com", []*http.Cookie{host, host}, http.StatusUnauthorized, ""},
		{"http bare cookie", "", []*http.Cookie{bare}, http.StatusOK, admin.ID},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("SITE_ORIGIN", tc.origin)
			recorder := sessionGet(t, app, "/api/admin/session", tc.cookies...)
			if recorder.Code != tc.status {
				t.Fatalf("/api/admin/session = %d, body = %s", recorder.Code, recorder.Body.String())
			}
			if tc.status != http.StatusOK {
				return
			}
			var body struct {
				Admin struct {
					ID string `json:"id"`
				} `json:"admin"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode /api/admin/session: %v", err)
			}
			if body.Admin.ID != tc.wantID {
				t.Fatalf("admin id = %q, want %q", body.Admin.ID, tc.wantID)
			}
		})
	}
}
