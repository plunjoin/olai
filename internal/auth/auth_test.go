package auth

import (
	"context"
	"crypto/tls"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"olai/internal/config"
	"olai/internal/settings"
	"olai/internal/store"
)

func newAuthTestManager(t *testing.T) (*Manager, *store.DB) {
	t.Helper()
	db, err := store.Open(context.Background(), config.Config{DatabaseURL: filepath.Join(t.TempDir(), "auth.db")})
	if err != nil {
		t.Fatalf("open temp store: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return &Manager{DB: db, Settings: settings.New(db)}, db
}

func createTestUser(t *testing.T, db *store.DB, id, email string) *store.User {
	t.Helper()
	user, err := db.CreateUser(context.Background(), id, email, "hash", true)
	if err != nil {
		t.Fatalf("create user %s: %v", id, err)
	}
	return user
}

func createTestSession(t *testing.T, db *store.DB, userID, token string) {
	t.Helper()
	if err := db.CreateSession(context.Background(), Hash(token), userID, time.Now().Add(time.Hour).UnixMilli()); err != nil {
		t.Fatalf("create session for %s: %v", userID, err)
	}
}

func sessionRequest(secureTransport bool, cookies ...*http.Cookie) *http.Request {
	request := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	if secureTransport {
		request.TLS = &tls.ConnectionState{}
	}
	for _, cookie := range cookies {
		request.AddCookie(cookie)
	}
	return request
}

func TestCurrentUserRequiresTrustedSession(t *testing.T) {
	ctx := context.Background()
	manager, db := newAuthTestManager(t)
	token := strings.Repeat("a", 64)
	user := createTestUser(t, db, "user-1", "user@example.com")
	createTestSession(t, db, user.ID, token)
	otherToken := strings.Repeat("d", 64)
	other := createTestUser(t, db, "user-2", "other@example.com")
	createTestSession(t, db, other.ID, otherToken)

	bare := &http.Cookie{Name: SessionCookie, Value: token}
	host := &http.Cookie{Name: HostSessionCookie, Value: token}
	otherBare := &http.Cookie{Name: SessionCookie, Value: otherToken}

	cases := []struct {
		name            string
		origin          string
		trustProxy      bool
		forwardedProto  string
		secureTransport bool
		cookies         []*http.Cookie
		want            bool
		trusted         bool
	}{
		{"http bare cookie", "", false, "", false, []*http.Cookie{bare}, true, true},
		{"https bare cookie", "https://example.com", false, "", false, []*http.Cookie{bare}, false, false},
		{"https uppercase scheme", "HTTPS://Example.com", false, "", false, []*http.Cookie{bare}, false, false},
		{"https host cookie", "https://example.com", false, "", false, []*http.Cookie{host}, true, true},
		{"https host and bare", "https://example.com", false, "", false, []*http.Cookie{host, bare}, true, true},
		{"https host beats bare", "https://example.com", false, "", false, []*http.Cookie{host, otherBare}, true, true},
		{"https host ignores duplicate bare", "https://example.com", false, "", false,
			[]*http.Cookie{host, otherBare, otherBare}, true, true},
		{"https empty host and bare", "https://example.com", false, "", false,
			[]*http.Cookie{{Name: HostSessionCookie, Value: ""}, bare}, false, false},
		{"tls bare cookie", "", false, "", true, []*http.Cookie{bare}, false, false},
		{"tls host cookie", "", false, "", true, []*http.Cookie{host}, true, true},
		{"trusted proxy https bare", "", true, "https", false, []*http.Cookie{bare}, false, false},
		{"trusted proxy https host", "", true, "https", false, []*http.Cookie{host}, true, true},
		{"untrusted proxy https bare", "", false, "https", false, []*http.Cookie{bare}, true, true},
		{"https duplicate bare", "https://example.com", false, "", false, []*http.Cookie{bare, bare}, false, false},
		{"https duplicate host", "https://example.com", false, "", false, []*http.Cookie{host, host}, false, false},
		{"http duplicate bare", "", false, "", false, []*http.Cookie{bare, bare}, false, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("SITE_ORIGIN", tc.origin)
			trustProxy := "false"
			if tc.trustProxy {
				trustProxy = "true"
			}
			t.Setenv("TRUST_PROXY", trustProxy)
			request := sessionRequest(tc.secureTransport, tc.cookies...)
			if tc.forwardedProto != "" {
				request.Header.Set("X-Forwarded-Proto", tc.forwardedProto)
			}
			got, err := manager.CurrentUser(ctx, request)
			if err != nil {
				t.Fatalf("current user: %v", err)
			}
			if (got != nil) != tc.want {
				t.Fatalf("current user = %#v, want user=%v", got, tc.want)
			}
			if got != nil && got.ID != user.ID {
				t.Fatalf("current user = %s, want %s", got.ID, user.ID)
			}
			if trusted := manager.TrustsSession(request); trusted != tc.trusted {
				t.Fatalf("TrustsSession = %v, want %v", trusted, tc.trusted)
			}
		})
	}
}

func TestClaimEmailTokenIgnoresUntrustedBareSession(t *testing.T) {
	ctx := context.Background()
	manager, db := newAuthTestManager(t)
	owner := createTestUser(t, db, "owner", "owner@example.com")
	attacker := createTestUser(t, db, "attacker", "attacker@example.com")
	attackerToken := strings.Repeat("b", 64)
	createTestSession(t, db, attacker.ID, attackerToken)
	ownerToken := strings.Repeat("e", 64)
	createTestSession(t, db, owner.ID, ownerToken)

	attackerBare := &http.Cookie{Name: SessionCookie, Value: attackerToken}
	attackerHost := &http.Cookie{Name: HostSessionCookie, Value: attackerToken}
	ownerHost := &http.Cookie{Name: HostSessionCookie, Value: ownerToken}

	issue := func(t *testing.T) string {
		t.Helper()
		token, err := manager.IssueEmailToken(ctx, owner.ID, "reset")
		if err != nil {
			t.Fatalf("issue email token: %v", err)
		}
		return token
	}
	claimRequest := func(t *testing.T, request *http.Request, emailToken string) EmailLinkClaim {
		t.Helper()
		result, err := manager.ClaimEmailToken(ctx, httptest.NewRecorder(), request, emailToken, "reset")
		if err != nil {
			t.Fatalf("claim email token: %v", err)
		}
		return result
	}
	claim := func(t *testing.T, emailToken string, cookies ...*http.Cookie) EmailLinkClaim {
		t.Helper()
		return claimRequest(t, sessionRequest(false, cookies...), emailToken)
	}
	consumed := func(t *testing.T, emailToken string) bool {
		t.Helper()
		_, err := manager.PeekEmailToken(ctx, emailToken, "reset")
		return err != nil
	}

	t.Run("https bare session claims anonymously", func(t *testing.T) {
		t.Setenv("SITE_ORIGIN", "https://example.com")
		emailToken := issue(t)
		result := claim(t, emailToken, attackerBare)
		if !result.OK || result.UserID != owner.ID || result.Active {
			t.Fatalf("claim = %#v", result)
		}
		if !consumed(t, emailToken) {
			t.Fatal("email token was not consumed")
		}
	})

	t.Run("https host session from another account blocks the claim", func(t *testing.T) {
		t.Setenv("SITE_ORIGIN", "https://example.com")
		emailToken := issue(t)
		result := claim(t, emailToken, attackerHost)
		if result.OK || result.Reason != "account-switch" {
			t.Fatalf("claim = %#v, want account-switch", result)
		}
		if consumed(t, emailToken) {
			t.Fatal("account-switch consumed the token")
		}
	})

	t.Run("https owner host session claims despite duplicate bare cookies", func(t *testing.T) {
		t.Setenv("SITE_ORIGIN", "https://example.com")
		emailToken := issue(t)
		result := claim(t, emailToken, ownerHost, attackerBare, attackerBare)
		if !result.OK || result.UserID != owner.ID || !result.Active {
			t.Fatalf("claim = %#v", result)
		}
		if !consumed(t, emailToken) {
			t.Fatal("email token was not consumed")
		}
	})

	t.Run("http duplicate bare session is ambiguous", func(t *testing.T) {
		t.Setenv("SITE_ORIGIN", "")
		emailToken := issue(t)
		result := claim(t, emailToken, attackerBare, attackerBare)
		if result.OK || result.Reason != "ambiguous-session" {
			t.Fatalf("claim = %#v, want ambiguous-session", result)
		}
		if consumed(t, emailToken) {
			t.Fatal("ambiguous-session consumed the token")
		}
	})

	t.Run("https duplicate host session is ambiguous", func(t *testing.T) {
		t.Setenv("SITE_ORIGIN", "https://example.com")
		emailToken := issue(t)
		result := claim(t, emailToken, ownerHost, ownerHost)
		if result.OK || result.Reason != "ambiguous-session" {
			t.Fatalf("claim = %#v, want ambiguous-session", result)
		}
		if consumed(t, emailToken) {
			t.Fatal("ambiguous-session consumed the token")
		}
	})

	t.Run("tls owner host session claims despite duplicate bare cookies", func(t *testing.T) {
		t.Setenv("SITE_ORIGIN", "")
		t.Setenv("TRUST_PROXY", "false")
		emailToken := issue(t)
		request := sessionRequest(true, ownerHost, attackerBare, attackerBare)
		result := claimRequest(t, request, emailToken)
		if !result.OK || result.UserID != owner.ID || !result.Active {
			t.Fatalf("claim = %#v", result)
		}
		if !consumed(t, emailToken) {
			t.Fatal("email token was not consumed")
		}
	})

	t.Run("trusted proxy https bare session claims anonymously", func(t *testing.T) {
		t.Setenv("SITE_ORIGIN", "")
		t.Setenv("TRUST_PROXY", "true")
		emailToken := issue(t)
		request := sessionRequest(false, attackerBare)
		request.Header.Set("X-Forwarded-Proto", "https")
		result := claimRequest(t, request, emailToken)
		if !result.OK || result.UserID != owner.ID || result.Active {
			t.Fatalf("claim = %#v", result)
		}
		if !consumed(t, emailToken) {
			t.Fatal("email token was not consumed")
		}
	})
}

func TestCurrentAdminRequiresTrustedSession(t *testing.T) {
	ctx := context.Background()
	manager, db := newAuthTestManager(t)
	admin, err := db.CreateAdminAccount(ctx, "admin-1", "admin@example.com", "hash", nil)
	if err != nil {
		t.Fatalf("create admin: %v", err)
	}
	token := strings.Repeat("c", 64)
	if err := db.CreateAdminSession(ctx, Hash(token), admin.ID, time.Now().Add(time.Hour).UnixMilli()); err != nil {
		t.Fatalf("create admin session: %v", err)
	}
	otherAdmin, err := db.CreateAdminAccount(ctx, "admin-2", "other-admin@example.com", "hash", nil)
	if err != nil {
		t.Fatalf("create second admin: %v", err)
	}
	otherToken := strings.Repeat("d", 64)
	if err := db.CreateAdminSession(ctx, Hash(otherToken), otherAdmin.ID, time.Now().Add(time.Hour).UnixMilli()); err != nil {
		t.Fatalf("create second admin session: %v", err)
	}

	bare := &http.Cookie{Name: AdminSessionCookie, Value: token}
	host := &http.Cookie{Name: HostAdminSessionCookie, Value: token}
	otherBare := &http.Cookie{Name: AdminSessionCookie, Value: otherToken}

	cases := []struct {
		name            string
		origin          string
		trustProxy      bool
		forwardedProto  string
		secureTransport bool
		cookies         []*http.Cookie
		want            bool
	}{
		{"http bare cookie", "", false, "", false, []*http.Cookie{bare}, true},
		{"https bare cookie", "https://example.com", false, "", false, []*http.Cookie{bare}, false},
		{"https uppercase scheme", "HTTPS://Example.com", false, "", false, []*http.Cookie{bare}, false},
		{"https host cookie", "https://example.com", false, "", false, []*http.Cookie{host}, true},
		{"https host beats bare", "https://example.com", false, "", false, []*http.Cookie{host, otherBare}, true},
		{"https host ignores duplicate bare", "https://example.com", false, "", false,
			[]*http.Cookie{host, otherBare, otherBare}, true},
		{"https empty host and bare", "https://example.com", false, "", false,
			[]*http.Cookie{{Name: HostAdminSessionCookie, Value: ""}, bare}, false},
		{"tls bare cookie", "", false, "", true, []*http.Cookie{bare}, false},
		{"tls host cookie", "", false, "", true, []*http.Cookie{host}, true},
		{"trusted proxy https bare", "", true, "https", false, []*http.Cookie{bare}, false},
		{"trusted proxy https host", "", true, "https", false, []*http.Cookie{host}, true},
		{"untrusted proxy https bare", "", false, "https", false, []*http.Cookie{bare}, true},
		{"http duplicate bare", "", false, "", false, []*http.Cookie{bare, bare}, false},
		{"https duplicate bare", "https://example.com", false, "", false, []*http.Cookie{bare, bare}, false},
		{"https duplicate host", "https://example.com", false, "", false, []*http.Cookie{host, host}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("SITE_ORIGIN", tc.origin)
			trustProxy := "false"
			if tc.trustProxy {
				trustProxy = "true"
			}
			t.Setenv("TRUST_PROXY", trustProxy)
			request := sessionRequest(tc.secureTransport, tc.cookies...)
			if tc.forwardedProto != "" {
				request.Header.Set("X-Forwarded-Proto", tc.forwardedProto)
			}
			got, err := manager.CurrentAdmin(ctx, request)
			if err != nil {
				t.Fatalf("current admin: %v", err)
			}
			if (got != nil) != tc.want {
				t.Fatalf("current admin = %#v, want admin=%v", got, tc.want)
			}
			if got != nil && got.ID != admin.ID {
				t.Fatalf("current admin = %s, want %s", got.ID, admin.ID)
			}
		})
	}
}
