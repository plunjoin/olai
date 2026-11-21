package server

import (
	"context"
	"net/http"
	"net/url"
	"strings"
)

const googleUserInfoURL = "https://openidconnect.googleapis.com/v1/userinfo"

func googleProvider() oauthProvider {
	return oauthProvider{
		Name:            "google",
		ClientIDKey:     "GOOGLE_CLIENT_ID",
		ClientSecretKey: "GOOGLE_CLIENT_SECRET",
		AuthorizeURL:    "https://accounts.google.com/o/oauth2/v2/auth",
		TokenURL:        "https://oauth2.googleapis.com/token",
		Scope:           "openid email profile",
		AuthorizeParams: url.Values{"prompt": {"select_account"}},
		TokenParams:     url.Values{"grant_type": {"authorization_code"}},
		ProxyKey:        "GOOGLE_PROXY",
		ErrorQuery:      "google_error",
		PKCE:            true,
		Profile:         fetchGoogleProfile,
	}
}

func fetchGoogleProfile(ctx context.Context, s *Server, p oauthProvider, token string) (*oauthProfile, error) {
	status, value, err := s.oauthJSON(ctx, p, http.MethodGet, googleUserInfoURL,
		map[string]string{"Authorization": "Bearer " + token}, "")
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, &oauthError{code: "profile"}
	}
	object, _ := value.(map[string]any)
	return parseGoogleProfile(object)
}

// parseGoogleProfile trusts only a boolean true for email_verified. Google's
// userinfo response uses the OIDC boolean field; the account is keyed by the
// stable, non-reusable sub claim, never by the email address.
func parseGoogleProfile(object map[string]any) (*oauthProfile, error) {
	sub, _ := object["sub"].(string)
	email, _ := object["email"].(string)
	verified, _ := object["email_verified"].(bool)
	sub = strings.TrimSpace(sub)
	email = strings.ToLower(strings.TrimSpace(email))
	if sub == "" || email == "" || !verified {
		return nil, &oauthError{code: "email"}
	}
	if len(sub) > 255 {
		return nil, &oauthError{code: "profile"}
	}
	return &oauthProfile{ID: sub, Email: email}, nil
}
