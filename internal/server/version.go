package server

import (
	"net/http"
	"net/url"
	"strings"
	"time"

	appversion "olai/internal/version"
)

type clientRelease struct {
	LatestVersion  string `json:"latestVersion"`
	MinimumVersion string `json:"minimumVersion"`
	DownloadURL    string `json:"downloadUrl"`
}

type clientPolicy struct {
	Enabled bool          `json:"enabled"`
	Force   bool          `json:"force"`
	Notes   string        `json:"notes"`
	IOS     clientRelease `json:"ios"`
	Android clientRelease `json:"android"`
}

type versionResponse struct {
	Server appversion.Info `json:"server"`
	Client clientPolicy    `json:"client"`
}

type updateResponse struct {
	Enabled         bool   `json:"enabled"`
	Platform        string `json:"platform"`
	CurrentVersion  string `json:"currentVersion"`
	LatestVersion   string `json:"latestVersion"`
	MinimumVersion  string `json:"minimumVersion"`
	UpdateAvailable bool   `json:"updateAvailable"`
	Required        bool   `json:"required"`
	DownloadURL     string `json:"downloadUrl"`
	Notes           string `json:"notes"`
	CheckedAt       int64  `json:"checkedAt"`
}

// handleVersion reports the running server build and the public release policy
// used by the download page and native clients. It never includes settings that
// are not meant for browsers.
func (s *Server) handleVersion(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, versionResponse{
		Server: appversion.Current(),
		Client: clientPolicy{
			Enabled: s.Settings.Bool("APP_UPDATE_ENABLED"),
			Force:   s.Settings.Bool("APP_UPDATE_FORCE"),
			Notes:   s.Settings.Get("APP_UPDATE_NOTES"),
			IOS:     s.clientRelease("IOS"),
			Android: s.clientRelease("ANDROID"),
		},
	})
}

// handleAppUpdate is the endpoint native clients call on launch and resume.
// A client that is below its minimum version must update even when the global
// force flag is off.
func (s *Server) handleAppUpdate(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	platform := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("platform")))
	var release clientRelease
	switch platform {
	case "ios":
		release = s.clientRelease("IOS")
	case "android":
		release = s.clientRelease("ANDROID")
	default:
		writeError(w, http.StatusBadRequest, "platform 必须是 ios 或 android。")
		return
	}

	currentRaw := strings.TrimSpace(r.URL.Query().Get("version"))
	current := ""
	if currentRaw != "" {
		normalized, ok := appversion.Normalize(currentRaw)
		if !ok {
			writeError(w, http.StatusBadRequest, "version 参数必须是版本号，例如 1.2.3。")
			return
		}
		current = normalized
	}
	latest := normalizeConfiguredVersion(release.LatestVersion)
	minimum := normalizeConfiguredVersion(release.MinimumVersion)
	enabled := s.Settings.Bool("APP_UPDATE_ENABLED")
	updateAvailable := false
	required := false
	if enabled && current != "" && latest != "" {
		if cmp, ok := appversion.Compare(current, latest); ok && cmp < 0 {
			updateAvailable = true
			required = s.Settings.Bool("APP_UPDATE_FORCE")
			if minimum != "" {
				if minimumCmp, minimumOK := appversion.Compare(current, minimum); minimumOK && minimumCmp < 0 {
					required = true
				}
			}
		}
	}
	writeJSON(w, http.StatusOK, updateResponse{
		Enabled:         enabled,
		Platform:        platform,
		CurrentVersion:  current,
		LatestVersion:   latest,
		MinimumVersion:  minimum,
		UpdateAvailable: updateAvailable,
		Required:        required,
		DownloadURL:     release.DownloadURL,
		Notes:           s.Settings.Get("APP_UPDATE_NOTES"),
		CheckedAt:       time.Now().UnixMilli(),
	})
}

func (s *Server) clientRelease(platform string) clientRelease {
	return clientRelease{
		LatestVersion:  normalizeConfiguredVersion(s.Settings.Get("APP_" + platform + "_LATEST_VERSION")),
		MinimumVersion: normalizeConfiguredVersion(s.Settings.Get("APP_" + platform + "_MIN_VERSION")),
		DownloadURL:    normalizeDownloadURL(s.Settings.Get("APP_" + platform + "_DOWNLOAD_URL")),
	}
}

func normalizeConfiguredVersion(raw string) string {
	normalized, ok := appversion.Normalize(raw)
	if !ok {
		return ""
	}
	return normalized
}

func normalizeDownloadURL(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return ""
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return ""
	}
	scheme := strings.ToLower(parsed.Scheme)
	if !parsed.IsAbs() || parsed.Host == "" || parsed.User != nil ||
		(scheme != "http" && scheme != "https") {
		return ""
	}
	return value
}
