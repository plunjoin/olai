package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	appversion "olai/internal/version"
)

func versionTestServer(t *testing.T) *Server {
	t.Helper()
	app, _ := adminTestServer(t)
	if _, err := app.Settings.Save(context.Background(), map[string]any{
		"APP_UPDATE_ENABLED":         "true",
		"APP_UPDATE_FORCE":           "false",
		"APP_UPDATE_NOTES":           "修复播放问题。",
		"APP_IOS_LATEST_VERSION":     "1.4.0",
		"APP_IOS_MIN_VERSION":        "1.3.0",
		"APP_IOS_DOWNLOAD_URL":       "https://apps.apple.com/app/id123",
		"APP_ANDROID_LATEST_VERSION": "2.0.0",
		"APP_ANDROID_MIN_VERSION":    "1.8.0",
		"APP_ANDROID_DOWNLOAD_URL":   "https://play.google.com/store/apps/details?id=cc.olai",
	}, nil, "test"); err != nil {
		t.Fatalf("save release settings: %v", err)
	}
	return app
}

func versionRequest(t *testing.T, app *Server, target string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, target, nil)
	request.Header.Set("Accept", "application/json")
	recorder := httptest.NewRecorder()
	app.mux.ServeHTTP(recorder, request)
	return recorder
}

func TestVersionEndpointReportsBuildAndPublicReleaseInfo(t *testing.T) {
	original := appversion.Version
	appversion.Version = "1.4.2"
	t.Cleanup(func() { appversion.Version = original })

	app := versionTestServer(t)
	recorder := versionRequest(t, app, "/api/version")
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var response versionResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Server.Version != "1.4.2" {
		t.Fatalf("server version = %q, want 1.4.2", response.Server.Version)
	}
	if !response.Client.Enabled || response.Client.IOS.LatestVersion != "1.4.0" {
		t.Fatalf("unexpected client policy: %#v", response.Client)
	}
	if response.Client.IOS.DownloadURL != "https://apps.apple.com/app/id123" {
		t.Fatalf("iOS URL = %q", response.Client.IOS.DownloadURL)
	}
}

func TestAppUpdateRequiresMinimumVersion(t *testing.T) {
	app := versionTestServer(t)
	tests := []struct {
		name            string
		query           string
		updateAvailable bool
		required        bool
		status          int
	}{
		{name: "optional update", query: "?platform=ios&version=1.3.5", updateAvailable: true, required: false, status: http.StatusOK},
		{name: "smaller version is required", query: "?platform=ios&version=1.2.9", updateAvailable: true, required: true, status: http.StatusOK},
		{name: "current version", query: "?platform=ios&version=1.4.0", updateAvailable: false, required: false, status: http.StatusOK},
		{name: "latest only", query: "?platform=android", updateAvailable: false, required: false, status: http.StatusOK},
		{name: "unknown platform", query: "?platform=web&version=1.0.0", status: http.StatusBadRequest},
		{name: "invalid version", query: "?platform=ios&version=latest", status: http.StatusBadRequest},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := versionRequest(t, app, "/api/app/update"+test.query)
			if recorder.Code != test.status {
				t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
			}
			if test.status != http.StatusOK {
				return
			}
			var response updateResponse
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if response.UpdateAvailable != test.updateAvailable || response.Required != test.required {
				t.Fatalf("updateAvailable/required = %v/%v, want %v/%v",
					response.UpdateAvailable, response.Required, test.updateAvailable, test.required)
			}
			if response.Platform != "ios" && response.Platform != "android" {
				t.Fatalf("platform = %q", response.Platform)
			}
		})
	}
}

func TestAppUpdateForceFlagMakesUpdateRequired(t *testing.T) {
	app := versionTestServer(t)
	if _, err := app.Settings.Save(context.Background(), map[string]any{
		"APP_UPDATE_FORCE": "true",
	}, nil, "test"); err != nil {
		t.Fatalf("enable force update: %v", err)
	}
	recorder := versionRequest(t, app, "/api/app/update?platform=ios&version=1.3.1")
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var response updateResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !response.UpdateAvailable || !response.Required {
		t.Fatalf("force update response = %#v", response)
	}
}
