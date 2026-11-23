package server

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"olai/internal/auth"
	appversion "olai/internal/version"
)

func siteUpdateTestServer(t *testing.T, github http.Handler) (*Server, *httptest.Server, *http.Cookie) {
	t.Helper()
	app, db := adminTestServer(t)
	hash, err := auth.PasswordHash("admin-password", "")
	if err != nil {
		t.Fatalf("hash admin password: %v", err)
	}
	if _, err := db.CreateAdminAccount(context.Background(), "admin1", "admin@example.com", hash, nil); err != nil {
		t.Fatalf("create admin: %v", err)
	}
	if _, err := app.Settings.Save(context.Background(), map[string]any{
		"SITE_UPDATE_ENABLED":  "true",
		"SITE_UPDATE_REPO":     "plunjoin/olai",
		"SITE_UPDATE_WORKFLOW": "deploy.yml",
		"SITE_UPDATE_REF":      "master",
		"SITE_UPDATE_TOKEN":    "test-token",
	}, nil, "test"); err != nil {
		t.Fatalf("save update settings: %v", err)
	}
	fake := httptest.NewServer(github)
	oldBase := siteUpdateAPIBase
	siteUpdateAPIBase = fake.URL
	t.Cleanup(func() {
		siteUpdateAPIBase = oldBase
		fake.Close()
	})
	server := httptest.NewServer(app.Handler())
	t.Cleanup(server.Close)
	response := adminPost(t, server.URL+"/api/admin/auth/login", map[string]any{
		"email": "admin@example.com", "password": "admin-password",
	})
	if response.StatusCode != http.StatusOK {
		t.Fatalf("admin login = %d", response.StatusCode)
	}
	cookie := sessionCookie(t, response, auth.AdminSessionCookie)
	response.Body.Close()
	return app, server, cookie
}

func TestAdminSiteUpdateReportsTagsAndTriggersWorkflow(t *testing.T) {
	originalVersion := appversion.Version
	appversion.Version = "1.5.0"
	t.Cleanup(func() { appversion.Version = originalVersion })

	var mu sync.Mutex
	var dispatch map[string]any
	github := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Errorf("authorization = %q", r.Header.Get("Authorization"))
		}
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/repos/plunjoin/olai/tags":
			writeJSON(w, http.StatusOK, []map[string]any{
				{"name": "v1.5.0", "commit": map[string]any{"sha": "aaaa"}},
				{"name": "v1.6.0-rc.1", "commit": map[string]any{"sha": "bbbb"}},
				{"name": "v1.6.0", "commit": map[string]any{"sha": "cccc"}},
				{"name": "not-a-version", "commit": map[string]any{"sha": "dddd"}},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/repos/plunjoin/olai/actions/workflows/deploy.yml/runs":
			writeJSON(w, http.StatusOK, map[string]any{"workflow_runs": []map[string]any{
				{"id": 42, "status": "completed", "conclusion": "success", "display_title": "Deploy production",
					"event": "workflow_dispatch", "head_branch": "master", "created_at": "2026-11-23T00:00:00Z",
					"updated_at": "2026-11-23T00:03:00Z", "html_url": "https://github.com/plunjoin/olai/actions/runs/42"},
			}})
		case r.Method == http.MethodGet && r.URL.Path == "/repos/plunjoin/olai/git/ref/tags/v1.6.0":
			writeJSON(w, http.StatusOK, map[string]any{"ref": "refs/tags/v1.6.0"})
		case r.Method == http.MethodPost && r.URL.Path == "/repos/plunjoin/olai/actions/workflows/deploy.yml/dispatches":
			mu.Lock()
			defer mu.Unlock()
			if err := json.NewDecoder(r.Body).Decode(&dispatch); err != nil {
				t.Errorf("decode dispatch: %v", err)
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	})
	_, server, cookie := siteUpdateTestServer(t, github)

	response := adminGet(t, server.URL+"/api/admin/site-update", cookie)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", response.StatusCode)
	}
	var status siteUpdateStatus
	if err := json.NewDecoder(response.Body).Decode(&status); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	response.Body.Close()
	if !status.Enabled || !status.Configured {
		t.Fatalf("update status = %+v", status)
	}
	if status.LatestTag != "v1.6.0" || !status.UpdateAvailable {
		t.Fatalf("latest = %q update=%v", status.LatestTag, status.UpdateAvailable)
	}
	if len(status.Tags) != 3 || status.Tags[0].Name != "v1.6.0" {
		t.Fatalf("tags = %+v", status.Tags)
	}
	if len(status.Runs) != 1 || status.Runs[0].Conclusion != "success" {
		t.Fatalf("runs = %+v", status.Runs)
	}

	response = adminPost(t, server.URL+"/api/admin/site-update", map[string]any{"tag": "v1.6.0"}, cookie)
	if response.StatusCode != http.StatusAccepted {
		t.Fatalf("trigger = %d %s", response.StatusCode, readAll(t, response))
	}
	response.Body.Close()
	mu.Lock()
	defer mu.Unlock()
	if dispatch["ref"] != "master" {
		t.Fatalf("dispatch ref = %v", dispatch["ref"])
	}
	inputs, _ := dispatch["inputs"].(map[string]any)
	if inputs["tag"] != "v1.6.0" {
		t.Fatalf("dispatch inputs = %v", dispatch["inputs"])
	}
}

func TestAdminSiteUpdateRejectsAnActiveDeployment(t *testing.T) {
	github := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/plunjoin/olai/actions/workflows/deploy.yml/runs":
			writeJSON(w, http.StatusOK, map[string]any{"workflow_runs": []map[string]any{
				{"id": 43, "status": "in_progress", "conclusion": "", "html_url": "https://github.com/plunjoin/olai/actions/runs/43"},
			}})
		default:
			http.NotFound(w, r)
		}
	})
	_, server, cookie := siteUpdateTestServer(t, github)
	response := adminPost(t, server.URL+"/api/admin/site-update", map[string]any{"tag": "v1.6.0"}, cookie)
	if response.StatusCode != http.StatusConflict {
		t.Fatalf("active deployment = %d, want 409", response.StatusCode)
	}
	response.Body.Close()
}

func TestAdminSiteUpdateRequiresAuthentication(t *testing.T) {
	app, _ := adminTestServer(t)
	request := httptest.NewRequest(http.MethodGet, "/api/admin/site-update", nil)
	recorder := httptest.NewRecorder()
	app.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status = %d", recorder.Code)
	}
	if strings.Contains(recorder.Body.String(), "test-token") {
		t.Fatal("update response leaked the GitHub token")
	}
}

func readAll(t *testing.T, response *http.Response) string {
	t.Helper()
	data, _ := io.ReadAll(response.Body)
	return string(data)
}
