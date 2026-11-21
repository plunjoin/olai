package server

import (
	"context"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"olai/internal/secure"
	"olai/internal/store"
)

const (
	githubAuthorize = "https://github.com/login/oauth/authorize"
	githubTokenURL  = "https://github.com/login/oauth/access_token"
	githubUserURL   = "https://api.github.com/user"
	githubEmailsURL = "https://api.github.com/user/emails"
	stateCookie     = "olai_oauth_state"
	hostStateCookie = "__Host-olai_oauth_state"
	statePath       = "/api/auth/github"
)

var errAccountBanned = errors.New("account banned")

type githubError struct{ code string }

func (e *githubError) Error() string { return e.code }

type githubProfile struct {
	ID    string
	Login string
	Email string
}

func stateCookieName(secure bool) string {
	if secure {
		return hostStateCookie
	}
	return stateCookie
}

func stateCookiePath(secure bool) string {
	if secure {
		return "/"
	}
	return statePath
}

func (s *Server) githubBase(r *http.Request) string {
	return strings.TrimRight(s.Mail.SiteOrigin(s.siteOrigin(r)), "/")
}

func encodeState(invite string) string {
	state := secure.Hex(16)
	if invite != "" {
		state += ":" + invite
	}
	return state
}

func decodeState(value string) (string, string) {
	parts := strings.SplitN(value, ":", 2)
	state := parts[0]
	invite := ""
	if len(parts) == 2 {
		invite = parts[1]
	}
	if len(state) != 32 {
		return "", ""
	}
	if _, err := hex.DecodeString(state); err != nil {
		return "", ""
	}
	if invite != "" && !invitePattern.MatchString(invite) {
		invite = ""
	}
	return state, invite
}

func (s *Server) handleGitHubStart(w http.ResponseWriter, r *http.Request) {
	base := s.githubBase(r)
	if !s.githubLoginEnabled() {
		http.Redirect(w, r, base+"/login?github_error=config", http.StatusFound)
		return
	}
	invite := normalizeInviteCode(r.URL.Query().Get("invite"))
	state := encodeState(invite)
	secure := strings.HasPrefix(base, "https:")
	http.SetCookie(w, &http.Cookie{
		Name: stateCookieName(secure), Value: state, Path: stateCookiePath(secure),
		HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: 600, Secure: secure,
	})
	redirect := githubAuthorize + "?" + url.Values{
		"client_id":    {s.Settings.Get("GITHUB_CLIENT_ID")},
		"redirect_uri": {base + "/api/auth/github/callback"},
		"scope":        {"read:user user:email"},
		"state":        {strings.SplitN(state, ":", 2)[0]},
		"allow_signup": {"true"},
	}.Encode()
	http.Redirect(w, r, redirect, http.StatusFound)
}

func (s *Server) handleGitHubCallback(w http.ResponseWriter, r *http.Request) {
	base := s.githubBase(r)
	secure := strings.HasPrefix(base, "https:")
	name := stateCookieName(secure)
	path := stateCookiePath(secure)
	duplicate := 0
	for _, part := range strings.Split(r.Header.Get("Cookie"), ";") {
		if strings.HasPrefix(strings.TrimSpace(part), name+"=") {
			duplicate++
		}
	}
	cookie, _ := r.Cookie(name)
	http.SetCookie(w, &http.Cookie{Name: name, Value: "", Path: path, MaxAge: -1, Secure: secure, HttpOnly: true, SameSite: http.SameSiteLaxMode})
	back := func(code string) {
		target := base + "/"
		if code != "" {
			target = base + "/login?github_error=" + url.QueryEscape(code)
		}
		http.Redirect(w, r, target, http.StatusFound)
	}
	if duplicate > 1 {
		back("state")
		return
	}
	if !s.githubLoginEnabled() {
		back("config")
		return
	}
	if r.URL.Query().Get("error") != "" {
		back("denied")
		return
	}
	stateValue := ""
	if cookie != nil {
		stateValue = cookie.Value
	}
	state, invite := decodeState(stateValue)
	if state == "" || r.URL.Query().Get("state") != state {
		back("state")
		return
	}
	code := r.URL.Query().Get("code")
	if code == "" {
		back("token")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	accessToken, err := s.githubAccessToken(ctx, base, code)
	if err != nil {
		back(githubErrorCode(err))
		return
	}
	profile, err := s.githubProfile(ctx, accessToken)
	if err != nil {
		back(githubErrorCode(err))
		return
	}
	active, err := s.Auth.CurrentUser(r.Context(), r)
	if err != nil {
		back("failed")
		return
	}
	if active != nil {
		resolved, err := s.resolveGithubUserID(r.Context(), profile)
		if err != nil {
			back("failed")
			return
		}
		if resolved != active.ID {
			back("switch")
			return
		}
	}
	user, err := s.loginWithGithub(r.Context(), profile, invite)
	if err != nil {
		if errors.Is(err, errAccountBanned) {
			back("banned")
			return
		}
		back("failed")
		return
	}
	if active != nil && active.ID != user.ID {
		back("switch")
		return
	}
	if err := s.Auth.StartSession(r.Context(), w, r, user.ID); err != nil {
		back("failed")
		return
	}
	back("")
}

func githubErrorCode(err error) string {
	var gh *githubError
	if errors.As(err, &gh) {
		return gh.code
	}
	return "failed"
}

func (s *Server) githubClient() *http.Client {
	proxyURL := strings.TrimSpace(s.Settings.Get("GITHUB_PROXY"))
	if proxyURL == "" {
		proxyURL = strings.TrimSpace(s.Settings.Get("HTTPS_PROXY"))
	}
	resolveIP := strings.TrimSpace(s.Settings.Get("GITHUB_RESOLVE_IP"))
	transport := &http.Transport{}
	if proxyURL != "" {
		if parsed, err := url.Parse(proxyURL); err == nil {
			transport.Proxy = http.ProxyURL(parsed)
		}
	} else if resolveIP != "" {
		address := resolveIP
		transport.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				host, port = addr, "443"
			}
			target := addr
			if strings.EqualFold(host, "github.com") {
				target = net.JoinHostPort(address, port)
			}
			dialer := &net.Dialer{Timeout: 15 * time.Second}
			return dialer.DialContext(ctx, network, target)
		}
		transport.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS12}
	}
	return &http.Client{Transport: transport, Timeout: 15 * time.Second}
}

func (s *Server) githubJSON(ctx context.Context, method, target string, headers map[string]string, body string) (int, any, error) {
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	request, err := http.NewRequestWithContext(ctx, method, target, reader)
	if err != nil {
		return 0, nil, &githubError{code: "network"}
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "olai")
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	client := s.githubClient()
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }
	response, err := client.Do(request)
	if err != nil {
		return 0, nil, &githubError{code: "network"}
	}
	defer response.Body.Close()
	limited, _ := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	var value any
	_ = json.Unmarshal(limited, &value)
	return response.StatusCode, value, nil
}

func (s *Server) githubAccessToken(ctx context.Context, base, code string) (string, error) {
	if !s.githubLoginEnabled() {
		return "", &githubError{code: "config"}
	}
	form := url.Values{
		"client_id":     {s.Settings.Get("GITHUB_CLIENT_ID")},
		"client_secret": {s.Settings.Get("GITHUB_CLIENT_SECRET")},
		"code":          {code},
		"redirect_uri":  {base + "/api/auth/github/callback"},
	}
	status, value, err := s.githubJSON(ctx, http.MethodPost, githubTokenURL,
		map[string]string{"Content-Type": "application/x-www-form-urlencoded"}, form.Encode())
	if err != nil {
		return "", err
	}
	object, _ := value.(map[string]any)
	token, _ := object["access_token"].(string)
	if status != http.StatusOK || token == "" {
		return "", &githubError{code: "token"}
	}
	return token, nil
}

func (s *Server) githubProfile(ctx context.Context, token string) (*githubProfile, error) {
	headers := map[string]string{
		"Authorization":        "Bearer " + token,
		"Accept":               "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
	}
	type result struct {
		status int
		value  any
		err    error
	}
	userCh := make(chan result, 1)
	emailsCh := make(chan result, 1)
	go func() {
		status, value, err := s.githubJSON(ctx, http.MethodGet, githubUserURL, headers, "")
		userCh <- result{status, value, err}
	}()
	go func() {
		status, value, err := s.githubJSON(ctx, http.MethodGet, githubEmailsURL, headers, "")
		emailsCh <- result{status, value, err}
	}()
	userResult, emailResult := <-userCh, <-emailsCh
	if userResult.err != nil || emailResult.err != nil {
		return nil, &githubError{code: "network"}
	}
	if userResult.status != http.StatusOK || emailResult.status != http.StatusOK {
		return nil, &githubError{code: "profile"}
	}
	user, _ := userResult.value.(map[string]any)
	login, _ := user["login"].(string)
	var id string
	switch raw := user["id"].(type) {
	case float64:
		id = fmtInt(int64(raw))
	case string:
		id = raw
	}
	emails, _ := emailResult.value.([]any)
	primaryEmail := ""
	fallbackEmail := ""
	for _, raw := range emails {
		item, _ := raw.(map[string]any)
		email, _ := item["email"].(string)
		verified, _ := item["verified"].(bool)
		if email == "" || !verified {
			continue
		}
		if fallbackEmail == "" {
			fallbackEmail = strings.ToLower(strings.TrimSpace(email))
		}
		if primary, _ := item["primary"].(bool); primary && primaryEmail == "" {
			primaryEmail = strings.ToLower(strings.TrimSpace(email))
		}
	}
	email := primaryEmail
	if email == "" {
		email = fallbackEmail
	}
	if id == "" || login == "" || email == "" {
		return nil, &githubError{code: "email"}
	}
	return &githubProfile{ID: id, Login: login, Email: email}, nil
}

func (s *Server) resolveGithubUserID(ctx context.Context, profile *githubProfile) (string, error) {
	user, err := s.DB.OAuthUser(ctx, "github", profile.ID)
	if err == nil {
		return user.ID, nil
	}
	if !errors.Is(err, store.ErrNotFound) {
		return "", err
	}
	existing, err := s.DB.UserByEmail(ctx, profile.Email)
	if errors.Is(err, store.ErrNotFound) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return existing.ID, nil
}

func (s *Server) loginWithGithub(ctx context.Context, profile *githubProfile, inviteCode string) (*store.User, error) {
	linked, err := s.DB.OAuthUser(ctx, "github", profile.ID)
	if err == nil {
		if banned, err := s.DB.IsBanned(ctx, linked.ID); err != nil {
			return nil, err
		} else if banned {
			return nil, errAccountBanned
		}
		return linked, nil
	}
	if !errors.Is(err, store.ErrNotFound) {
		return nil, err
	}
	existing, err := s.DB.UserByEmail(ctx, profile.Email)
	if err == nil {
		if banned, err := s.DB.IsBanned(ctx, existing.ID); err != nil {
			return nil, err
		} else if banned {
			return nil, errAccountBanned
		}
		if err := s.DB.LinkOAuth(ctx, "github", profile.ID, existing.ID); err != nil {
			return nil, err
		}
		if existing.EmailVerifiedAt == nil {
			// An unverified local signup could be another person squatting on
			// this address. Taking it over invalidates its password.
			if err := s.DB.UpdatePassword(ctx, existing.ID, "oauth:github:"+profile.ID); err != nil {
				return nil, err
			}
			existing.PasswordHash = "oauth:github:" + profile.ID
			now := time.Now().UnixMilli()
			existing.EmailVerifiedAt = &now
		}
		return existing, nil
	}
	if !errors.Is(err, store.ErrNotFound) {
		return nil, err
	}
	marker := "oauth:github:" + profile.ID
	created, err := s.DB.CreateUser(ctx, secure.ID(), profile.Email, marker, true)
	if store.IsUniqueViolation(err) {
		again, err := s.DB.UserByEmail(ctx, profile.Email)
		if err != nil {
			return nil, err
		}
		if again.EmailVerifiedAt == nil {
			if err := s.DB.UpdatePassword(ctx, again.ID, marker); err != nil {
				return nil, err
			}
			now := time.Now().UnixMilli()
			again.EmailVerifiedAt = &now
			again.PasswordHash = marker
		}
		created = again
	} else if err != nil {
		return nil, err
	}
	if err := s.DB.LinkOAuth(ctx, "github", profile.ID, created.ID); err != nil {
		return nil, err
	}
	if inviteCode != "" && invitePattern.MatchString(inviteCode) {
		if inviter, err := s.DB.InviterByCode(ctx, inviteCode); err == nil {
			_ = s.DB.AcceptInvite(ctx, inviter, created.ID, inviteCode)
		}
	}
	return created, nil
}
