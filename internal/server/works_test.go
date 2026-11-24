package server

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"olai/internal/auth"
	"olai/internal/httpx"
	"olai/internal/store"
)

func adminWorkServer(t *testing.T) (*Server, *store.DB, *http.Cookie) {
	t.Helper()
	app, db := adminTestServer(t)
	ctx := context.Background()
	admin, err := db.CreateAdminAccount(ctx, "admin-1", "admin@example.com", "hash", nil)
	if err != nil {
		t.Fatalf("create admin: %v", err)
	}
	token := strings.Repeat("b", 64)
	if err := db.CreateAdminSession(ctx, auth.Hash(token), admin.ID, time.Now().Add(time.Hour).UnixMilli()); err != nil {
		t.Fatalf("create admin session: %v", err)
	}
	return app, db, &http.Cookie{Name: auth.AdminSessionCookie, Value: token}
}

func adminWorkRequest(t *testing.T, app *Server, cookie *http.Cookie, method, path string, body []byte, contentType string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, path, bytes.NewReader(body))
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	request.Header.Set("Origin", "http://example.com")
	request.AddCookie(cookie)
	recorder := httptest.NewRecorder()
	app.mux.ServeHTTP(recorder, request)
	return recorder
}

func createOfficialWork(t *testing.T, app *Server, cookie *http.Cookie) (map[string]any, *httptest.ResponseRecorder) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for name, value := range map[string]string{
		"kind": "image", "title": "Official poster", "prompt": "A calm blue horizon",
		"visibility": "public", "tags": "ocean, calm",
	} {
		if err := writer.WriteField(name, value); err != nil {
			t.Fatalf("write field: %v", err)
		}
	}
	part, err := writer.CreateFormFile("file", "poster.png")
	if err != nil {
		t.Fatalf("create file part: %v", err)
	}
	if _, err := part.Write([]byte("\x89PNG\r\n\x1a\nrest-of-png")); err != nil {
		t.Fatalf("write file: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}
	recorder := adminWorkRequest(t, app, cookie, http.MethodPost, "/api/admin/works", body.Bytes(), writer.FormDataContentType())
	var created map[string]any
	if recorder.Code == http.StatusCreated {
		if err := json.Unmarshal(recorder.Body.Bytes(), &created); err != nil {
			t.Fatalf("decode create: %v", err)
		}
	}
	return created, recorder
}

func TestAdminCreatesUpdatesHidesAndDeletesWork(t *testing.T) {
	ctx := context.Background()
	app, db, cookie := adminWorkServer(t)
	created, recorder := createOfficialWork(t, app, cookie)
	if recorder.Code != http.StatusCreated {
		t.Fatalf("create = %d body=%s", recorder.Code, recorder.Body.String())
	}
	key, _ := created["recordKey"].(string)
	if key == "" || created["id"] != "gallery_"+key {
		t.Fatalf("created = %+v", created)
	}
	record, err := db.RecordByKey(ctx, key)
	if err != nil {
		t.Fatalf("load created work: %v", err)
	}
	if record.UserID != store.OfficialUserID || record.Visibility != "public" {
		t.Fatalf("created record = %+v", record)
	}
	var value map[string]any
	if err := json.Unmarshal([]byte(record.Body), &value); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if value["title"] != "Official poster" || value["kind"] != "image" || value["status"] != "completed" {
		t.Fatalf("body = %+v", value)
	}
	if url, _ := value["url"].(string); !strings.HasPrefix(url, "data:image/png;base64,") {
		t.Fatalf("inline media url = %q", url)
	}
	tags, _ := value["tags"].([]any)
	if len(tags) != 2 || tags[0] != "ocean" || tags[1] != "calm" {
		t.Fatalf("tags = %v", tags)
	}

	list := adminWorkRequest(t, app, cookie, http.MethodGet, "/api/admin/works?q=Official", nil, "")
	if list.Code != http.StatusOK {
		t.Fatalf("list = %d body=%s", list.Code, list.Body.String())
	}
	var page struct {
		Works []map[string]any `json:"works"`
		Total int64            `json:"total"`
	}
	if err := json.Unmarshal(list.Body.Bytes(), &page); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if page.Total != 1 || len(page.Works) != 1 || page.Works[0]["title"] != "Official poster" || page.Works[0]["system"] != true {
		t.Fatalf("list page = %+v", page)
	}

	update := adminWorkRequest(t, app, cookie, http.MethodPut, "/api/admin/works/gallery_"+key,
		[]byte(`{"title":"Renamed work","prompt":"New description","visibility":"private"}`), "application/json")
	if update.Code != http.StatusOK {
		t.Fatalf("update = %d body=%s", update.Code, update.Body.String())
	}
	record, err = db.RecordByKey(ctx, key)
	if err != nil {
		t.Fatalf("reload work: %v", err)
	}
	if err := json.Unmarshal([]byte(record.Body), &value); err != nil {
		t.Fatalf("decode updated body: %v", err)
	}
	if value["title"] != "Renamed work" || value["prompt"] != "New description" || record.Visibility != "private" {
		t.Fatalf("updated body = %+v visibility=%s", value, record.Visibility)
	}

	hide := adminWorkRequest(t, app, cookie, http.MethodPut, "/api/admin/works/gallery_"+key,
		[]byte(`{"hidden":true}`), "application/json")
	if hide.Code != http.StatusOK {
		t.Fatalf("hide = %d body=%s", hide.Code, hide.Body.String())
	}
	hidden, err := db.IsGalleryHidden(ctx, key)
	if err != nil || !hidden {
		t.Fatalf("hidden = %v err=%v", hidden, err)
	}

	remove := adminWorkRequest(t, app, cookie, http.MethodDelete, "/api/admin/works/gallery_"+key, nil, "")
	if remove.Code != http.StatusOK {
		t.Fatalf("delete = %d body=%s", remove.Code, remove.Body.String())
	}
	if _, err := db.RecordByKey(ctx, key); err == nil {
		t.Fatal("work still exists after delete")
	}
}

func createMusicWork(t *testing.T, app *Server, cookie *http.Cookie, cover []byte, coverName, lyrics, lrc string) (map[string]any, *httptest.ResponseRecorder) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for name, value := range map[string]string{
		"kind": "music", "title": "Night tide", "prompt": "A slow song about the sea",
		"visibility": "public", "lyrics": lyrics, "lrc": lrc,
	} {
		if err := writer.WriteField(name, value); err != nil {
			t.Fatalf("write field: %v", err)
		}
	}
	song, err := writer.CreateFormFile("file", "song.mp3")
	if err != nil {
		t.Fatalf("create song part: %v", err)
	}
	if _, err := song.Write([]byte("\xff\xfb\x90\x00rest-of-mp3")); err != nil {
		t.Fatalf("write song: %v", err)
	}
	if cover != nil {
		part, err := writer.CreateFormFile("cover", coverName)
		if err != nil {
			t.Fatalf("create cover part: %v", err)
		}
		if _, err := part.Write(cover); err != nil {
			t.Fatalf("write cover: %v", err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}
	recorder := adminWorkRequest(t, app, cookie, http.MethodPost, "/api/admin/works", body.Bytes(), writer.FormDataContentType())
	var created map[string]any
	if recorder.Code == http.StatusCreated {
		if err := json.Unmarshal(recorder.Body.Bytes(), &created); err != nil {
			t.Fatalf("decode create: %v", err)
		}
	}
	return created, recorder
}

func TestAdminMusicWorkAcceptsCoverAndLyrics(t *testing.T) {
	ctx := context.Background()
	app, db, cookie := adminWorkServer(t)
	cover := []byte("\x89PNG\r\n\x1a\nrest-of-png")
	created, recorder := createMusicWork(t, app, cookie, cover, "cover.png",
		"第一句\n第二句", "[00:01.00]第一句\n[00:03.00]第二句")
	if recorder.Code != http.StatusCreated {
		t.Fatalf("create = %d body=%s", recorder.Code, recorder.Body.String())
	}
	key, _ := created["recordKey"].(string)
	record, err := db.RecordByKey(ctx, key)
	if err != nil {
		t.Fatalf("load created work: %v", err)
	}
	var value map[string]any
	if err := json.Unmarshal([]byte(record.Body), &value); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if url, _ := value["coverUrl"].(string); !strings.HasPrefix(url, "data:image/png;base64,") {
		t.Fatalf("cover url = %q", url)
	}
	if value["coverStatus"] != "completed" {
		t.Fatalf("cover status = %v", value["coverStatus"])
	}
	if value["lyrics"] != "第一句\n第二句" || value["lrc"] != "[00:01.00]第一句\n[00:03.00]第二句" {
		t.Fatalf("lyrics = %v / %v", value["lyrics"], value["lrc"])
	}
	if value["lrcSource"] != "manual" {
		t.Fatalf("lrc source = %v", value["lrcSource"])
	}
	if _, ok := value["song"].(map[string]any); !ok {
		t.Fatalf("song = %v", value["song"])
	}

	// The public projection exposes the cover and both lyric forms.
	gallery := serve(app, httptest.NewRequest(http.MethodGet, "/api/gallery?offset=0&limit=30&sort=new", nil))
	if gallery.Code != http.StatusOK {
		t.Fatalf("gallery = %d body=%s", gallery.Code, gallery.Body.String())
	}
	var listing struct {
		Records []map[string]any `json:"records"`
	}
	if err := json.Unmarshal(gallery.Body.Bytes(), &listing); err != nil {
		t.Fatalf("decode gallery: %v", err)
	}
	if len(listing.Records) != 1 {
		t.Fatalf("gallery records = %d body=%s", len(listing.Records), gallery.Body.String())
	}
	item := listing.Records[0]
	if url, _ := item["coverUrl"].(string); !strings.HasPrefix(url, "/api/gallery/media/") {
		t.Fatalf("public cover = %q", url)
	}
	if item["coverStatus"] != "completed" || item["lyrics"] != "第一句\n第二句" || item["lrcSource"] != "manual" {
		t.Fatalf("public music fields = %+v", item)
	}
}

func TestAdminMusicWorkRejectsBadCoverAndLongLyrics(t *testing.T) {
	app, _, cookie := adminWorkServer(t)
	_, badCover := createMusicWork(t, app, cookie, []byte("not an image"), "cover.mp3", "", "")
	if badCover.Code != http.StatusBadRequest || !strings.Contains(badCover.Body.String(), "封面需要是图片文件") {
		t.Fatalf("bad cover = %d body=%s", badCover.Code, badCover.Body.String())
	}
	long := strings.Repeat("长", maxWorkLyricsRunes+1)
	_, longLyrics := createMusicWork(t, app, cookie, nil, "", long, "")
	if longLyrics.Code != http.StatusBadRequest || !strings.Contains(longLyrics.Body.String(), "歌词不能超过") {
		t.Fatalf("long lyrics = %d body=%s", longLyrics.Code, longLyrics.Body.String())
	}
}

func TestAdminWorkCreateRejectsMismatchedFile(t *testing.T) {
	app, _, cookie := adminWorkServer(t)
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	writer.WriteField("kind", "video")
	writer.WriteField("title", "Not a video")
	part, _ := writer.CreateFormFile("file", "poster.png")
	part.Write([]byte("\x89PNG\r\n\x1a\nrest-of-png"))
	writer.Close()
	recorder := adminWorkRequest(t, app, cookie, http.MethodPost, "/api/admin/works", body.Bytes(), writer.FormDataContentType())
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("mismatched file = %d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestSaveRecordMirrorsWorkTitleAndRejectsLongNames(t *testing.T) {
	ctx := context.Background()
	app, user, token := profileTestServer(t)
	now := time.Now().UnixMilli()
	body := `{"id":"asset-1","kind":"image","status":"completed","prompt":"first line\nsecond line",` +
		`"createdAt":` + strconv.FormatInt(now, 10) + `,"options":{},"title":"  Custom Name  "}`
	request := httptest.NewRequest(http.MethodPut, "/api/records/assets", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://example.com")
	request.Header.Set("X-Olai-User", user.ID)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookie, Value: token})
	recorder := httptest.NewRecorder()
	app.mux.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("save = %d body=%s", recorder.Code, recorder.Body.String())
	}
	key := httpx.Hash(user.ID + ":assets:asset-1")
	var title, kind string
	if err := app.DB.QueryRowContext(ctx, `SELECT title, kind FROM studio_records WHERE key = ?`, key).Scan(&title, &kind); err != nil {
		t.Fatalf("read projection: %v", err)
	}
	if title != "Custom Name" || kind != "image" {
		t.Fatalf("projection = %q/%q", title, kind)
	}

	long := strings.Repeat("长", 81)
	body = `{"id":"asset-1","kind":"image","status":"completed","prompt":"x",` +
		`"createdAt":` + strconv.FormatInt(now, 10) + `,"options":{},"title":"` + long + `"}`
	request = httptest.NewRequest(http.MethodPut, "/api/records/assets", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://example.com")
	request.Header.Set("X-Olai-User", user.ID)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookie, Value: token})
	recorder = httptest.NewRecorder()
	app.mux.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("long title = %d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestOwnerRenamesGalleryWork(t *testing.T) {
	ctx := context.Background()
	app, user, token := profileTestServer(t)
	now := time.Now().UnixMilli()
	key := httpx.Hash(user.ID + ":assets:asset-1")
	original := `{"id":"asset-1","kind":"image","status":"completed","prompt":"old prompt",` +
		`"createdAt":` + strconv.FormatInt(now, 10) + `,"options":{}}`
	if err := app.DB.SaveRecord(ctx, store.StudioRecord{
		Key: key, UserID: user.ID, Store: "assets", RecordID: "asset-1",
		Data: original, CreatedAt: now, UpdatedAt: now, Visibility: "public", Title: "old prompt", Kind: "image",
	}, nil); err != nil {
		t.Fatalf("save work: %v", err)
	}
	rename := func(cookie *http.Cookie, body string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodPut, "/api/gallery/gallery_"+key+"/meta", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Origin", "http://example.com")
		request.AddCookie(cookie)
		recorder := httptest.NewRecorder()
		app.mux.ServeHTTP(recorder, request)
		return recorder
	}
	recorder := rename(&http.Cookie{Name: auth.SessionCookie, Value: token}, `{"title":"  New Name  ","prompt":"new description"}`)
	if recorder.Code != http.StatusOK {
		t.Fatalf("owner rename = %d body=%s", recorder.Code, recorder.Body.String())
	}
	var result struct {
		Title        string `json:"title"`
		DisplayTitle string `json:"displayTitle"`
		Prompt       string `json:"prompt"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode rename: %v", err)
	}
	if result.Title != "New Name" || result.DisplayTitle != "New Name" || result.Prompt != "new description" {
		t.Fatalf("rename result = %+v", result)
	}
	record, err := app.DB.RecordByKey(ctx, key)
	if err != nil {
		t.Fatalf("reload work: %v", err)
	}
	var value map[string]any
	if err := json.Unmarshal([]byte(record.Body), &value); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if value["title"] != "New Name" || value["prompt"] != "new description" || value["kind"] != "image" {
		t.Fatalf("stored body = %+v", value)
	}

	// A different signed-in account cannot rename someone else's work.
	other, err := app.DB.CreateUser(ctx, "user-2", "user-2@example.com", "hash", true)
	if err != nil {
		t.Fatalf("create other user: %v", err)
	}
	otherToken := strings.Repeat("c", 64)
	if err := app.DB.CreateSession(ctx, auth.Hash(otherToken), other.ID, time.Now().Add(time.Hour).UnixMilli()); err != nil {
		t.Fatalf("create other session: %v", err)
	}
	recorder = rename(&http.Cookie{Name: auth.SessionCookie, Value: otherToken}, `{"title":"Stolen"}`)
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("foreign rename = %d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestNewWorksStartPrivateAndOwnerPublishesByRecordID(t *testing.T) {
	ctx := context.Background()
	app, user, token := profileTestServer(t)
	now := time.Now().UnixMilli()
	body := `{"id":"asset-pub","kind":"image","status":"completed","prompt":"fresh work",` +
		`"createdAt":` + strconv.FormatInt(now, 10) + `,"options":{}}`
	saveBody := func(payload string) *httptest.ResponseRecorder {
		request := authed(http.MethodPut, "/api/records/assets", token, payload)
		request.Header.Set("X-Olai-User", user.ID)
		return serve(app, request)
	}
	save := func() *httptest.ResponseRecorder { return saveBody(body) }
	if saved := save(); saved.Code != http.StatusOK {
		t.Fatalf("save = %d body=%s", saved.Code, saved.Body.String())
	}
	key := httpx.Hash(user.ID + ":assets:asset-pub")
	visibility, err := app.DB.RecordVisibility(ctx, key)
	if err != nil || visibility != "private" {
		t.Fatalf("new work visibility = %q err=%v, want private", visibility, err)
	}

	// A reload shows the owner the real state, so the publish action appears.
	list := func() *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodGet, "/api/records/assets", nil)
		request.Header.Set("X-Olai-User", user.ID)
		request.AddCookie(&http.Cookie{Name: auth.SessionCookie, Value: token})
		return serve(app, request)
	}
	if response := list(); response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"visibility":"private"`) {
		t.Fatalf("list = %d body=%s", response.Code, response.Body.String())
	}

	publish := func(token, userID, store, id, body string) *httptest.ResponseRecorder {
		request := authed(http.MethodPut, "/api/records/"+store+"/"+id+"/visibility", token, body)
		request.Header.Set("X-Olai-User", userID)
		return serve(app, request)
	}
	if published := publish(token, user.ID, "assets", "asset-pub", `{"visibility":"public"}`); published.Code != http.StatusOK {
		t.Fatalf("publish = %d body=%s", published.Code, published.Body.String())
	}
	if visibility, err = app.DB.RecordVisibility(ctx, key); err != nil || visibility != "public" {
		t.Fatalf("visibility after publish = %q err=%v, want public", visibility, err)
	}
	if response := list(); !strings.Contains(response.Body.String(), `"visibility":"public"`) {
		t.Fatalf("list after publish = %d body=%s", response.Code, response.Body.String())
	}

	// A normal edit without a visibility keeps the work published.
	if saved := save(); saved.Code != http.StatusOK {
		t.Fatalf("edit = %d body=%s", saved.Code, saved.Body.String())
	}
	if visibility, err = app.DB.RecordVisibility(ctx, key); err != nil || visibility != "public" {
		t.Fatalf("visibility after edit = %q err=%v, want public", visibility, err)
	}

	// A stale full-record save that still carries its old visibility must not
	// change the stored state; only the dedicated endpoint publishes or
	// withdraws a work.
	stale := `{"id":"asset-pub","kind":"image","status":"completed","prompt":"fresh work",` +
		`"createdAt":` + strconv.FormatInt(now, 10) + `,"options":{},"visibility":"private"}`
	if saved := saveBody(stale); saved.Code != http.StatusOK {
		t.Fatalf("stale save = %d body=%s", saved.Code, saved.Body.String())
	}
	if visibility, err = app.DB.RecordVisibility(ctx, key); err != nil || visibility != "public" {
		t.Fatalf("visibility after stale save = %q err=%v, want public", visibility, err)
	}

	// The owner can withdraw it again.
	if withdrawn := publish(token, user.ID, "assets", "asset-pub", `{"visibility":"private"}`); withdrawn.Code != http.StatusOK {
		t.Fatalf("withdraw = %d body=%s", withdrawn.Code, withdrawn.Body.String())
	}
	if visibility, err = app.DB.RecordVisibility(ctx, key); err != nil || visibility != "private" {
		t.Fatalf("visibility after withdraw = %q err=%v, want private", visibility, err)
	}
	stale = `{"id":"asset-pub","kind":"image","status":"completed","prompt":"fresh work",` +
		`"createdAt":` + strconv.FormatInt(now, 10) + `,"options":{},"visibility":"public"}`
	if saved := saveBody(stale); saved.Code != http.StatusOK {
		t.Fatalf("stale publish = %d body=%s", saved.Code, saved.Body.String())
	}
	if visibility, err = app.DB.RecordVisibility(ctx, key); err != nil || visibility != "private" {
		t.Fatalf("visibility after stale publish = %q err=%v, want private", visibility, err)
	}

	// Invalid values, other owners and unrelated stores are rejected.
	if bad := publish(token, user.ID, "assets", "asset-pub", `{"visibility":"secret"}`); bad.Code != http.StatusBadRequest {
		t.Fatalf("invalid visibility = %d body=%s", bad.Code, bad.Body.String())
	}
	secondToken := signIn(t, app.DB, "user-2", "user-2@example.com")
	if foreign := publish(secondToken, "user-2", "assets", "asset-pub", `{"visibility":"public"}`); foreign.Code != http.StatusNotFound {
		t.Fatalf("foreign publish = %d body=%s", foreign.Code, foreign.Body.String())
	}
	if wrongStore := publish(token, user.ID, "workflows", "asset-pub", `{"visibility":"public"}`); wrongStore.Code != http.StatusNotFound {
		t.Fatalf("non-asset store = %d body=%s", wrongStore.Code, wrongStore.Body.String())
	}
	staleRequest := authed(http.MethodPut, "/api/records/assets/asset-pub/visibility", token, `{"visibility":"public"}`)
	if stale := serve(app, staleRequest); stale.Code != http.StatusConflict {
		t.Fatalf("missing account header = %d body=%s", stale.Code, stale.Body.String())
	}
	guestRequest := authed(http.MethodPut, "/api/records/assets/asset-pub/visibility", "", `{"visibility":"public"}`)
	if guest := serve(app, guestRequest); guest.Code != http.StatusUnauthorized {
		t.Fatalf("guest publish = %d body=%s", guest.Code, guest.Body.String())
	}
}
