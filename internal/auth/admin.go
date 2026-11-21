package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"time"

	"olai/internal/store"
)

// The admin console has its own cookie names, token table and lifetime. The
// portal's session cookie is never read here, and the console cookie is never
// read by the portal handlers.
const (
	AdminSessionCookie     = "olai_admin_session"
	HostAdminSessionCookie = "__Host-olai_admin_session"
	AdminSessionMaxAge     = 12 * 3600
)

func AdminSessionToken(r *http.Request) string {
	host, normal := "", ""
	for _, cookie := range r.Cookies() {
		switch cookie.Name {
		case HostAdminSessionCookie:
			host = cookie.Value
		case AdminSessionCookie:
			normal = cookie.Value
		}
	}
	if host != "" {
		return host
	}
	return normal
}

func HasAmbiguousAdminSession(r *http.Request) bool {
	hostCount, normalCount := 0, 0
	for _, name := range CookieNames(r) {
		switch name {
		case HostAdminSessionCookie:
			hostCount++
		case AdminSessionCookie:
			normalCount++
		}
	}
	return hostCount > 1 || normalCount > 1
}

func (m *Manager) CurrentAdmin(ctx context.Context, r *http.Request) (*store.AdminAccount, error) {
	token := AdminSessionToken(r)
	if !tokenRE.MatchString(token) {
		return nil, nil
	}
	admin, err := m.DB.AdminSessionAccount(ctx, Hash(token))
	if errors.Is(err, store.ErrNotFound) {
		return nil, nil
	}
	return admin, err
}

func (m *Manager) EndAdminSession(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	if token := AdminSessionToken(r); tokenRE.MatchString(token) {
		_ = m.DB.DeleteAdminSession(ctx, Hash(token))
	}
	http.SetCookie(w, &http.Cookie{Name: HostAdminSessionCookie, Value: "", Path: "/", MaxAge: -1, Secure: true, HttpOnly: true, SameSite: http.SameSiteStrictMode})
	http.SetCookie(w, &http.Cookie{Name: AdminSessionCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteStrictMode})
}

func (m *Manager) StartAdminSession(ctx context.Context, w http.ResponseWriter, r *http.Request, adminID string) error {
	m.EndAdminSession(ctx, w, r)
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return err
	}
	token := hex.EncodeToString(buf)
	expires := time.Now().Add(AdminSessionMaxAge * time.Second).UnixMilli()
	if err := m.DB.CreateAdminSession(ctx, Hash(token), adminID, expires); err != nil {
		return err
	}
	secure := m.secure(r)
	name := AdminSessionCookie
	if secure {
		name = HostAdminSessionCookie
	}
	http.SetCookie(w, &http.Cookie{
		Name: name, Value: token, Path: "/", HttpOnly: true,
		SameSite: http.SameSiteStrictMode, Secure: secure, MaxAge: AdminSessionMaxAge,
	})
	return nil
}
