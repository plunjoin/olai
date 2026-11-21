package server

import (
	"context"
	"errors"
	"net/http"
	netmail "net/mail"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"olai/internal/auth"
	"olai/internal/httpx"
	"olai/internal/mail"
	"olai/internal/secure"
	"olai/internal/store"
)

const (
	profileNameMax     = 24
	avatarUploadPrefix = "upload:"
	avatarUploadMax    = 2 * 1024 * 1024
)

var avatarThemes = map[string]bool{
	"ocean": true, "sunset": true, "mint": true, "violet": true, "amber": true, "slate": true,
}

var (
	emailPattern  = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
	invitePattern = regexp.MustCompile(`^[A-HJ-NP-Z2-9]{6,12}$`)
	avatarIDRE    = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`)
)

func normalizeInviteCode(value any) string {
	text, _ := value.(string)
	text = strings.ToUpper(text)
	out := make([]byte, 0, len(text))
	for i := 0; i < len(text) && len(out) < 12; i++ {
		c := text[i]
		if c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' {
			out = append(out, c)
		}
	}
	return string(out)
}

func normalizeProfileName(value any) string {
	text, ok := value.(string)
	if !ok {
		return ""
	}
	var builder strings.Builder
	space := false
	for _, r := range text {
		if r < 0x20 || r == 0x7f || unicode.IsSpace(r) {
			space = true
			continue
		}
		if space && builder.Len() > 0 {
			builder.WriteByte(' ')
		}
		space = false
		builder.WriteRune(r)
	}
	return builder.String()
}

func validProfileName(name string) bool {
	length := utf8.RuneCountInString(name)
	return length > 0 && length <= profileNameMax
}

func validEmail(value string) bool {
	if len(value) > 254 || !emailPattern.MatchString(value) {
		return false
	}
	_, err := netmail.ParseAddress(value)
	return err == nil
}

func validPassword(value string) bool {
	length := utf8.RuneCountInString(value)
	return length >= 8 && length <= 128
}

func (s *Server) githubLoginEnabled() bool {
	return s.Settings.Get("GITHUB_CLIENT_ID") != "" && s.Settings.Get("GITHUB_CLIENT_SECRET") != ""
}

func (s *Server) accountSummary(ctx context.Context, userID string) (int64, string, error) {
	balance, err := s.DB.BalanceOf(ctx, userID, int64(s.Pricing.SignupBonus()))
	if err != nil {
		return 0, "", err
	}
	code, err := s.DB.EnsureInviteCode(ctx, userID)
	if err != nil {
		return 0, "", err
	}
	return balance, code, nil
}

func (s *Server) accountState(ctx context.Context, w http.ResponseWriter, status int, user *store.SessionUser) {
	var points int64
	var inviteCode string
	if user != nil {
		points, inviteCode, _ = s.accountSummary(ctx, user.ID)
	}
	// The portal deliberately knows nothing about the admin console: no admin
	// flag, no entry path. The admin SPA authenticates through /api/admin/*.
	result := map[string]any{
		"user":            user,
		"generationLimit": s.dailyLimit(user != nil),
		"chatLimit":       s.chatDailyLimit(user != nil),
		"points":          points,
		"inviteCode":      inviteCode,
		"prices":          s.Pricing.Public(),
		"mediaStorage":    s.mediaStorage(),
		"shortFilm":       s.Settings.Get("AI_SHORT_FILM") == "true",
		"githubLogin":     s.githubLoginEnabled(),
	}
	writeJSON(w, status, result)
}

func (s *Server) sessionUser(user *store.User) *store.SessionUser {
	return &store.SessionUser{ID: user.ID, Email: user.Email, Name: user.Name, Avatar: user.Avatar}
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	user, err := s.Auth.CurrentUser(r.Context(), r)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "账号服务暂不可用，请稍后重试。")
		return
	}
	// Establish the HttpOnly media device cookie before concurrent media loads.
	if s.ossEnabled() {
		_, _ = s.Media.Identify(r.Context(), w, r)
	}
	s.accountState(r.Context(), w, http.StatusOK, user)
}

func (s *Server) handlePoints(w http.ResponseWriter, r *http.Request) {
	user, err := s.Auth.CurrentUser(r.Context(), r)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "账号服务暂不可用，请稍后重试。")
		return
	}
	if user == nil {
		writeError(w, http.StatusUnauthorized, "请先登录后查看积分。")
		return
	}
	balance, code, err := s.accountSummary(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "积分服务暂不可用，请稍后重试。")
		return
	}
	invited, rewarded, err := s.DB.InviteStats(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "积分服务暂不可用，请稍后重试。")
		return
	}
	ledger, err := s.DB.RecentPoints(r.Context(), user.ID, 30)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "积分服务暂不可用，请稍后重试。")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"balance": balance, "inviteCode": code, "prices": s.Pricing.Public(),
		"invite": map[string]any{"invited": invited, "rewarded": rewarded},
		"ledger": ledger,
	})
}

func (s *Server) handleAuthAction(w http.ResponseWriter, r *http.Request) {
	action := r.PathValue("action")
	switch action {
	case "register", "login", "logout", "forgot", "reset", "verify", "resend", "profile":
	default:
		writeError(w, http.StatusNotFound, "接口不存在。")
		return
	}
	if !s.sameOrigin(r) {
		writeError(w, http.StatusForbidden, "不允许跨站调用。")
		return
	}
	ctx := r.Context()
	if action == "logout" {
		s.Auth.EndSession(ctx, w, r)
		writeJSON(w, http.StatusOK, map[string]any{"user": nil})
		return
	}
	if action == "profile" {
		s.handleProfile(w, r)
		return
	}
	ip, err := s.clientIP(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	now := time.Now()
	if ok, err := s.DB.Reserve(ctx, "auth:"+hashKey(ip)+":"+fmtInt(now.UnixMilli()/900_000), 20, now.UnixMilli()+1_800_000); err != nil {
		writeError(w, http.StatusServiceUnavailable, "账号服务暂不可用，请稍后重试。")
		return
	} else if !ok {
		writeError(w, http.StatusTooManyRequests, "尝试次数过多，请 15 分钟后再试。")
		return
	}
	input, err := readJSONObject(r, 4096)
	if err != nil {
		if errors.Is(err, errBodyTooLarge) {
			writeError(w, http.StatusBadRequest, "注册或登录信息过长。")
		} else {
			writeError(w, http.StatusBadRequest, "请求内容无效。")
		}
		return
	}
	email, _ := input["email"].(string)
	email = strings.ToLower(strings.TrimSpace(email))
	password, _ := input["password"].(string)
	token, _ := input["token"].(string)
	token = strings.TrimSpace(token)

	if action == "verify" {
		guestLimit := s.dailyLimit(false)
		claim, err := s.Auth.ClaimEmailToken(ctx, w, r, token, "verify")
		if err != nil {
			writeError(w, http.StatusServiceUnavailable, "账号服务暂不可用，请稍后重试。")
			return
		}
		if !claim.OK {
			s.emailLinkFailure(w, claim, "验证链接无效或已过期，请重新申请验证邮件。", "该链接属于另一个账号。请先退出当前账号，再重新打开邮件中的链接。")
			return
		}
		user, err := s.DB.UserByID(ctx, claim.UserID)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusBadRequest, "验证链接无效或已过期，请重新申请验证邮件。")
			return
		}
		if err != nil {
			writeError(w, http.StatusServiceUnavailable, "账号服务暂不可用，请稍后重试。")
			return
		}
		if banned, err := s.DB.IsBanned(ctx, user.ID); err != nil {
			writeError(w, http.StatusServiceUnavailable, "账号服务暂不可用，请稍后重试。")
			return
		} else if banned {
			writeError(w, http.StatusForbidden, "此账号已被停用，请联系管理员。")
			return
		}
		if err := s.DB.MarkEmailVerified(ctx, user.ID); err != nil {
			writeError(w, http.StatusServiceUnavailable, "账号服务暂不可用，请稍后重试。")
			return
		}
		if claim.Active {
			if err := s.Auth.StartSession(ctx, w, r, user.ID); err != nil {
				writeError(w, http.StatusServiceUnavailable, "账号服务暂不可用，请稍后重试。")
				return
			}
			s.accountState(ctx, w, http.StatusOK, s.sessionUser(user))
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"user": nil, "verified": true, "generationLimit": guestLimit,
			"message": "邮箱已验证，请登录。",
		})
		return
	}

	if action == "reset" {
		if !validPassword(password) {
			writeError(w, http.StatusBadRequest, "请输入 8–128 位新密码。")
			return
		}
		guestLimit := s.dailyLimit(false)
		claim, err := s.Auth.ClaimEmailToken(ctx, w, r, token, "reset")
		if err != nil {
			writeError(w, http.StatusServiceUnavailable, "账号服务暂不可用，请稍后重试。")
			return
		}
		if !claim.OK {
			s.emailLinkFailure(w, claim, "重置链接无效或已过期，请重新申请。", "该链接属于另一个账号。请先退出当前账号，再重新打开邮件中的链接并设置新密码。")
			return
		}
		user, err := s.DB.UserByID(ctx, claim.UserID)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusBadRequest, "重置链接无效或已过期，请重新申请。")
			return
		}
		if err != nil {
			writeError(w, http.StatusServiceUnavailable, "账号服务暂不可用，请稍后重试。")
			return
		}
		if strings.HasPrefix(user.PasswordHash, "oauth:") {
			writeError(w, http.StatusBadRequest, "此账号使用 GitHub 登录，请继续用 GitHub 登录。")
			return
		}
		if banned, err := s.DB.IsBanned(ctx, user.ID); err != nil {
			writeError(w, http.StatusServiceUnavailable, "账号服务暂不可用，请稍后重试。")
			return
		} else if banned {
			writeError(w, http.StatusForbidden, "此账号已被停用，请联系管理员。")
			return
		}
		passwordHash, err := auth.PasswordHash(password, "")
		if err != nil {
			writeError(w, http.StatusServiceUnavailable, "账号服务暂不可用，请稍后重试。")
			return
		}
		if err := s.DB.UpdatePassword(ctx, user.ID, passwordHash); err != nil {
			writeError(w, http.StatusServiceUnavailable, "账号服务暂不可用，请稍后重试。")
			return
		}
		if err := s.DB.DeleteUserSessions(ctx, user.ID); err != nil {
			writeError(w, http.StatusServiceUnavailable, "账号服务暂不可用，请稍后重试。")
			return
		}
		if claim.Active {
			if err := s.Auth.StartSession(ctx, w, r, user.ID); err != nil {
				writeError(w, http.StatusServiceUnavailable, "账号服务暂不可用，请稍后重试。")
				return
			}
			s.accountState(ctx, w, http.StatusOK, s.sessionUser(user))
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"user": nil, "passwordReset": true, "generationLimit": guestLimit,
			"message": "密码已重置，请使用新密码登录。",
		})
		return
	}

	if action == "forgot" || action == "resend" {
		if !validEmail(email) {
			writeError(w, http.StatusBadRequest, "请输入有效邮箱。")
			return
		}
		if !s.Mail.Configured() {
			writeError(w, http.StatusServiceUnavailable, "邮件服务尚未配置，暂时无法发送邮件。请联系管理员。")
			return
		}
		message := "如果该邮箱已注册，我们已发送重置邮件。"
		if action == "resend" {
			message = "如果该邮箱需要验证，我们已发送验证邮件。"
		}
		silent := func() {
			writeJSON(w, http.StatusOK, map[string]any{
				"user": nil, "generationLimit": s.dailyLimit(false), "message": message,
			})
		}
		user, err := s.DB.UserByEmail(ctx, email)
		if errors.Is(err, store.ErrNotFound) || user == nil {
			silent()
			return
		}
		if err != nil {
			writeError(w, http.StatusServiceUnavailable, "邮件服务暂时不可用，请稍后重试。")
			return
		}
		if banned, _ := s.DB.IsBanned(ctx, user.ID); banned {
			silent()
			return
		}
		if action == "forgot" {
			if strings.HasPrefix(user.PasswordHash, "oauth:") {
				silent()
				return
			}
			if err := s.dispatchReset(ctx, r, user.ID, user.Email); err != nil {
				if cfg, ok := err.(*mail.ConfigError); ok {
					writeError(w, http.StatusServiceUnavailable, cfg.Message)
					return
				}
				writeError(w, http.StatusServiceUnavailable, "邮件服务暂时不可用，请稍后重试。")
				return
			}
			silent()
			return
		}
		if user.EmailVerifiedAt != nil {
			silent()
			return
		}
		if err := s.dispatchVerification(ctx, r, user.ID, user.Email); err != nil {
			if cfg, ok := err.(*mail.ConfigError); ok {
				writeError(w, http.StatusServiceUnavailable, cfg.Message)
				return
			}
			writeError(w, http.StatusServiceUnavailable, "邮件服务暂时不可用，请稍后重试。")
			return
		}
		silent()
		return
	}

	if !validEmail(email) || !validPassword(password) {
		writeError(w, http.StatusBadRequest, "请输入有效邮箱和 8–128 位密码。")
		return
	}
	inviteCode := normalizeInviteCode(input["inviteCode"])
	if inviteCode != "" && !invitePattern.MatchString(inviteCode) {
		writeError(w, http.StatusBadRequest, "邀请码无效。")
		return
	}
	inviterID := ""
	if action == "register" && inviteCode != "" {
		inviterID, err = s.DB.InviterByCode(ctx, inviteCode)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusBadRequest, "邀请码无效，请检查后重试。")
			return
		}
		if err != nil {
			writeError(w, http.StatusServiceUnavailable, "账号服务暂不可用，请稍后重试。")
			return
		}
	}

	if action == "register" {
		if !s.Mail.Configured() {
			writeError(w, http.StatusServiceUnavailable, "邮件服务尚未配置，暂时无法注册。请联系管理员。")
			return
		}
		passwordHash, err := auth.PasswordHash(password, "")
		if err != nil {
			writeError(w, http.StatusServiceUnavailable, "账号服务暂不可用，请稍后重试。")
			return
		}
		user, err := s.DB.CreateUser(ctx, newUserID(), email, passwordHash, false)
		if store.IsUniqueViolation(err) {
			writeError(w, http.StatusConflict, "此邮箱已注册，请直接登录。")
			return
		}
		if err != nil {
			writeError(w, http.StatusServiceUnavailable, "账号服务暂不可用，请稍后重试。")
			return
		}
		if inviterID != "" {
			_ = s.DB.AcceptInvite(ctx, inviterID, user.ID, inviteCode)
		}
		if err := s.dispatchVerification(ctx, r, user.ID, user.Email); err != nil {
			_ = s.DB.DeleteEmailTokens(ctx, user.ID, "verify")
			// DeleteUser also removes the invite row recorded for this signup.
			_ = s.DB.DeleteUser(ctx, user.ID)
			if cfg, ok := err.(*mail.ConfigError); ok {
				writeError(w, http.StatusServiceUnavailable, cfg.Message)
				return
			}
			writeError(w, http.StatusServiceUnavailable, "验证邮件发送失败，请稍后重试。")
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{
			"user": nil, "pendingVerification": true, "generationLimit": s.dailyLimit(false),
			"message": "验证邮件已发送，请查收后再登录。",
		})
		return
	}

	user, err := s.DB.UserByEmail(ctx, email)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusServiceUnavailable, "账号服务暂不可用，请稍后重试。")
		return
	}
	stored := auth.DummyHash()
	if user != nil {
		stored = user.PasswordHash
	}
	valid := auth.VerifyPassword(password, stored)
	if user == nil || !valid {
		writeError(w, http.StatusUnauthorized, "邮箱或密码不正确。")
		return
	}
	if banned, err := s.DB.IsBanned(ctx, user.ID); err != nil {
		writeError(w, http.StatusServiceUnavailable, "账号服务暂不可用，请稍后重试。")
		return
	} else if banned {
		writeError(w, http.StatusForbidden, "此账号已被停用，请联系管理员。")
		return
	}
	if user.EmailVerifiedAt == nil {
		if s.Mail.Configured() {
			_ = s.dispatchVerification(ctx, r, user.ID, user.Email)
		}
		writeError(w, http.StatusForbidden, "请先验证邮箱。如未收到邮件，可重新发送验证邮件。")
		return
	}
	if err := s.Auth.StartSession(ctx, w, r, user.ID); err != nil {
		writeError(w, http.StatusServiceUnavailable, "账号服务暂不可用，请稍后重试。")
		return
	}
	s.accountState(ctx, w, http.StatusOK, s.sessionUser(user))
}

func (s *Server) emailLinkFailure(w http.ResponseWriter, claim auth.EmailLinkClaim, invalid, switched string) {
	switch claim.Reason {
	case "invalid":
		writeError(w, http.StatusBadRequest, invalid)
	case "ambiguous-session":
		writeError(w, http.StatusConflict, "无法确认当前登录状态。请清除本站 Cookie 后，重新打开邮件中的链接。")
	default:
		writeError(w, http.StatusConflict, switched)
	}
}

func (s *Server) dispatchVerification(ctx context.Context, r *http.Request, userID, email string) error {
	token, err := s.Auth.IssueEmailToken(ctx, userID, "verify")
	if err != nil {
		return err
	}
	return s.Mail.SendVerification(email, s.Mail.SiteOrigin(s.siteOrigin(r))+"/login?verify="+token)
}

func (s *Server) dispatchReset(ctx context.Context, r *http.Request, userID, email string) error {
	token, err := s.Auth.IssueEmailToken(ctx, userID, "reset")
	if err != nil {
		return err
	}
	return s.Mail.SendReset(email, s.Mail.SiteOrigin(s.siteOrigin(r))+"/login?reset="+token)
}

func (s *Server) handleProfile(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, err := s.Auth.CurrentUser(ctx, r)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "账号服务暂不可用，请稍后重试。")
		return
	}
	if user == nil {
		writeError(w, http.StatusUnauthorized, "请先登录后再修改资料。")
		return
	}
	if banned, err := s.DB.IsBanned(ctx, user.ID); err != nil {
		writeError(w, http.StatusServiceUnavailable, "账号服务暂不可用，请稍后重试。")
		return
	} else if banned {
		writeError(w, http.StatusForbidden, "此账号已被停用，请联系管理员。")
		return
	}
	now := time.Now().UnixMilli()
	if ok, err := s.DB.Reserve(ctx, hashKey("profile:"+user.ID)+":"+fmtInt(now/900_000), 30, now+1_800_000); err != nil {
		writeError(w, http.StatusServiceUnavailable, "账号服务暂不可用，请稍后重试。")
		return
	} else if !ok {
		writeError(w, http.StatusTooManyRequests, "尝试次数过多，请 15 分钟后再试。")
		return
	}
	input, err := readJSONObject(r, 4096)
	if err != nil {
		if errors.Is(err, errBodyTooLarge) {
			writeError(w, http.StatusBadRequest, "资料内容过长。")
		} else {
			writeError(w, http.StatusBadRequest, "请求内容无效。")
		}
		return
	}
	name := normalizeProfileName(input["name"])
	if utf8.RuneCountInString(name) > profileNameMax {
		writeError(w, http.StatusBadRequest, "昵称不能超过 24 个字符。")
		return
	}
	// An empty nickname is allowed and stored as NULL, so uploading an avatar
	// does not require the user to invent a display name first.
	var storedName *string
	if name != "" {
		storedName = &name
	}
	var avatar *string
	rawAvatar := input["avatar"]
	switch typed := rawAvatar.(type) {
	case nil:
	case string:
		switch {
		case typed == "" || typed == "brand":
		case avatarThemes[typed]:
			value := typed
			avatar = &value
		case strings.HasPrefix(typed, avatarUploadPrefix):
			id := strings.ToLower(strings.TrimPrefix(typed, avatarUploadPrefix))
			if !avatarIDRE.MatchString(id) {
				writeError(w, http.StatusBadRequest, "头像选择无效。")
				return
			}
			row, err := s.DB.MediaByID(ctx, id)
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusBadRequest, "头像选择无效。")
				return
			}
			if err != nil {
				writeError(w, http.StatusServiceUnavailable, "账号服务暂不可用，请稍后重试。")
				return
			}
			if row.Owner != "user:"+user.ID || !strings.HasPrefix(row.Mime, "image/") ||
				row.AttachmentID != "avatar" || row.Size > avatarUploadMax {
				writeError(w, http.StatusBadRequest, "头像选择无效。")
				return
			}
			value := avatarUploadPrefix + id
			avatar = &value
		default:
			writeError(w, http.StatusBadRequest, "头像选择无效。")
			return
		}
	default:
		writeError(w, http.StatusBadRequest, "头像选择无效。")
		return
	}
	if err := s.DB.UpdateUserProfile(ctx, user.ID, storedName, avatar); err != nil {
		writeError(w, http.StatusServiceUnavailable, "账号服务暂不可用，请稍后重试。")
		return
	}
	updated := &store.SessionUser{ID: user.ID, Email: user.Email, Name: storedName, Avatar: avatar}
	s.accountState(ctx, w, http.StatusOK, updated)
}

// hashKey mirrors the SHA-256 bearer identity used by quota counters.
func hashKey(value string) string { return httpx.Hash(value) }

// newUserID is kept as a helper so account and OAuth signup share one shape.
func newUserID() string { return secure.ID() }
