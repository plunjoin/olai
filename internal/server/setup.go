package server

import (
	"context"
	"crypto/subtle"
	"errors"
	"net/http"
	"path"
	"strings"
	"time"

	"olai/internal/auth"
	"olai/internal/settings"
	"olai/internal/store"
)

const setupCacheTTL = 10 * time.Second

// setupNeeded caches the first-run check so normal page requests do not hit the
// database twice on every navigation. The check is refreshed every ten seconds
// and immediately cleared after a successful setup.
func (s *Server) setupNeeded(ctx context.Context) bool {
	s.setupMu.Lock()
	defer s.setupMu.Unlock()
	if !s.setupChecked.IsZero() && time.Since(s.setupChecked) < setupCacheTTL {
		return s.setupRequired
	}
	required, err := s.DB.SetupRequired(ctx)
	if err != nil {
		// A broken database must not trap every request in a redirect loop.
		return s.setupRequired
	}
	s.setupChecked = time.Now()
	s.setupRequired = required
	return required
}

func (s *Server) markSetupComplete() {
	s.setupMu.Lock()
	s.setupChecked = time.Now()
	s.setupRequired = false
	s.setupMu.Unlock()
}

// setupAllowedPath keeps the wizard assets, its API and health checks reachable
// while every other page redirects to /setup and every other API returns 428.
func setupAllowedPath(pathname string) bool {
	switch pathname {
	case "/setup", "/api/setup", "/api/setup/status", "/api/status":
		return true
	}
	if strings.HasPrefix(pathname, "/assets/") || strings.HasPrefix(pathname, "/admin/assets/") {
		return true
	}
	return path.Ext(pathname) != ""
}

func (s *Server) setupDatabase() string {
	if s.DB.Postgres() {
		return "postgresql"
	}
	return "sqlite"
}

func (s *Server) setupTokenMatches(token string) bool {
	if s.Config.SetupToken == "" {
		return true
	}
	return subtle.ConstantTimeCompare([]byte(token), []byte(s.Config.SetupToken)) == 1
}

func (s *Server) handleSetupStatus(w http.ResponseWriter, r *http.Request) {
	required, err := s.DB.SetupRequired(r.Context())
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "暂时无法读取安装状态，请稍后重试。")
		return
	}
	response := map[string]any{"required": required}
	if required {
		response["tokenRequired"] = s.Config.SetupToken != ""
		response["database"] = s.setupDatabase()
	}
	writeJSON(w, http.StatusOK, response)
}

type setupInput struct {
	Email      string
	Password   string
	Name       string
	SiteOrigin string
	Token      string
}

func (s *Server) handleSetup(w http.ResponseWriter, r *http.Request) {
	if !s.sameOrigin(r) {
		writeError(w, http.StatusForbidden, "不允许跨站调用。")
		return
	}
	ctx := r.Context()
	required, err := s.DB.SetupRequired(ctx)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "初始化服务暂不可用，请稍后重试。")
		return
	}
	if !required {
		writeError(w, http.StatusConflict, "站点已完成初始化。")
		return
	}
	ip, err := s.clientIP(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	now := time.Now()
	if ok, err := s.DB.Reserve(ctx, "setup:"+hashKey(ip)+":"+fmtInt(now.UnixMilli()/900_000), 10, now.UnixMilli()+1_800_000); err != nil {
		writeError(w, http.StatusServiceUnavailable, "初始化服务暂不可用，请稍后重试。")
		return
	} else if !ok {
		writeError(w, http.StatusTooManyRequests, "尝试次数过多，请 15 分钟后再试。")
		return
	}

	input, err := readJSONObject(r, 8192)
	if err != nil {
		if errors.Is(err, errBodyTooLarge) {
			writeError(w, http.StatusBadRequest, "初始化信息过长。")
		} else {
			writeError(w, http.StatusBadRequest, "请求内容无效。")
		}
		return
	}
	payload := setupInput{
		Email:      lowerTrim(stringValue(input["email"])),
		Password:   stringValue(input["password"]),
		Name:       strings.TrimSpace(stringValue(input["name"])),
		SiteOrigin: strings.TrimSpace(stringValue(input["siteOrigin"])),
		Token:      strings.TrimSpace(stringValue(input["token"])),
	}
	if !s.setupTokenMatches(payload.Token) {
		writeError(w, http.StatusForbidden, "安装令牌无效。")
		return
	}
	if !validEmail(payload.Email) || !validPassword(payload.Password) {
		writeError(w, http.StatusBadRequest, "请输入有效的管理员邮箱和 8–128 位密码。")
		return
	}
	if payload.Name != "" && !validProfileName(payload.Name) {
		writeError(w, http.StatusBadRequest, "管理员昵称需为 1–24 个字符。")
		return
	}
	values := map[string]string{}
	if payload.SiteOrigin != "" {
		siteOrigin, err := settings.ValidateValue("SITE_ORIGIN", payload.SiteOrigin)
		if err != nil {
			writeError(w, http.StatusBadRequest, "公开站点地址必须是完整的 http(s) 地址，且不能包含路径、查询或锚点。")
			return
		}
		values["SITE_ORIGIN"] = siteOrigin
	}

	passwordHash, err := auth.PasswordHash(payload.Password, "")
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "初始化服务暂不可用，请稍后重试。")
		return
	}
	adminID := newUserID()
	if err := s.DB.CompleteSetup(ctx, adminID, payload.Email, passwordHash, payload.Name, values); err != nil {
		if errors.Is(err, store.ErrSetupComplete) {
			writeError(w, http.StatusConflict, "站点已完成初始化。")
			return
		}
		if store.IsUniqueViolation(err) {
			writeError(w, http.StatusConflict, "该邮箱已有账号，请更换管理员邮箱。")
			return
		}
		writeError(w, http.StatusServiceUnavailable, "初始化失败，请稍后重试。")
		return
	}
	s.Settings.Refresh(ctx, true)
	s.markSetupComplete()
	// The wizard creates the console administrator only. It does not start a
	// portal session; the browser is sent straight to the console login page.
	writeJSON(w, http.StatusCreated, map[string]any{
		"ok":        true,
		"adminPath": s.Settings.AdminEntryPath(),
		"loginPath": settings.AdminLoginPath(s.Settings.AdminEntryPath()),
		"admin":     map[string]any{"email": payload.Email},
	})
}

func stringValue(value any) string {
	text, _ := value.(string)
	return text
}
