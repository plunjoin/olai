// Package auth 处理密码、登录会话、邮箱令牌与 Cookie。
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"golang.org/x/crypto/scrypt"

	"olai/internal/httpx"
	"olai/internal/settings"
	"olai/internal/store"
)

const (
	SessionCookie     = "olai_session"
	HostSessionCookie = "__Host-olai_session"
	SessionMaxAge     = 30 * 24 * 3600
	emailTokenTTL     = 30 * 60 * 1000
	tokenPattern      = `^[a-f0-9]{64}$`
)

var tokenRE = regexp.MustCompile(tokenPattern)

type Manager struct {
	DB       *store.DB
	Settings *settings.Manager
}

func Hash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func PasswordHash(password, salt string) (string, error) {
	if salt == "" {
		buf := make([]byte, 16)
		if _, err := rand.Read(buf); err != nil {
			return "", err
		}
		salt = hex.EncodeToString(buf)
	}
	key, err := scrypt.Key([]byte(password), []byte(salt), 16384, 8, 1, 64)
	if err != nil {
		return "", err
	}
	return "scrypt:" + salt + ":" + hex.EncodeToString(key), nil
}

func VerifyPassword(password, stored string) bool {
	parts := strings.SplitN(stored, ":", 3)
	if len(parts) != 3 || parts[0] != "scrypt" || parts[1] == "" || parts[2] == "" {
		return false
	}
	expected, err := hex.DecodeString(parts[2])
	if err != nil {
		return false
	}
	candidate, err := scrypt.Key([]byte(password), []byte(parts[1]), 16384, 8, 1, 64)
	if err != nil || len(candidate) != len(expected) {
		return false
	}
	return subtle.ConstantTimeCompare(candidate, expected) == 1
}

func DummyHash() string {
	return "scrypt:" + strings.Repeat("0", 32) + ":" + strings.Repeat("0", 128)
}

func (m *Manager) secure(r *http.Request) bool {
	return httpx.SecureRequest(r, m.Settings)
}

func cookieCount(r *http.Request, name string) int {
	count := 0
	for _, cookie := range r.Cookies() {
		if cookie.Name == name {
			count++
		}
	}
	return count
}

func sessionTokens(r *http.Request) (host, normal string) {
	for _, cookie := range r.Cookies() {
		switch cookie.Name {
		case HostSessionCookie:
			host = cookie.Value
		case SessionCookie:
			normal = cookie.Value
		}
	}
	return host, normal
}

// usableSessionToken returns the cookie value that may authenticate this
// request. On HTTPS only a single non-empty __Host- cookie is accepted; bare
// cookies, including duplicates planted by a sibling subdomain, are ignored.
func (m *Manager) usableSessionToken(r *http.Request) (string, bool) {
	host, normal := sessionTokens(r)
	if m.secure(r) || host != "" {
		if host == "" || cookieCount(r, HostSessionCookie) != 1 {
			return "", false
		}
		return host, true
	}
	if normal == "" || cookieCount(r, SessionCookie) != 1 {
		return "", false
	}
	return normal, true
}

// sessionAmbiguous reports duplicate cookies for the authoritative name, so a
// sibling subdomain cannot block email links with extra bare cookies on HTTPS.
func (m *Manager) sessionAmbiguous(r *http.Request) bool {
	host, _ := sessionTokens(r)
	if m.secure(r) || host != "" {
		return cookieCount(r, HostSessionCookie) > 1
	}
	return cookieCount(r, SessionCookie) > 1
}

func SessionToken(r *http.Request) string {
	host, normal := sessionTokens(r)
	if host != "" {
		return host
	}
	return normal
}

func (m *Manager) CurrentUser(ctx context.Context, r *http.Request) (*store.SessionUser, error) {
	token, ok := m.usableSessionToken(r)
	if !ok || !tokenRE.MatchString(token) {
		return nil, nil
	}
	user, err := m.DB.SessionUser(ctx, Hash(token))
	if errors.Is(err, store.ErrNotFound) {
		return nil, nil
	}
	return user, err
}

func (m *Manager) EndSession(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	if token := SessionToken(r); tokenRE.MatchString(token) {
		_ = m.DB.DeleteSession(ctx, Hash(token))
	}
	http.SetCookie(w, &http.Cookie{Name: HostSessionCookie, Value: "", Path: "/", MaxAge: -1, Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode})
	http.SetCookie(w, &http.Cookie{Name: SessionCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode})
}

func (m *Manager) StartSession(ctx context.Context, w http.ResponseWriter, r *http.Request, userID string) error {
	m.EndSession(ctx, w, r)
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return err
	}
	token := hex.EncodeToString(buf)
	expires := time.Now().Add(SessionMaxAge * time.Second).UnixMilli()
	if err := m.DB.CreateSession(ctx, Hash(token), userID, expires); err != nil {
		return err
	}
	secure := m.secure(r)
	name := SessionCookie
	if secure {
		name = HostSessionCookie
	}
	http.SetCookie(w, &http.Cookie{
		Name: name, Value: token, Path: "/", HttpOnly: true,
		SameSite: http.SameSiteLaxMode, Secure: secure, MaxAge: SessionMaxAge,
	})
	return nil
}

// ---- email tokens ----

func (m *Manager) IssueEmailToken(ctx context.Context, userID, purpose string) (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	token := hex.EncodeToString(buf)
	if err := m.DB.DeleteEmailTokens(ctx, userID, purpose); err != nil {
		return "", err
	}
	expires := time.Now().UnixMilli() + emailTokenTTL
	if err := m.DB.InsertEmailToken(ctx, Hash(token), userID, purpose, expires); err != nil {
		return "", err
	}
	return token, nil
}

func (m *Manager) PeekEmailToken(ctx context.Context, token, purpose string) (string, error) {
	if !tokenRE.MatchString(token) {
		return "", store.ErrNotFound
	}
	return m.DB.EmailTokenUser(ctx, Hash(token), purpose)
}

func (m *Manager) ConsumeEmailToken(ctx context.Context, token, purpose string) (string, error) {
	if !tokenRE.MatchString(token) {
		return "", store.ErrNotFound
	}
	return m.DB.ConsumeEmailToken(ctx, Hash(token), purpose)
}

type EmailLinkClaim struct {
	OK     bool   `json:"ok"`
	UserID string `json:"userId,omitempty"`
	Active bool   `json:"active,omitempty"`
	Reason string `json:"reason,omitempty"`
}

// ClaimEmailToken refuses to silently switch accounts. The token is not
// consumed when it belongs to a different signed-in account, so the user can
// sign out and reopen the link.
func (m *Manager) ClaimEmailToken(ctx context.Context, w http.ResponseWriter, r *http.Request, token, purpose string) (EmailLinkClaim, error) {
	if m.sessionAmbiguous(r) {
		return EmailLinkClaim{Reason: "ambiguous-session"}, nil
	}
	tokenUser, err := m.PeekEmailToken(ctx, token, purpose)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return EmailLinkClaim{Reason: "invalid"}, nil
		}
		return EmailLinkClaim{}, err
	}
	active, err := m.CurrentUser(ctx, r)
	if err != nil {
		return EmailLinkClaim{}, err
	}
	if active != nil && active.ID != tokenUser {
		return EmailLinkClaim{Reason: "account-switch"}, nil
	}
	consumed, err := m.ConsumeEmailToken(ctx, token, purpose)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return EmailLinkClaim{Reason: "invalid"}, nil
		}
		return EmailLinkClaim{}, err
	}
	return EmailLinkClaim{OK: true, UserID: consumed, Active: active != nil}, nil
}

// TrustsSession reports whether the request carries a session cookie that may
// authenticate it. HTTPS deployments only trust a single non-empty __Host-
// cookie; a bare cookie is an HTTP-only fallback.
func (m *Manager) TrustsSession(r *http.Request) bool {
	_, ok := m.usableSessionToken(r)
	return ok
}
