package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"testing"
	"time"

	"olai/internal/auth"
	"olai/internal/config"
	"olai/internal/store"
)

func adminTestServer(t *testing.T) (*Server, *store.DB) {
	t.Helper()
	ctx := context.Background()
	db, err := store.Open(ctx, config.Config{DatabaseURL: filepath.Join(t.TempDir(), "test.db")})
	if err != nil {
		t.Fatalf("open temp store: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if _, err := db.ExecContext(ctx, `INSERT INTO app_settings (key, value, updated_at, updated_by)
		VALUES ('SETUP_COMPLETED', 'true', ?, 'test')`, time.Now().UnixMilli()); err != nil {
		t.Fatalf("mark setup complete: %v", err)
	}
	return New(config.Config{}, db, nil, nil), db
}

func adminPost(t *testing.T, url string, body any, cookies ...*http.Cookie) *http.Response {
	t.Helper()
	data, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal body: %v", err)
	}
	request, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", originOf(url))
	for _, cookie := range cookies {
		request.AddCookie(cookie)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("post %s: %v", url, err)
	}
	return response
}

func adminGet(t *testing.T, url string, cookies ...*http.Cookie) *http.Response {
	t.Helper()
	request, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	request.Header.Set("Accept", "application/json")
	for _, cookie := range cookies {
		request.AddCookie(cookie)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("get %s: %v", url, err)
	}
	return response
}

func originOf(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return parsed.Scheme + "://" + parsed.Host
}

func sessionCookie(t *testing.T, response *http.Response, name string) *http.Cookie {
	t.Helper()
	var found *http.Cookie
	for _, cookie := range response.Cookies() {
		if cookie.Name == name && cookie.Value != "" {
			found = cookie
		}
	}
	if found == nil {
		t.Fatalf("response did not set cookie %s", name)
	}
	return found
}

func TestSetupCreatesOnlyAConsoleAccount(t *testing.T) {
	ctx := context.Background()
	db, err := store.Open(ctx, config.Config{DatabaseURL: filepath.Join(t.TempDir(), "test.db")})
	if err != nil {
		t.Fatalf("open temp store: %v", err)
	}
	defer db.Close()
	app := New(config.Config{}, db, nil, nil)
	server := httptest.NewServer(app.Handler())
	defer server.Close()

	response := adminPost(t, server.URL+"/api/setup", map[string]any{
		"email": "first-admin@example.com", "password": "setup-password", "name": "First Admin",
	})
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("setup = %d, want 201", response.StatusCode)
	}
	var state struct {
		AdminPath string `json:"adminPath"`
		LoginPath string `json:"loginPath"`
	}
	if err := json.NewDecoder(response.Body).Decode(&state); err != nil {
		t.Fatalf("decode setup response: %v", err)
	}
	response.Body.Close()
	if state.LoginPath != state.AdminPath+"/login" {
		t.Fatalf("loginPath = %q, adminPath = %q", state.LoginPath, state.AdminPath)
	}
	if _, err := db.AdminByEmail(ctx, "first-admin@example.com"); err != nil {
		t.Fatalf("setup did not create the console account: %v", err)
	}
	var users int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&users); err != nil {
		t.Fatalf("count portal users: %v", err)
	}
	if users != 0 {
		t.Fatalf("setup created %d portal users, want 0", users)
	}

	response = adminPost(t, server.URL+"/api/admin/auth/login", map[string]any{
		"email": "first-admin@example.com", "password": "setup-password",
	})
	if response.StatusCode != http.StatusOK {
		t.Fatalf("login with the setup account = %d, want 200", response.StatusCode)
	}
	response.Body.Close()
}

func TestAdminConsoleLoginIsIndependentFromPortal(t *testing.T) {
	ctx := context.Background()
	app, db := adminTestServer(t)
	adminHash, err := auth.PasswordHash("admin-password", "")
	if err != nil {
		t.Fatalf("hash admin password: %v", err)
	}
	if _, err := db.CreateAdminAccount(ctx, "admin1", "admin@example.com", adminHash, nil); err != nil {
		t.Fatalf("create admin: %v", err)
	}
	portalHash, err := auth.PasswordHash("portal-password", "")
	if err != nil {
		t.Fatalf("hash portal password: %v", err)
	}
	user, err := db.CreateUser(ctx, "user1", "user@example.com", portalHash, true)
	if err != nil {
		t.Fatalf("create portal user: %v", err)
	}
	server := httptest.NewServer(app.Handler())
	defer server.Close()

	// A portal email/password pair is not an admin credential.
	response := adminPost(t, server.URL+"/api/admin/auth/login", map[string]any{
		"email": "user@example.com", "password": "portal-password",
	})
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("portal credentials on admin login = %d, want 401", response.StatusCode)
	}
	response.Body.Close()

	response = adminPost(t, server.URL+"/api/admin/auth/login", map[string]any{
		"email": "admin@example.com", "password": "admin-password",
	})
	if response.StatusCode != http.StatusOK {
		t.Fatalf("admin login = %d, want 200", response.StatusCode)
	}
	adminCookie := sessionCookie(t, response, auth.AdminSessionCookie)
	response.Body.Close()

	// The admin cookie does not sign the browser into the portal.
	request, _ := http.NewRequest(http.MethodGet, server.URL+"/api/auth/me", nil)
	request.AddCookie(adminCookie)
	me, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("portal me with admin cookie: %v", err)
	}
	var meState struct {
		User any `json:"user"`
	}
	if err := json.NewDecoder(me.Body).Decode(&meState); err != nil {
		t.Fatalf("decode portal me: %v", err)
	}
	me.Body.Close()
	if me.StatusCode != http.StatusOK || meState.User != nil {
		t.Fatalf("admin cookie must not sign into the portal, status %d user %v", me.StatusCode, meState.User)
	}

	// The portal cookie does not authorize the console.
	recorder := httptest.NewRecorder()
	sessionRequest := httptest.NewRequest(http.MethodPost, "/api/auth/login", nil)
	if err := app.Auth.StartSession(ctx, recorder, sessionRequest, user.ID); err != nil {
		t.Fatalf("start portal session: %v", err)
	}
	portalCookie := sessionCookie(t, recorder.Result(), auth.SessionCookie)

	response = adminGet(t, server.URL+"/api/admin/session", portalCookie)
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("portal cookie on admin session = %d, want 401", response.StatusCode)
	}
	response.Body.Close()

	response = adminGet(t, server.URL+"/api/admin/session", adminCookie)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("admin cookie on admin session = %d, want 200", response.StatusCode)
	}
	response.Body.Close()

	// Logging out of the console leaves the portal session untouched.
	response = adminPost(t, server.URL+"/api/admin/auth/logout", map[string]any{}, adminCookie)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("admin logout = %d, want 200", response.StatusCode)
	}
	response.Body.Close()

	response = adminGet(t, server.URL+"/api/admin/session", adminCookie)
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("revoked admin cookie = %d, want 401", response.StatusCode)
	}
	response.Body.Close()

	request, _ = http.NewRequest(http.MethodGet, server.URL+"/api/auth/me", nil)
	request.AddCookie(portalCookie)
	me, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("portal me after admin logout: %v", err)
	}
	if err := json.NewDecoder(me.Body).Decode(&meState); err != nil {
		t.Fatalf("decode portal me after admin logout: %v", err)
	}
	me.Body.Close()
	if me.StatusCode != http.StatusOK || meState.User == nil {
		t.Fatalf("admin logout must not end the portal session, status %d user %v", me.StatusCode, meState.User)
	}
}

func TestAdminSettingsAdvertisesOAuthCallbackURLs(t *testing.T) {
	ctx := context.Background()
	app, db := adminTestServer(t)
	hash, err := auth.PasswordHash("admin-password", "")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	if _, err := db.CreateAdminAccount(ctx, "admin1", "admin@example.com", hash, nil); err != nil {
		t.Fatalf("create admin: %v", err)
	}
	server := httptest.NewServer(app.Handler())
	defer server.Close()

	response := adminPost(t, server.URL+"/api/admin/auth/login", map[string]any{
		"email": "admin@example.com", "password": "admin-password",
	})
	if response.StatusCode != http.StatusOK {
		t.Fatalf("admin login = %d, want 200", response.StatusCode)
	}
	adminCookie := sessionCookie(t, response, auth.AdminSessionCookie)
	response.Body.Close()

	response = adminGet(t, server.URL+"/api/admin/settings", adminCookie)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("admin settings = %d, want 200", response.StatusCode)
	}
	var payload struct {
		OAuthCallbacks map[string]string `json:"oauthCallbacks"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode admin settings: %v", err)
	}
	response.Body.Close()

	for _, provider := range []string{"github", "google"} {
		got := payload.OAuthCallbacks[provider]
		if got == "" {
			t.Fatalf("oauthCallbacks missing %s", provider)
		}
		want := server.URL + "/api/auth/" + provider + "/callback"
		if got != want {
			t.Fatalf("oauthCallbacks[%s] = %q, want %q", provider, got, want)
		}
	}
}

func TestAdminPasswordChangeRotatesSessions(t *testing.T) {
	ctx := context.Background()
	app, db := adminTestServer(t)
	hash, err := auth.PasswordHash("old-password", "")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	if _, err := db.CreateAdminAccount(ctx, "admin1", "admin@example.com", hash, nil); err != nil {
		t.Fatalf("create admin: %v", err)
	}
	server := httptest.NewServer(app.Handler())
	defer server.Close()

	response := adminPost(t, server.URL+"/api/admin/auth/login", map[string]any{
		"email": "admin@example.com", "password": "old-password",
	})
	if response.StatusCode != http.StatusOK {
		t.Fatalf("admin login = %d, want 200", response.StatusCode)
	}
	oldCookie := sessionCookie(t, response, auth.AdminSessionCookie)
	response.Body.Close()

	response = adminPost(t, server.URL+"/api/admin/auth/password", map[string]any{
		"currentPassword": "old-password", "password": "new-password",
	}, oldCookie)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("change admin password = %d, want 200", response.StatusCode)
	}
	newCookie := sessionCookie(t, response, auth.AdminSessionCookie)
	response.Body.Close()
	if newCookie.Value == oldCookie.Value {
		t.Fatal("password change must rotate the admin session token")
	}

	response = adminGet(t, server.URL+"/api/admin/session", oldCookie)
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("old admin cookie = %d, want 401", response.StatusCode)
	}
	response.Body.Close()
	response = adminGet(t, server.URL+"/api/admin/session", newCookie)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("rotated admin cookie = %d, want 200", response.StatusCode)
	}
	response.Body.Close()

	response = adminPost(t, server.URL+"/api/admin/auth/login", map[string]any{
		"email": "admin@example.com", "password": "old-password",
	})
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("old password after change = %d, want 401", response.StatusCode)
	}
	response.Body.Close()
	response = adminPost(t, server.URL+"/api/admin/auth/login", map[string]any{
		"email": "admin@example.com", "password": "new-password",
	})
	if response.StatusCode != http.StatusOK {
		t.Fatalf("new password after change = %d, want 200", response.StatusCode)
	}
	response.Body.Close()
}
