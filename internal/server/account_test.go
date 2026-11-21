package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"olai/internal/auth"
	"olai/internal/config"
	"olai/internal/store"
)

// profileTestServer builds a server plus one signed-in account so profile
// handlers can run without the setup gate or a live site origin.
func profileTestServer(t *testing.T) (*Server, *store.User, string) {
	t.Helper()
	ctx := context.Background()
	db, err := store.Open(ctx, config.Config{DatabaseURL: filepath.Join(t.TempDir(), "test.db")})
	if err != nil {
		t.Fatalf("open temp store: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	user, err := db.CreateUser(ctx, "user-1", "user-1@example.com", "hash", true)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	token := strings.Repeat("a", 64)
	if err := db.CreateSession(ctx, auth.Hash(token), user.ID, time.Now().Add(time.Hour).UnixMilli()); err != nil {
		t.Fatalf("create session: %v", err)
	}
	return New(config.Config{}, db, nil, nil), user, token
}

func postProfile(t *testing.T, app *Server, token, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/api/auth/profile", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://example.com")
	request.AddCookie(&http.Cookie{Name: auth.SessionCookie, Value: token})
	recorder := httptest.NewRecorder()
	app.mux.ServeHTTP(recorder, request)
	return recorder
}

// Uploading an avatar must not require inventing a nickname first: an empty
// name is stored as NULL and the client keeps showing the email prefix.
func TestProfileAcceptsEmptyNameWithAvatar(t *testing.T) {
	app, user, token := profileTestServer(t)
	recorder := postProfile(t, app, token, `{"name":"","avatar":"ocean"}`)
	if recorder.Code != http.StatusOK {
		t.Fatalf("profile status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	stored, err := app.DB.UserByID(context.Background(), user.ID)
	if err != nil {
		t.Fatalf("reload user: %v", err)
	}
	if stored.Name != nil {
		t.Fatalf("stored name = %q, want NULL", *stored.Name)
	}
	if stored.Avatar == nil || *stored.Avatar != "ocean" {
		t.Fatalf("stored avatar = %v, want ocean", stored.Avatar)
	}
	if strings.Contains(recorder.Body.String(), `"name"`) {
		t.Fatalf("empty name should be omitted, body = %s", recorder.Body.String())
	}
}

func TestProfileRejectsLongName(t *testing.T) {
	app, _, token := profileTestServer(t)
	recorder := postProfile(t, app, token, `{"name":"abcdefghijklmnopqrstuvwxy","avatar":"ocean"}`)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("profile status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), "昵称不能超过 24 个字符。") {
		t.Fatalf("unexpected error body: %s", recorder.Body.String())
	}
}
