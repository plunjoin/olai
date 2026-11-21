package server

import (
	"errors"
	"net/http"
	"time"

	"olai/internal/auth"
	"olai/internal/store"
)

const (
	adminLoginAttempts = 10
	adminLoginWindow   = 15 * 60 * 1000
)

// handleAdminLogin is the console's only credential entry. It verifies against
// admin_accounts and starts an admin session; the portal's session cookie and
// users table are never consulted.
func (s *Server) handleAdminLogin(w http.ResponseWriter, r *http.Request) {
	if !s.sameOrigin(r) {
		writeError(w, http.StatusForbidden, "不允许跨站调用。")
		return
	}
	ctx := r.Context()
	ip, err := s.clientIP(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	now := time.Now()
	if ok, err := s.DB.Reserve(ctx, "admin-auth:"+hashKey(ip)+":"+fmtInt(now.UnixMilli()/adminLoginWindow),
		adminLoginAttempts, now.UnixMilli()+adminLoginWindow*2); err != nil {
		writeError(w, http.StatusServiceUnavailable, "后台登录服务暂不可用，请稍后重试。")
		return
	} else if !ok {
		writeError(w, http.StatusTooManyRequests, "尝试次数过多，请 15 分钟后再试。")
		return
	}
	input, err := readJSONObject(r, 4096)
	if err != nil {
		if errors.Is(err, errBodyTooLarge) {
			writeError(w, http.StatusBadRequest, "登录信息过长。")
		} else {
			writeError(w, http.StatusBadRequest, "请求内容无效。")
		}
		return
	}
	email := lowerTrim(stringValue(input["email"]))
	password := stringValue(input["password"])
	if email == "" || password == "" {
		writeError(w, http.StatusBadRequest, "请输入管理员邮箱和密码。")
		return
	}
	account, err := s.DB.AdminByEmail(ctx, email)
	if errors.Is(err, store.ErrNotFound) {
		// Burn the same scrypt cost as a real check so a missing address cannot
		// be distinguished by timing.
		_ = auth.VerifyPassword(password, auth.DummyHash())
		writeError(w, http.StatusUnauthorized, "邮箱或密码不正确。")
		return
	}
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "后台登录服务暂不可用，请稍后重试。")
		return
	}
	if !auth.VerifyPassword(password, account.PasswordHash) {
		writeError(w, http.StatusUnauthorized, "邮箱或密码不正确。")
		return
	}
	if err := s.Auth.StartAdminSession(ctx, w, r, account.ID); err != nil {
		writeError(w, http.StatusServiceUnavailable, "后台登录服务暂不可用，请稍后重试。")
		return
	}
	_ = s.DB.TouchAdminLogin(ctx, account.ID, now.UnixMilli())
	_ = s.logAdmin(r, account, "admin.login", account.ID, map[string]any{})
	writeJSON(w, http.StatusOK, map[string]any{"admin": account})
}

func (s *Server) handleAdminLogout(w http.ResponseWriter, r *http.Request) {
	if !s.sameOrigin(r) {
		writeError(w, http.StatusForbidden, "不允许跨站调用。")
		return
	}
	s.Auth.EndAdminSession(r.Context(), w, r)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleAdminPassword(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.requireAdmin(w, r)
	if !ok {
		return
	}
	if !s.sameOrigin(r) {
		writeError(w, http.StatusForbidden, "不允许跨站调用。")
		return
	}
	input, err := readJSONObject(r, 4096)
	if err != nil {
		if errors.Is(err, errBodyTooLarge) {
			writeError(w, http.StatusBadRequest, "请求内容过长。")
		} else {
			writeError(w, http.StatusBadRequest, "请求内容无效。")
		}
		return
	}
	current := stringValue(input["currentPassword"])
	next := stringValue(input["password"])
	if !auth.VerifyPassword(current, admin.PasswordHash) {
		writeError(w, http.StatusBadRequest, "当前密码不正确。")
		return
	}
	if !validPassword(next) {
		writeError(w, http.StatusBadRequest, "请输入 8–128 位新密码。")
		return
	}
	hash, err := auth.PasswordHash(next, "")
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "操作失败，请稍后重试。")
		return
	}
	if err := s.DB.SetAdminPassword(r.Context(), admin.ID, hash); err != nil {
		writeError(w, http.StatusServiceUnavailable, "操作失败，请稍后重试。")
		return
	}
	// Revoke every console session, then rotate the current one so the browser
	// that made the change stays signed in with a fresh token.
	if err := s.DB.DeleteAdminSessions(r.Context(), admin.ID); err != nil {
		writeError(w, http.StatusServiceUnavailable, "密码已修改，但会话清理失败，请重新登录。")
		return
	}
	if err := s.Auth.StartAdminSession(r.Context(), w, r, admin.ID); err != nil {
		writeError(w, http.StatusServiceUnavailable, "密码已修改，请重新登录。")
		return
	}
	_ = s.logAdmin(r, admin, "admin.password", admin.ID, map[string]any{})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
