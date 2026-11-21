package server

import (
	"context"
	"net/http"
	"net/url"
	"strings"
)

const (
	githubAuthorize = "https://github.com/login/oauth/authorize"
	githubTokenURL  = "https://github.com/login/oauth/access_token"
	githubUserURL   = "https://api.github.com/user"
	githubEmailsURL = "https://api.github.com/user/emails"
)

func githubProvider() oauthProvider {
	return oauthProvider{
		Name:            "github",
		ClientIDKey:     "GITHUB_CLIENT_ID",
		ClientSecretKey: "GITHUB_CLIENT_SECRET",
		AuthorizeURL:    githubAuthorize,
		TokenURL:        githubTokenURL,
		Scope:           "read:user user:email",
		AuthorizeParams: url.Values{"allow_signup": {"true"}},
		ProxyKey:        "GITHUB_PROXY",
		FixedIPKey:      "GITHUB_RESOLVE_IP",
		FixedIPHost:     "github.com",
		ErrorQuery:      "github_error",
		Profile:         fetchGitHubProfile,
	}
}

func fetchGitHubProfile(ctx context.Context, s *Server, p oauthProvider, token string) (*oauthProfile, error) {
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
		status, value, err := s.oauthJSON(ctx, p, http.MethodGet, githubUserURL, headers, "")
		userCh <- result{status, value, err}
	}()
	go func() {
		status, value, err := s.oauthJSON(ctx, p, http.MethodGet, githubEmailsURL, headers, "")
		emailsCh <- result{status, value, err}
	}()
	userResult, emailResult := <-userCh, <-emailsCh
	if userResult.err != nil || emailResult.err != nil {
		return nil, &oauthError{code: "network"}
	}
	if userResult.status != http.StatusOK || emailResult.status != http.StatusOK {
		return nil, &oauthError{code: "profile"}
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
		return nil, &oauthError{code: "email"}
	}
	return &oauthProfile{ID: id, Email: email}, nil
}
