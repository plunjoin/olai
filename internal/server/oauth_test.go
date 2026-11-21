package server

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"olai/internal/config"
	"olai/internal/store"
)

func oauthTestServer(t *testing.T) *Server {
	t.Helper()
	ctx := context.Background()
	db, err := store.Open(ctx, config.Config{DatabaseURL: filepath.Join(t.TempDir(), "test.db")})
	if err != nil {
		t.Fatalf("open temp store: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return New(config.Config{}, db, nil, nil)
}

func TestGoogleProfileParsing(t *testing.T) {
	profile, err := parseGoogleProfile(map[string]any{
		"sub":            " 1234567890 ",
		"email":          " User@Example.com ",
		"email_verified": true,
	})
	if err != nil {
		t.Fatalf("parse profile: %v", err)
	}
	if profile.ID != "1234567890" || profile.Email != "user@example.com" {
		t.Fatalf("profile = %#v", profile)
	}
}

func TestGoogleProfileRejectsUntrustedEmails(t *testing.T) {
	cases := []map[string]any{
		{"sub": "1", "email": "a@example.com", "email_verified": false},
		{"sub": "1", "email": "a@example.com"},
		{"sub": "1", "email": "a@example.com", "email_verified": "true"},
		{"sub": "", "email": "a@example.com", "email_verified": true},
		{"sub": "1", "email": "", "email_verified": true},
	}
	for index, object := range cases {
		if _, err := parseGoogleProfile(object); err == nil {
			t.Fatalf("case %d: expected an email error", index)
		} else if oauthErrorCode(err) != "email" {
			t.Fatalf("case %d: error code = %s, want email", index, oauthErrorCode(err))
		}
	}
}

func TestOAuthStartRedirectsPerProvider(t *testing.T) {
	t.Setenv("GOOGLE_CLIENT_ID", "google-id")
	t.Setenv("GOOGLE_CLIENT_SECRET", "google-secret")
	t.Setenv("GITHUB_CLIENT_ID", "github-id")
	t.Setenv("GITHUB_CLIENT_SECRET", "github-secret")
	app := oauthTestServer(t)

	cases := []struct {
		provider   string
		path       string
		authorize  string
		scope      string
		invite     string
		pkce       bool
		extraParam string
	}{
		{"google", "/api/auth/google?invite=abcd1234", "https://accounts.google.com/o/oauth2/v2/auth?", "openid email profile", "ABCD1234", true, "prompt=select_account"},
		{"github", "/api/auth/github", "https://github.com/login/oauth/authorize?", "read:user user:email", "", false, "allow_signup=true"},
	}
	for _, tc := range cases {
		t.Run(tc.provider, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			app.mux.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, tc.path, nil))
			if recorder.Code != http.StatusFound {
				t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
			}
			location := recorder.Header().Get("Location")
			if !strings.HasPrefix(location, tc.authorize) {
				t.Fatalf("location = %s", location)
			}
			parsed, err := url.Parse(location)
			if err != nil {
				t.Fatalf("parse location: %v", err)
			}
			query := parsed.Query()
			if query.Get("client_id") != tc.provider+"-id" {
				t.Fatalf("client_id = %q", query.Get("client_id"))
			}
			if query.Get("redirect_uri") != "http://example.com/api/auth/"+tc.provider+"/callback" {
				t.Fatalf("redirect_uri = %q", query.Get("redirect_uri"))
			}
			if query.Get("scope") != tc.scope {
				t.Fatalf("scope = %q", query.Get("scope"))
			}
			if !strings.Contains(location, tc.extraParam) {
				t.Fatalf("location missing %s: %s", tc.extraParam, location)
			}
			stateCookie := cookieNamed(recorder.Result().Cookies(), oauthStateCookiePrefix+tc.provider)
			if stateCookie == nil {
				t.Fatalf("state cookie %s missing", oauthStateCookiePrefix+tc.provider)
			}
			if stateCookie.Path != "/api/auth/"+tc.provider || stateCookie.HttpOnly != true || stateCookie.SameSite != http.SameSiteLaxMode {
				t.Fatalf("state cookie attributes = %#v", stateCookie)
			}
			if len(stateCookie.Value) < 32 {
				t.Fatalf("state cookie value = %q", stateCookie.Value)
			}
			if tc.invite != "" && !strings.HasSuffix(stateCookie.Value, ":"+tc.invite) {
				t.Fatalf("invite not carried in state: %q", stateCookie.Value)
			}
			stateParam := query.Get("state")
			if len(stateParam) != 32 || strings.Contains(stateParam, ":") {
				t.Fatalf("provider-facing state = %q", stateParam)
			}
			if stateParam != strings.SplitN(stateCookie.Value, ":", 2)[0] {
				t.Fatalf("provider state does not match cookie: %q vs %q", stateParam, stateCookie.Value)
			}
			verifier := cookieNamed(recorder.Result().Cookies(), oauthVerifierCookiePrefix+tc.provider)
			if tc.pkce {
				if query.Get("code_challenge") == "" || query.Get("code_challenge_method") != "S256" {
					t.Fatalf("pkce params missing: %s", location)
				}
				if verifier == nil || len(verifier.Value) != 64 {
					t.Fatalf("verifier cookie = %#v", verifier)
				}
			} else if verifier != nil {
				t.Fatalf("unexpected verifier cookie for %s", tc.provider)
			}
		})
	}
}

func cookieNamed(cookies []*http.Cookie, name string) *http.Cookie {
	for _, cookie := range cookies {
		if cookie.Name == name {
			return cookie
		}
	}
	return nil
}

func TestOAuthCallbackRejectsBadStateAndProviderErrors(t *testing.T) {
	t.Setenv("GOOGLE_CLIENT_ID", "google-id")
	t.Setenv("GOOGLE_CLIENT_SECRET", "google-secret")
	app := oauthTestServer(t)

	cases := []struct {
		path string
		want string
	}{
		{"/api/auth/google/callback?state=deadbeef&code=abc", "http://example.com/login?google_error=state"},
		{"/api/auth/google/callback?error=access_denied", "http://example.com/login?google_error=state"},
	}
	for _, tc := range cases {
		recorder := httptest.NewRecorder()
		app.mux.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, tc.path, nil))
		if recorder.Code != http.StatusFound {
			t.Fatalf("%s: status = %d", tc.path, recorder.Code)
		}
		if got := recorder.Header().Get("Location"); got != tc.want {
			t.Fatalf("%s: location = %q, want %q", tc.path, got, tc.want)
		}
	}
}

func startOAuth(t *testing.T, app *Server, provider string) (string, []*http.Cookie) {
	t.Helper()
	recorder := httptest.NewRecorder()
	app.mux.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/auth/"+provider, nil))
	if recorder.Code != http.StatusFound {
		t.Fatalf("start %s: status = %d", provider, recorder.Code)
	}
	result := recorder.Result()
	state := cookieNamed(result.Cookies(), oauthStateCookiePrefix+provider)
	if state == nil {
		t.Fatalf("start %s: state cookie missing", provider)
	}
	return strings.SplitN(state.Value, ":", 2)[0], result.Cookies()
}

func cookieHeader(cookies ...*http.Cookie) string {
	parts := make([]string, 0, len(cookies))
	for _, cookie := range cookies {
		if cookie != nil {
			parts = append(parts, cookie.Name+"="+cookie.Value)
		}
	}
	return strings.Join(parts, "; ")
}

func TestOAuthCallbackHonorsProviderErrorAfterState(t *testing.T) {
	t.Setenv("GOOGLE_CLIENT_ID", "google-id")
	t.Setenv("GOOGLE_CLIENT_SECRET", "google-secret")
	app := oauthTestServer(t)
	state, cookies := startOAuth(t, app, "google")

	request := httptest.NewRequest(http.MethodGet, "/api/auth/google/callback?state="+state+"&error=access_denied", nil)
	request.Header.Set("Cookie", cookieHeader(cookies...))
	recorder := httptest.NewRecorder()
	app.mux.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusFound {
		t.Fatalf("status = %d", recorder.Code)
	}
	if got := recorder.Header().Get("Location"); got != "http://example.com/login?google_error=denied" {
		t.Fatalf("location = %q", got)
	}
	for _, name := range []string{oauthStateCookiePrefix + "google", oauthVerifierCookiePrefix + "google"} {
		cookie := cookieNamed(recorder.Result().Cookies(), name)
		if cookie == nil || cookie.Value != "" {
			t.Fatalf("cookie %s was not cleared: %#v", name, cookie)
		}
	}
}

func TestOAuthCallbackKeepsCookiesOnBadState(t *testing.T) {
	t.Setenv("GOOGLE_CLIENT_ID", "google-id")
	t.Setenv("GOOGLE_CLIENT_SECRET", "google-secret")
	app := oauthTestServer(t)
	_, cookies := startOAuth(t, app, "google")

	request := httptest.NewRequest(http.MethodGet, "/api/auth/google/callback?state=deadbeef&code=abc", nil)
	request.Header.Set("Cookie", cookieHeader(cookies...))
	recorder := httptest.NewRecorder()
	app.mux.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusFound {
		t.Fatalf("status = %d", recorder.Code)
	}
	if got := recorder.Header().Get("Location"); got != "http://example.com/login?google_error=state" {
		t.Fatalf("location = %q", got)
	}
	for _, name := range []string{oauthStateCookiePrefix + "google", oauthVerifierCookiePrefix + "google"} {
		if cookie := cookieNamed(recorder.Result().Cookies(), name); cookie != nil {
			t.Fatalf("cookie %s cleared before state validation: %#v", name, cookie)
		}
	}
}

func TestGoogleCallbackRequiresPKCEVerifier(t *testing.T) {
	t.Setenv("GOOGLE_CLIENT_ID", "google-id")
	t.Setenv("GOOGLE_CLIENT_SECRET", "google-secret")
	app := oauthTestServer(t)
	state, cookies := startOAuth(t, app, "google")
	stateCookie := cookieNamed(cookies, oauthStateCookiePrefix+"google")

	request := httptest.NewRequest(http.MethodGet, "/api/auth/google/callback?state="+state+"&code=abc", nil)
	request.Header.Set("Cookie", cookieHeader(stateCookie))
	recorder := httptest.NewRecorder()
	app.mux.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusFound {
		t.Fatalf("status = %d", recorder.Code)
	}
	if got := recorder.Header().Get("Location"); got != "http://example.com/login?google_error=token" {
		t.Fatalf("location = %q", got)
	}
}

func TestInjectBootstrapIncludesOAuthFlags(t *testing.T) {
	doc := []byte("<html><head></head><body></body></html>")
	out := string(injectBootstrap(doc, "en", true, false))
	if !strings.Contains(out, `"githubLogin":true`) || !strings.Contains(out, `"googleLogin":false`) {
		t.Fatalf("bootstrap payload missing oauth flags: %s", out)
	}
}

func TestLoginWithOAuthCreatesAndReusesAccount(t *testing.T) {
	app := oauthTestServer(t)
	ctx := context.Background()
	profile := &oauthProfile{ID: "google-sub-1", Email: "new@example.com"}

	user, err := app.loginWithOAuth(ctx, "google", profile, "")
	if err != nil {
		t.Fatalf("first login: %v", err)
	}
	if user.PasswordHash != "oauth:google:google-sub-1" {
		t.Fatalf("password marker = %q", user.PasswordHash)
	}
	if user.EmailVerifiedAt == nil {
		t.Fatal("new oauth account should be email-verified")
	}
	linked, err := app.DB.OAuthUser(ctx, "google", profile.ID)
	if err != nil || linked.ID != user.ID {
		t.Fatalf("oauth link = %#v, %v", linked, err)
	}

	again, err := app.loginWithOAuth(ctx, "google", profile, "")
	if err != nil {
		t.Fatalf("second login: %v", err)
	}
	if again.ID != user.ID {
		t.Fatalf("second login = %s, want %s", again.ID, user.ID)
	}
}

func TestLoginWithOAuthLinksVerifiedAccountWithoutChangingPassword(t *testing.T) {
	app := oauthTestServer(t)
	ctx := context.Background()
	existing, err := app.DB.CreateUser(ctx, "existing", "existing@example.com", "scrypt:keep", true)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	user, err := app.loginWithOAuth(ctx, "google", &oauthProfile{ID: "google-sub", Email: "existing@example.com"}, "")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if user.ID != existing.ID || user.PasswordHash != "scrypt:keep" {
		t.Fatalf("existing account changed: %#v", user)
	}
}

func TestLoginWithOAuthTakesOverUnverifiedAccount(t *testing.T) {
	app := oauthTestServer(t)
	ctx := context.Background()
	existing, err := app.DB.CreateUser(ctx, "unverified", "unverified@example.com", "scrypt:old", false)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	const tokenHash = "old-session"
	if err := app.DB.CreateSession(ctx, tokenHash, existing.ID, time.Now().Add(time.Hour).UnixMilli()); err != nil {
		t.Fatalf("create session: %v", err)
	}
	user, err := app.loginWithOAuth(ctx, "google", &oauthProfile{ID: "google-sub", Email: "unverified@example.com"}, "")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if user.PasswordHash != "oauth:google:google-sub" || user.EmailVerifiedAt == nil {
		t.Fatalf("account was not taken over: %#v", user)
	}
	if _, err := app.DB.SessionUser(ctx, tokenHash); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("old session survived takeover: %v", err)
	}
}

func TestLoginWithOAuthRejectsBannedAccount(t *testing.T) {
	app := oauthTestServer(t)
	ctx := context.Background()
	existing, err := app.DB.CreateUser(ctx, "banned", "banned@example.com", "hash", true)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	if err := app.DB.LinkOAuth(ctx, "google", "google-banned", existing.ID); err != nil {
		t.Fatalf("link oauth: %v", err)
	}
	if err := app.DB.BanUser(ctx, existing.ID, "test", "admin", time.Now().UnixMilli()); err != nil {
		t.Fatalf("ban user: %v", err)
	}
	if _, err := app.loginWithOAuth(ctx, "google", &oauthProfile{ID: "google-banned", Email: "banned@example.com"}, ""); !errors.Is(err, errAccountBanned) {
		t.Fatalf("login error = %v, want errAccountBanned", err)
	}
}

func TestLoginWithOAuthRecordsInviteForNewAccount(t *testing.T) {
	app := oauthTestServer(t)
	ctx := context.Background()
	inviter, err := app.DB.CreateUser(ctx, "inviter", "inviter@example.com", "hash", true)
	if err != nil {
		t.Fatalf("create inviter: %v", err)
	}
	code, err := app.DB.EnsureInviteCode(ctx, inviter.ID)
	if err != nil {
		t.Fatalf("ensure invite code: %v", err)
	}
	user, err := app.loginWithOAuth(ctx, "google", &oauthProfile{ID: "google-sub", Email: "invitee@example.com"}, code)
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	var count int
	if err := app.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM invites WHERE invitee_id = ?`, user.ID).Scan(&count); err != nil {
		t.Fatalf("read invite: %v", err)
	}
	if count != 1 {
		t.Fatalf("invite rows = %d, want 1", count)
	}
}

func TestLoginWithOAuthIgnoresInviteForExistingAccount(t *testing.T) {
	app := oauthTestServer(t)
	ctx := context.Background()
	inviter, err := app.DB.CreateUser(ctx, "inviter", "inviter@example.com", "hash", true)
	if err != nil {
		t.Fatalf("create inviter: %v", err)
	}
	code, err := app.DB.EnsureInviteCode(ctx, inviter.ID)
	if err != nil {
		t.Fatalf("ensure invite code: %v", err)
	}
	for _, tc := range []struct {
		name     string
		verified bool
	}{
		{"verified", true},
		{"unverified", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			email := tc.name + "@example.com"
			existing, err := app.DB.CreateUser(ctx, "existing-"+tc.name, email, "hash", tc.verified)
			if err != nil {
				t.Fatalf("create existing user: %v", err)
			}
			user, err := app.loginWithOAuth(ctx, "google", &oauthProfile{ID: "sub-" + tc.name, Email: email}, code)
			if err != nil {
				t.Fatalf("login: %v", err)
			}
			if user.ID != existing.ID {
				t.Fatalf("login = %s, want existing %s", user.ID, existing.ID)
			}
			var count int
			if err := app.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM invites WHERE invitee_id = ?`, user.ID).Scan(&count); err != nil {
				t.Fatalf("read invite: %v", err)
			}
			if count != 0 {
				t.Fatalf("invite recorded for existing account: %d rows", count)
			}
		})
	}
}
