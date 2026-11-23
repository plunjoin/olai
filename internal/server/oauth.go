package server

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"olai/internal/httpx"
	"olai/internal/secure"
	"olai/internal/store"
)

// oauthProvider describes one external identity provider. The shared handlers
// below implement the authorization-code flow; provider files only declare
// endpoints, scopes and how to read the profile.
type oauthProvider struct {
	Name            string
	ClientIDKey     string
	ClientSecretKey string
	AuthorizeURL    string
	TokenURL        string
	Scope           string
	AuthorizeParams url.Values
	TokenParams     url.Values
	ProxyKey        string
	FixedIPKey      string
	FixedIPHost     string
	ErrorQuery      string
	PKCE            bool
	Profile         func(ctx context.Context, s *Server, p oauthProvider, accessToken string) (*oauthProfile, error)
}

type oauthProfile struct {
	ID    string
	Email string
}

var errAccountBanned = errors.New("account banned")

type oauthError struct{ code string }

func (e *oauthError) Error() string { return e.code }

func oauthProviderByName(name string) (oauthProvider, bool) {
	switch name {
	case "github":
		return githubProvider(), true
	case "google":
		return googleProvider(), true
	}
	return oauthProvider{}, false
}

// ---- state ----

const (
	oauthStateCookiePrefix        = "olai_oauth_state_"
	oauthHostStateCookiePrefix    = "__Host-olai_oauth_state_"
	oauthVerifierCookiePrefix     = "olai_oauth_verifier_"
	oauthHostVerifierCookiePrefix = "__Host-olai_oauth_verifier_"
	oauthStateMaxAge              = 900
)

func oauthStateCookieName(p oauthProvider, secure bool) string {
	if secure {
		return oauthHostStateCookiePrefix + p.Name
	}
	return oauthStateCookiePrefix + p.Name
}

func oauthVerifierCookieName(p oauthProvider, secure bool) string {
	if secure {
		return oauthHostVerifierCookiePrefix + p.Name
	}
	return oauthVerifierCookiePrefix + p.Name
}

func oauthStateCookiePath(p oauthProvider, secure bool) string {
	if secure {
		return "/"
	}
	return "/api/auth/" + p.Name
}

func oauthBase(s *Server, r *http.Request) string {
	return strings.TrimRight(s.Mail.SiteOrigin(s.siteOrigin(r)), "/")
}

func (s *Server) oauthEnabled(p oauthProvider) bool {
	return s.Settings.Get(p.ClientIDKey) != "" && s.Settings.Get(p.ClientSecretKey) != ""
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

func stateMatches(got, want string) bool {
	if got == "" || len(got) != len(want) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}

// newPKCE returns an RFC 7636 verifier (64 hex characters) and its S256
// challenge. The verifier lives only in an HttpOnly cookie.
func newPKCE() (verifier, challenge string) {
	verifier = secure.Hex(32)
	sum := sha256.Sum256([]byte(verifier))
	return verifier, base64.RawURLEncoding.EncodeToString(sum[:])
}

func cookieCount(r *http.Request, name string) int {
	count := 0
	for _, part := range strings.Split(r.Header.Get("Cookie"), ";") {
		if strings.HasPrefix(strings.TrimSpace(part), name+"=") {
			count++
		}
	}
	return count
}

func clearCookie(w http.ResponseWriter, name, path string, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name: name, Value: "", Path: path, MaxAge: -1, Secure: secure,
		HttpOnly: true, SameSite: http.SameSiteLaxMode,
	})
}

// ---- handlers ----

func (s *Server) handleOAuthStart(name string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		p, ok := oauthProviderByName(name)
		if !ok {
			http.NotFound(w, r)
			return
		}
		base := oauthBase(s, r)
		if !s.oauthEnabled(p) {
			http.Redirect(w, r, base+"/login?"+p.ErrorQuery+"=config", http.StatusFound)
			return
		}
		invite := normalizeInviteCode(r.URL.Query().Get("invite"))
		state := encodeState(invite)
		secureCookie := httpx.SecureRequest(r, s.Settings)
		http.SetCookie(w, &http.Cookie{
			Name: oauthStateCookieName(p, secureCookie), Value: state,
			Path: oauthStateCookiePath(p, secureCookie), HttpOnly: true,
			SameSite: http.SameSiteLaxMode, MaxAge: oauthStateMaxAge, Secure: secureCookie,
		})
		params := url.Values{
			"client_id":     {s.Settings.Get(p.ClientIDKey)},
			"redirect_uri":  {base + "/api/auth/" + p.Name + "/callback"},
			"response_type": {"code"},
			"scope":         {p.Scope},
			"state":         {strings.SplitN(state, ":", 2)[0]},
		}
		if p.PKCE {
			verifier, challenge := newPKCE()
			http.SetCookie(w, &http.Cookie{
				Name: oauthVerifierCookieName(p, secureCookie), Value: verifier,
				Path: oauthStateCookiePath(p, secureCookie), HttpOnly: true,
				SameSite: http.SameSiteLaxMode, MaxAge: oauthStateMaxAge, Secure: secureCookie,
			})
			params.Set("code_challenge", challenge)
			params.Set("code_challenge_method", "S256")
		}
		for key, values := range p.AuthorizeParams {
			for _, value := range values {
				params.Set(key, value)
			}
		}
		http.Redirect(w, r, p.AuthorizeURL+"?"+params.Encode(), http.StatusFound)
	}
}

func (s *Server) handleOAuthCallback(name string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		p, ok := oauthProviderByName(name)
		if !ok {
			http.NotFound(w, r)
			return
		}
		base := oauthBase(s, r)
		secureCookie := httpx.SecureRequest(r, s.Settings)
		stateName := oauthStateCookieName(p, secureCookie)
		cookiePath := oauthStateCookiePath(p, secureCookie)
		duplicate := cookieCount(r, stateName)
		cookie, _ := r.Cookie(stateName)
		verifier := ""
		verifierName := ""
		if p.PKCE {
			verifierName = oauthVerifierCookieName(p, secureCookie)
			if verifierCookie, err := r.Cookie(verifierName); err == nil {
				verifier = verifierCookie.Value
			}
		}
		back := func(code string) {
			target := base + "/"
			if code != "" {
				target = base + "/login?" + p.ErrorQuery + "=" + url.QueryEscape(code)
			}
			http.Redirect(w, r, target, http.StatusFound)
		}
		if duplicate > 1 {
			back("state")
			return
		}
		if !s.oauthEnabled(p) {
			back("config")
			return
		}
		stateValue := ""
		if cookie != nil {
			stateValue = cookie.Value
		}
		state, invite := decodeState(stateValue)
		if state == "" || !stateMatches(r.URL.Query().Get("state"), state) {
			back("state")
			return
		}
		// The state proves this callback belongs to a flow started by this
		// browser. Validate before honoring a provider error or clearing the
		// cookies, so a cross-site request cannot cancel a pending login.
		clearCookie(w, stateName, cookiePath, secureCookie)
		if verifierName != "" {
			clearCookie(w, verifierName, cookiePath, secureCookie)
		}
		if r.URL.Query().Get("error") != "" {
			back("denied")
			return
		}
		if p.PKCE && verifier == "" {
			back("token")
			return
		}
		code := r.URL.Query().Get("code")
		if code == "" {
			back("token")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()
		accessToken, err := s.oauthAccessToken(ctx, p, base, code, verifier)
		if err != nil {
			back(oauthErrorCode(err))
			return
		}
		profile, err := p.Profile(ctx, s, p, accessToken)
		if err != nil {
			back(oauthErrorCode(err))
			return
		}
		active, err := s.Auth.CurrentUser(r.Context(), r)
		if err != nil {
			back("failed")
			return
		}
		if active != nil {
			resolved, err := s.resolveOAuthUserID(r.Context(), p.Name, profile)
			if err != nil {
				back("failed")
				return
			}
			if resolved != active.ID {
				back("switch")
				return
			}
		}
		user, err := s.loginWithOAuth(r.Context(), p.Name, profile, invite)
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
}

func oauthErrorCode(err error) string {
	var oauthErr *oauthError
	if errors.As(err, &oauthErr) && oauthErr.code != "" {
		return oauthErr.code
	}
	return "failed"
}

// ---- outbound requests ----

func (s *Server) oauthClient(p oauthProvider) *http.Client {
	proxyURL := strings.TrimSpace(s.Settings.Get(p.ProxyKey))
	if proxyURL == "" {
		proxyURL = strings.TrimSpace(s.Settings.Get("HTTPS_PROXY"))
	}
	if proxyURL == "" {
		proxyURL = strings.TrimSpace(os.Getenv("https_proxy"))
	}
	resolveIP := ""
	if p.FixedIPKey != "" {
		resolveIP = strings.TrimSpace(s.Settings.Get(p.FixedIPKey))
	}
	transport := &http.Transport{}
	if proxyURL != "" {
		if parsed, err := url.Parse(proxyURL); err == nil {
			transport.Proxy = http.ProxyURL(parsed)
		}
	} else if resolveIP != "" && p.FixedIPHost != "" {
		address := resolveIP
		hostName := p.FixedIPHost
		transport.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				host, port = addr, "443"
			}
			target := addr
			if strings.EqualFold(host, hostName) {
				target = net.JoinHostPort(address, port)
			}
			dialer := &net.Dialer{Timeout: 15 * time.Second}
			return dialer.DialContext(ctx, network, target)
		}
		transport.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS12}
	}
	return &http.Client{Transport: transport, Timeout: 15 * time.Second}
}

func (s *Server) oauthJSON(ctx context.Context, p oauthProvider, method, target string, headers map[string]string, body string) (int, any, error) {
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	request, err := http.NewRequestWithContext(ctx, method, target, reader)
	if err != nil {
		return 0, nil, &oauthError{code: "network"}
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "olai")
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	client := s.oauthClient(p)
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }
	response, err := client.Do(request)
	if err != nil {
		return 0, nil, &oauthError{code: "network"}
	}
	defer response.Body.Close()
	limited, _ := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	var value any
	_ = json.Unmarshal(limited, &value)
	return response.StatusCode, value, nil
}

func (s *Server) oauthAccessToken(ctx context.Context, p oauthProvider, base, code, verifier string) (string, error) {
	if !s.oauthEnabled(p) {
		return "", &oauthError{code: "config"}
	}
	form := url.Values{
		"client_id":     {s.Settings.Get(p.ClientIDKey)},
		"client_secret": {s.Settings.Get(p.ClientSecretKey)},
		"code":          {code},
		"redirect_uri":  {base + "/api/auth/" + p.Name + "/callback"},
	}
	for key, values := range p.TokenParams {
		for _, value := range values {
			form.Set(key, value)
		}
	}
	if verifier != "" {
		form.Set("code_verifier", verifier)
	}
	status, value, err := s.oauthJSON(ctx, p, http.MethodPost, p.TokenURL,
		map[string]string{"Content-Type": "application/x-www-form-urlencoded"}, form.Encode())
	if err != nil {
		return "", err
	}
	object, _ := value.(map[string]any)
	token, _ := object["access_token"].(string)
	if status != http.StatusOK || token == "" {
		return "", &oauthError{code: "token"}
	}
	return token, nil
}

// ---- account resolution ----

func (s *Server) resolveOAuthUserID(ctx context.Context, provider string, profile *oauthProfile) (string, error) {
	user, err := s.DB.OAuthUser(ctx, provider, profile.ID)
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

// linkOAuth links the provider account to userID. It returns the already-linked
// user when another request won the (provider, provider_id) race.
func (s *Server) linkOAuth(ctx context.Context, provider, providerID, userID string) (*store.User, error) {
	err := s.DB.LinkOAuth(ctx, provider, providerID, userID)
	if err == nil {
		return nil, nil
	}
	if !errors.Is(err, store.ErrOAuthAlreadyLinked) {
		return nil, err
	}
	linked, err := s.DB.OAuthUser(ctx, provider, providerID)
	if err != nil {
		return nil, err
	}
	if banned, err := s.DB.IsBanned(ctx, linked.ID); err != nil {
		return nil, err
	} else if banned {
		return nil, errAccountBanned
	}
	return linked, nil
}

func (s *Server) takeOverUnverified(ctx context.Context, user *store.User, marker string) error {
	if err := s.DB.TakeOverOAuthUser(ctx, user.ID, marker); err != nil {
		return err
	}
	now := time.Now().UnixMilli()
	user.PasswordHash = marker
	user.EmailVerifiedAt = &now
	return nil
}

func (s *Server) loginWithOAuth(ctx context.Context, provider string, profile *oauthProfile, inviteCode string) (*store.User, error) {
	linked, err := s.DB.OAuthUser(ctx, provider, profile.ID)
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

	marker := store.OAuthPasswordMarker(provider, profile.ID)
	if existing, err := s.DB.UserByEmail(ctx, profile.Email); err == nil {
		if banned, err := s.DB.IsBanned(ctx, existing.ID); err != nil {
			return nil, err
		} else if banned {
			return nil, errAccountBanned
		}
		if other, err := s.linkOAuth(ctx, provider, profile.ID, existing.ID); err != nil {
			return nil, err
		} else if other != nil {
			return other, nil
		}
		if existing.EmailVerifiedAt == nil {
			if err := s.takeOverUnverified(ctx, existing, marker); err != nil {
				return nil, err
			}
		}
		return existing, nil
	} else if !errors.Is(err, store.ErrNotFound) {
		return nil, err
	}

	created, err := s.DB.CreateUser(ctx, secure.ID(), profile.Email, marker, true)
	if store.IsUniqueViolation(err) {
		again, err := s.DB.UserByEmail(ctx, profile.Email)
		if err != nil {
			return nil, err
		}
		if banned, err := s.DB.IsBanned(ctx, again.ID); err != nil {
			return nil, err
		} else if banned {
			return nil, errAccountBanned
		}
		if again.EmailVerifiedAt == nil {
			if err := s.takeOverUnverified(ctx, again, marker); err != nil {
				return nil, err
			}
		}
		if other, err := s.linkOAuth(ctx, provider, profile.ID, again.ID); err != nil {
			return nil, err
		} else if other != nil {
			return other, nil
		}
		return again, nil
	}
	if err != nil {
		return nil, err
	}
	if other, err := s.linkOAuth(ctx, provider, profile.ID, created.ID); err != nil {
		// The account was created moments ago and has no data yet.
		_ = s.DB.DeleteUser(ctx, created.ID)
		return nil, err
	} else if other != nil {
		_ = s.DB.DeleteUser(ctx, created.ID)
		return other, nil
	}
	if inviteCode != "" && invitePattern.MatchString(inviteCode) {
		if inviter, err := s.DB.InviterByCode(ctx, inviteCode); err == nil {
			_ = s.DB.AcceptInvite(ctx, inviter, created.ID, inviteCode)
		}
	}
	return created, nil
}

// oauthLoginHint explains which third-party provider owns a password-hash
// marker such as "oauth:google:<sub>".
func oauthLoginHint(hash string) string {
	parts := strings.SplitN(hash, ":", 3)
	if len(parts) == 3 {
		switch parts[1] {
		case "github":
			return "此账号使用 GitHub 登录，请继续用 GitHub 登录。"
		case "google":
			return "此账号使用 Google 登录，请继续用 Google 登录。"
		}
	}
	return "此账号使用第三方登录，请继续使用对应的第三方方式登录。"
}
