package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"olai/internal/auth"
	"olai/internal/httpx"
	"olai/internal/store"
)

func signIn(t *testing.T, db *store.DB, id, email string) string {
	t.Helper()
	if _, err := db.CreateUser(context.Background(), id, email, "hash", true); err != nil {
		t.Fatalf("create %s: %v", id, err)
	}
	token := strings.Repeat(fmt.Sprintf("%x", id[len(id)-1]), 64)[:64]
	if err := db.CreateSession(context.Background(), auth.Hash(token), id, time.Now().Add(time.Hour).UnixMilli()); err != nil {
		t.Fatalf("session %s: %v", id, err)
	}
	return token
}

func authed(method, path, token, body string) *http.Request {
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://example.com")
	if token != "" {
		request.AddCookie(&http.Cookie{Name: auth.SessionCookie, Value: token})
	}
	return request
}

func serve(app *Server, request *http.Request) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	app.mux.ServeHTTP(recorder, request)
	return recorder
}

func TestProfileReadDoesNotRequireOriginHeader(t *testing.T) {
	app, _, token := profileTestServer(t)
	request := httptest.NewRequest(http.MethodGet, "/api/profile", nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookie, Value: token})
	response := serve(app, request)
	if response.Code != http.StatusOK {
		t.Fatalf("profile read without Origin = %d %s", response.Code, response.Body.String())
	}
}

func TestNewUserProfileGetsPersistedDefaultHandle(t *testing.T) {
	app, _, token := profileTestServer(t)
	request := httptest.NewRequest(http.MethodGet, "/api/profile", nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookie, Value: token})
	response := serve(app, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"handle":"u-user1"`) {
		t.Fatalf("default profile = %d %s", response.Code, response.Body.String())
	}
	public := serve(app, httptest.NewRequest(http.MethodGet, "/api/users/u-user1", nil))
	if public.Code != http.StatusOK {
		t.Fatalf("default public profile = %d %s", public.Code, public.Body.String())
	}
}

func TestGuestCanOpenAProfileButNotAPrivateWork(t *testing.T) {
	app, user, token := profileTestServer(t)
	saved := serve(app, authed(http.MethodPut, "/api/profile", token, `{"handle":"river","bio":"画风景","showWorks":true,"showFavorites":false}`))
	if saved.Code != http.StatusOK {
		t.Fatalf("save profile = %d %s", saved.Code, saved.Body.String())
	}
	key := httpx.Hash(user.ID + ":assets:work-1")
	if err := app.DB.SaveRecord(context.Background(), store.StudioRecord{
		Key: key, UserID: user.ID, Store: "assets", RecordID: "work-1",
		Data: `{"status":"completed","kind":"image","prompt":"a river","createdAt":1,"options":{}}`, UpdatedAt: 1,
	}, nil); err != nil {
		t.Fatalf("save work: %v", err)
	}

	guest := serve(app, httptest.NewRequest(http.MethodGet, "/api/users/river", nil))
	if guest.Code != http.StatusOK || !strings.Contains(guest.Body.String(), `"bio":"画风景"`) {
		t.Fatalf("guest profile = %d %s", guest.Code, guest.Body.String())
	}
	works := serve(app, httptest.NewRequest(http.MethodGet, "/api/users/river/works", nil))
	if works.Code != http.StatusOK || !strings.Contains(works.Body.String(), "gallery_"+key) {
		t.Fatalf("public works = %d %s", works.Code, works.Body.String())
	}

	hidden := serve(app, authed(http.MethodPut, "/api/gallery/gallery_"+key+"/visibility", token, `{"visibility":"private"}`))
	if hidden.Code != http.StatusOK {
		t.Fatalf("hide work = %d %s", hidden.Code, hidden.Body.String())
	}
	works = serve(app, httptest.NewRequest(http.MethodGet, "/api/users/river/works", nil))
	if works.Code != http.StatusOK || strings.Contains(works.Body.String(), key) {
		t.Fatalf("private work stayed visible: %s", works.Body.String())
	}
	favorites := serve(app, httptest.NewRequest(http.MethodGet, "/api/users/river/favorites", nil))
	if favorites.Code != http.StatusNotFound {
		t.Fatalf("hidden favorites = %d, want 404", favorites.Code)
	}
}

func TestSavingAWorkPrivateRemovesItFromTheProfile(t *testing.T) {
	app, user, token := profileTestServer(t)
	if saved := serve(app, authed(http.MethodPut, "/api/profile", token, `{"handle":"river"}`)); saved.Code != http.StatusOK {
		t.Fatalf("profile = %d %s", saved.Code, saved.Body.String())
	}
	body := `{"id":"work-9","kind":"image","status":"completed","prompt":"a river","createdAt":1,"options":{},"visibility":"private"}`
	request := authed(http.MethodPut, "/api/records/assets", token, body)
	request.Header.Set("X-Olai-User", user.ID)
	saved := serve(app, request)
	if saved.Code != http.StatusOK {
		t.Fatalf("save = %d %s", saved.Code, saved.Body.String())
	}
	works := serve(app, httptest.NewRequest(http.MethodGet, "/api/users/river/works", nil))
	if works.Code != http.StatusOK || strings.Contains(works.Body.String(), "work-9") || strings.Contains(works.Body.String(), "a river") {
		t.Fatalf("private work stayed on the profile: %s", works.Body.String())
	}
}

func TestUpdatingAPrivateWorkKeepsVisibility(t *testing.T) {
	app, user, token := profileTestServer(t)
	if saved := serve(app, authed(http.MethodPut, "/api/profile", token, `{"handle":"river"}`)); saved.Code != http.StatusOK {
		t.Fatalf("profile = %d %s", saved.Code, saved.Body.String())
	}
	privateBody := `{"id":"work-10","kind":"image","status":"completed","prompt":"a private river","createdAt":1,"options":{},"visibility":"private"}`
	request := authed(http.MethodPut, "/api/records/assets", token, privateBody)
	request.Header.Set("X-Olai-User", user.ID)
	if saved := serve(app, request); saved.Code != http.StatusOK {
		t.Fatalf("save private = %d %s", saved.Code, saved.Body.String())
	}
	key := httpx.Hash(user.ID + ":assets:work-10")
	update := authed(http.MethodPut, "/api/records/assets", token, `{"id":"work-10","kind":"image","status":"completed","prompt":"updated","createdAt":1,"options":{}}`)
	update.Header.Set("X-Olai-User", user.ID)
	if saved := serve(app, update); saved.Code != http.StatusOK {
		t.Fatalf("update = %d %s", saved.Code, saved.Body.String())
	}
	visibility, err := app.DB.RecordVisibility(context.Background(), key)
	if err != nil || visibility != "private" {
		t.Fatalf("visibility after update = %q, %v; want private", visibility, err)
	}
}

func TestGuestImportKeepsPrivateVisibility(t *testing.T) {
	app, user, token := profileTestServer(t)
	body := `{"id":"work-11","kind":"image","status":"completed","prompt":"a private import","createdAt":1,"options":{},"visibility":"private"}`
	request := authed(http.MethodPut, "/api/records/assets?import=guest", token, body)
	request.Header.Set("X-Olai-User", user.ID)
	if saved := serve(app, request); saved.Code != http.StatusOK {
		t.Fatalf("guest import = %d %s", saved.Code, saved.Body.String())
	}
	key := httpx.Hash(user.ID + ":assets:work-11")
	visibility, err := app.DB.RecordVisibility(context.Background(), key)
	if err != nil || visibility != "private" {
		t.Fatalf("imported visibility = %q, %v; want private", visibility, err)
	}
}

func TestPublicFavoritesDoNotExposePrivateWorks(t *testing.T) {
	app, user, token := profileTestServer(t)
	if saved := serve(app, authed(http.MethodPut, "/api/profile", token, `{"handle":"river","showFavorites":true}`)); saved.Code != http.StatusOK {
		t.Fatalf("profile = %d %s", saved.Code, saved.Body.String())
	}
	key := httpx.Hash(user.ID + ":assets:work-hidden")
	if err := app.DB.SaveRecord(context.Background(), store.StudioRecord{
		Key: key, UserID: user.ID, Store: "assets", RecordID: "work-hidden",
		Data: `{"status":"completed","kind":"image","prompt":"a hidden cedar","createdAt":1,"options":{}}`, UpdatedAt: 1,
	}, nil); err != nil {
		t.Fatalf("save work: %v", err)
	}
	favorite := serve(app, authed(http.MethodPut, "/api/gallery/gallery_"+key+"/favorite", token, ""))
	if favorite.Code != http.StatusOK {
		t.Fatalf("favorite = %d %s", favorite.Code, favorite.Body.String())
	}
	hidden := serve(app, authed(http.MethodPut, "/api/gallery/gallery_"+key+"/visibility", token, `{"visibility":"private"}`))
	if hidden.Code != http.StatusOK {
		t.Fatalf("hide work = %d %s", hidden.Code, hidden.Body.String())
	}
	favorites := serve(app, httptest.NewRequest(http.MethodGet, "/api/users/river/favorites", nil))
	if favorites.Code != http.StatusOK {
		t.Fatalf("public favorites = %d %s", favorites.Code, favorites.Body.String())
	}
	if strings.Contains(favorites.Body.String(), "a hidden cedar") || strings.Contains(favorites.Body.String(), "gallery_"+key) {
		t.Fatalf("private favorite leaked: %s", favorites.Body.String())
	}
	var payload struct {
		FavoriteTotal int64 `json:"favoriteTotal"`
	}
	if err := json.Unmarshal(favorites.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode favorites: %v", err)
	}
	if payload.FavoriteTotal != 0 {
		t.Fatalf("public favorite total = %d, want 0", payload.FavoriteTotal)
	}
}

func TestBlockedUsersCannotMessage(t *testing.T) {
	app, _, token := profileTestServer(t)
	other := signIn(t, app.DB, "user-2", "user-2@example.com")
	if saved := serve(app, authed(http.MethodPut, "/api/profile", other, `{"handle":"cedar"}`)); saved.Code != http.StatusOK {
		t.Fatalf("other profile = %d %s", saved.Code, saved.Body.String())
	}
	if blocked := serve(app, authed(http.MethodPut, "/api/users/cedar/block", token, "")); blocked.Code != http.StatusOK {
		t.Fatalf("block = %d %s", blocked.Code, blocked.Body.String())
	}
	sent := serve(app, authed(http.MethodPost, "/api/users/cedar/messages", token, `{"body":"你好"}`))
	if sent.Code != http.StatusForbidden {
		t.Fatalf("message after block = %d %s", sent.Code, sent.Body.String())
	}
}

func TestFavoriteFolderHoldsOnlyItsOwnWorks(t *testing.T) {
	app, user, token := profileTestServer(t)
	key := httpx.Hash(user.ID + ":assets:work-2")
	if err := app.DB.SaveRecord(context.Background(), store.StudioRecord{
		Key: key, UserID: user.ID, Store: "assets", RecordID: "work-2",
		Data: `{"status":"completed","kind":"image","prompt":"a cedar","createdAt":1,"options":{}}`, UpdatedAt: 1,
	}, nil); err != nil {
		t.Fatalf("save work: %v", err)
	}
	if _, err := app.DB.AddGalleryFavorite(context.Background(), user.ID, key); err != nil {
		t.Fatalf("favorite: %v", err)
	}
	created := serve(app, authed(http.MethodPost, "/api/favorites/folders", token, `{"name":"风景"}`))
	if created.Code != http.StatusCreated {
		t.Fatalf("folder = %d %s", created.Code, created.Body.String())
	}
	id := folderIDFrom(created.Body.String())
	moved := serve(app, authed(http.MethodPut, "/api/gallery/gallery_"+key+"/folder", token, `{"folder":"`+id+`"}`))
	if moved.Code != http.StatusOK {
		t.Fatalf("place = %d %s", moved.Code, moved.Body.String())
	}
	keys, total, err := app.DB.GalleryFavoriteKeysIn(context.Background(), user.ID, id, 20, 0)
	if err != nil || total != 1 || len(keys) != 1 {
		t.Fatalf("folder contents = %v total=%d err=%v", keys, total, err)
	}
}

func folderIDFrom(body string) string {
	marker := `"id":"`
	start := strings.Index(body, marker)
	if start < 0 {
		return ""
	}
	rest := body[start+len(marker):]
	end := strings.Index(rest, `"`)
	if end < 0 {
		return ""
	}
	return rest[:end]
}
