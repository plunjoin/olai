package gallery

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"olai/internal/ai"
	"olai/internal/config"
	"olai/internal/media"
	"olai/internal/settings"
	"olai/internal/store"
)

func project(lyricSource any) map[string]any {
	return projection(
		store.RecordWithBody{StudioRecord: store.StudioRecord{Key: "record"}},
		map[string]any{"lrcSource": lyricSource},
		nil,
	)
}

func TestProjectionKeepsManualLyricTiming(t *testing.T) {
	if source := project("manual")["lrcSource"]; source != "manual" {
		t.Fatalf("manual lrcSource was dropped: %v", source)
	}
}

func TestProjectionDropsUnknownLyricSource(t *testing.T) {
	if _, ok := project("generated")["lrcSource"]; ok {
		t.Fatal("unknown lrcSource should not be published")
	}
}

func TestProjectionKeepsExistingLyricSources(t *testing.T) {
	for _, source := range []string{"estimated", "audio"} {
		if got := project(source)["lrcSource"]; got != source {
			t.Fatalf("lrcSource %q was dropped: %v", source, got)
		}
	}
}

func TestProjectionPublishesGenerationParameters(t *testing.T) {
	output := projection(
		store.RecordWithBody{StudioRecord: store.StudioRecord{Key: "record"}},
		map[string]any{
			"kind": "video", "modelLabel": "  omni-1.2  ",
			"options": map[string]any{
				"resolution": "1080p", "seconds": float64(8), "reasoning_effort": "high",
			},
		},
		nil,
	)
	if output["modelLabel"] != "omni-1.2" {
		t.Fatalf("modelLabel = %v, want trimmed alias", output["modelLabel"])
	}
	options, ok := output["options"].(map[string]any)
	if !ok {
		t.Fatalf("options = %v", output["options"])
	}
	if options["resolution"] != "1080p" {
		t.Fatalf("resolution = %v, want 1080p", options["resolution"])
	}
	if options["duration"] != float64(8) {
		t.Fatalf("duration = %v, want the requested seconds", options["duration"])
	}
	if options["reasoning_effort"] != "high" {
		t.Fatalf("reasoning_effort = %v, want high", options["reasoning_effort"])
	}
}

func TestProjectionDropsUnknownOptionsAndBlankLabel(t *testing.T) {
	output := projection(
		store.RecordWithBody{StudioRecord: store.StudioRecord{Key: "record"}},
		map[string]any{
			"kind": "image", "modelLabel": "   ",
			"options": map[string]any{
				"modelId": "mdl_0123456789abcdef01234567", "resolution": "16k",
				"reasoning_effort": "extreme", "music_mode": "auto",
			},
		},
		nil,
	)
	if _, ok := output["modelLabel"]; ok {
		t.Fatalf("blank modelLabel was published: %v", output["modelLabel"])
	}
	options := output["options"].(map[string]any)
	if len(options) != 0 {
		t.Fatalf("unknown options were published: %v", options)
	}
}

func TestProjectionKeepsPublicModelAlias(t *testing.T) {
	output := projection(
		store.RecordWithBody{StudioRecord: store.StudioRecord{Key: "record"}},
		map[string]any{"kind": "image", "modelLabel": "Nano Banana 2"},
		[]string{"gemini-3.1-flash-lite-image"},
	)
	if output["modelLabel"] != "Nano Banana 2" {
		t.Fatalf("public alias = %v, want Nano Banana 2", output["modelLabel"])
	}
}

func TestProjectionRedactsSecretsFromModelLabel(t *testing.T) {
	output := projection(
		store.RecordWithBody{StudioRecord: store.StudioRecord{Key: "record"}},
		map[string]any{"kind": "image", "modelLabel": "gemini-3.1-flash-image"},
		[]string{"gemini-3.1-flash-image"},
	)
	label, _ := output["modelLabel"].(string)
	if strings.Contains(label, "gemini") {
		t.Fatalf("modelLabel leaked a private model ID: %q", label)
	}
}

func TestHeatScoreWeightsEngagement(t *testing.T) {
	stats := store.GalleryStats{Views: 10, Downloads: 2, Favorites: 3}
	want := int64(10*heatViewWeight + 2*heatDownloadWeight + 3*heatFavoriteWeight)
	if got := heatScore(stats); got != want {
		t.Fatalf("heatScore = %d, want %d", got, want)
	}
	if got := heatScore(store.GalleryStats{}); got != 0 {
		t.Fatalf("empty heatScore = %d, want 0", got)
	}
}

func TestGalleryKeyRequiresOpaqueRecordKey(t *testing.T) {
	key := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	if got, ok := galleryKey("gallery_" + key); !ok || got != key {
		t.Fatalf("galleryKey(%q) = %q, %v", "gallery_"+key, got, ok)
	}
	for _, invalid := range []string{"", key, "gallery_abc", "gallery_" + key + "0", "gallery_" + strings.ToUpper(key)} {
		if _, ok := galleryKey(invalid); ok {
			t.Fatalf("galleryKey(%q) should be rejected", invalid)
		}
	}
}

func galleryManager(t *testing.T) (*Manager, *store.DB) {
	t.Helper()
	db, err := store.Open(context.Background(), config.Config{DatabaseURL: filepath.Join(t.TempDir(), "gallery.db")})
	if err != nil {
		t.Fatalf("open temp store: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	settingsManager := settings.New(db)
	return &Manager{
		DB: db, Settings: settingsManager,
		Media: &media.Manager{DB: db, Settings: settingsManager},
		AI:    &ai.Manager{Settings: settingsManager},
	}, db
}

func galleryUser(t *testing.T, db *store.DB, id string) {
	t.Helper()
	if _, err := db.ExecContext(context.Background(), `INSERT INTO users (id, email, password_hash, created_at, updated_at)
		VALUES (?, ?, 'hash', 0, 0)`, id, id+"@example.com"); err != nil {
		t.Fatalf("insert user %s: %v", id, err)
	}
}

func galleryAsset(t *testing.T, db *store.DB, userID, key string) {
	t.Helper()
	galleryAssetAt(t, db, userID, key, 1)
}

func galleryAssetAt(t *testing.T, db *store.DB, userID, key string, createdAt int64) {
	t.Helper()
	body, err := json.Marshal(map[string]any{
		"status": "completed", "kind": "image", "prompt": "test", "createdAt": createdAt,
	})
	if err != nil {
		t.Fatalf("encode asset %s: %v", key, err)
	}
	record := store.StudioRecord{
		Key: key, UserID: userID, Store: "assets", RecordID: "asset-" + key[:8],
		Data: string(body), CreatedAt: createdAt, UpdatedAt: createdAt,
	}
	if err := db.SaveRecord(context.Background(), record, nil); err != nil {
		t.Fatalf("save asset %s: %v", key, err)
	}
}

func galleryIDs(t *testing.T, page map[string]any) []string {
	t.Helper()
	records, ok := page["records"].([]any)
	if !ok {
		t.Fatalf("page records = %v", page["records"])
	}
	ids := make([]string, 0, len(records))
	for _, record := range records {
		asset, ok := record.(map[string]any)
		if !ok {
			t.Fatalf("asset = %v", record)
		}
		ids = append(ids, asset["id"].(string))
	}
	return ids
}

func galleryRequest(t *testing.T, path string) *http.Request {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, path, nil)
	r.RemoteAddr = "192.0.2.10:1234"
	r.Header.Set("User-Agent", "gallery-test")
	return r
}

func TestSetFavoriteIsAccountScopedAndUpdatesHeat(t *testing.T) {
	ctx := context.Background()
	m, db := galleryManager(t)
	galleryUser(t, db, "u1")
	galleryUser(t, db, "u2")
	key := strings.Repeat("a", 64)
	galleryAsset(t, db, "u1", key)
	id := "gallery_" + key

	result, err := m.SetFavorite(ctx, "u1", id, true)
	if err != nil {
		t.Fatalf("favorite: %v", err)
	}
	if result["favorite"] != true || result["favoriteCount"] != int64(1) || result["favoriteTotal"] != int64(1) || result["heat"] != int64(heatFavoriteWeight) {
		t.Fatalf("favorite result = %v", result)
	}
	// The portal validates the response with the shared metrics shape, which
	// includes the view and download counters.
	if _, ok := result["views"].(int64); !ok {
		t.Fatalf("favorite result missing views: %v", result)
	}
	if _, ok := result["downloads"].(int64); !ok {
		t.Fatalf("favorite result missing downloads: %v", result)
	}
	if _, err := m.SetFavorite(ctx, "u1", id, true); err != nil {
		t.Fatalf("duplicate favorite: %v", err)
	}
	result, err = m.SetFavorite(ctx, "u2", id, true)
	if err != nil || result["favoriteCount"] != int64(2) || result["favoriteTotal"] != int64(1) {
		t.Fatalf("second account favorite = %v err=%v", result, err)
	}
	result, err = m.SetFavorite(ctx, "u1", id, false)
	if err != nil || result["favorite"] != false || result["favoriteCount"] != int64(1) || result["favoriteTotal"] != int64(0) || result["heat"] != int64(heatFavoriteWeight) {
		t.Fatalf("unfavorite = %v err=%v", result, err)
	}
	if _, err := m.SetFavorite(ctx, "", id, true); err == nil {
		t.Fatal("guest favorite must be rejected")
	}
}

func TestHiddenFavoriteIsUncountedAndRemovable(t *testing.T) {
	ctx := context.Background()
	m, db := galleryManager(t)
	galleryUser(t, db, "u1")
	key := strings.Repeat("b", 64)
	galleryAsset(t, db, "u1", key)
	id := "gallery_" + key

	result, err := m.SetFavorite(ctx, "u1", id, true)
	if err != nil || result["favoriteTotal"] != int64(1) {
		t.Fatalf("favorite = %v err=%v", result, err)
	}
	if err := db.HideGalleryRecord(ctx, key, "test", "admin"); err != nil {
		t.Fatalf("hide: %v", err)
	}
	total, err := db.GalleryFavoriteTotal(ctx, "u1")
	if err != nil || total != 0 {
		t.Fatalf("hidden favorite total = %d err=%v", total, err)
	}
	keys, total, err := db.GalleryFavoriteKeys(ctx, "u1", batchSize, 0)
	if err != nil || len(keys) != 0 || total != 0 {
		t.Fatalf("hidden favorite keys = %v total=%d err=%v", keys, total, err)
	}
	if _, err := m.SetFavorite(ctx, "u1", id, true); err == nil {
		t.Fatal("hidden work must still not be favoritable")
	}
	result, err = m.SetFavorite(ctx, "u1", id, false)
	if err != nil || result["favorite"] != false || result["favoriteTotal"] != int64(0) {
		t.Fatalf("unfavorite hidden work = %v err=%v", result, err)
	}
	set, err := db.GalleryFavoriteSet(ctx, "u1", []string{key})
	if err != nil || len(set) != 0 {
		t.Fatalf("favorite row survived removal: %v err=%v", set, err)
	}
}

func TestRecordMetricCountsOncePerVisitorWindow(t *testing.T) {
	ctx := context.Background()
	m, db := galleryManager(t)
	galleryUser(t, db, "u1")
	key := strings.Repeat("b", 64)
	galleryAsset(t, db, "u1", key)
	id := "gallery_" + key
	r := galleryRequest(t, "/api/gallery/"+id+"/view")

	result, err := m.RecordView(ctx, r, id, "")
	if err != nil || result["views"] != int64(1) || result["heat"] != int64(heatViewWeight) {
		t.Fatalf("first view = %v err=%v", result, err)
	}
	result, err = m.RecordView(ctx, r, id, "")
	if err != nil || result["views"] != int64(1) {
		t.Fatalf("repeated view must be throttled: %v err=%v", result, err)
	}
	result, err = m.RecordDownload(ctx, r, id, "")
	if err != nil || result["downloads"] != int64(1) || result["heat"] != int64(heatViewWeight+heatDownloadWeight) {
		t.Fatalf("download = %v err=%v", result, err)
	}
	for expected := int64(2); expected <= 3; expected++ {
		result, err = m.RecordDownload(ctx, r, id, "")
		if err != nil || result["downloads"] != expected {
			t.Fatalf("download %d = %v err=%v", expected, result, err)
		}
	}
	result, err = m.RecordDownload(ctx, r, id, "")
	if err != nil || result["downloads"] != int64(3) {
		t.Fatalf("downloads beyond the daily cap must be throttled: %v err=%v", result, err)
	}
}

func TestReportDedupesGuestReportsAndRejectsSelfReport(t *testing.T) {
	ctx := context.Background()
	m, db := galleryManager(t)
	galleryUser(t, db, "owner")
	galleryUser(t, db, "reporter")
	key := strings.Repeat("c", 64)
	galleryAsset(t, db, "owner", key)
	id := "gallery_" + key
	r := galleryRequest(t, "/api/gallery/"+id+"/report")

	if err := m.Report(ctx, r, nil, id, "copyright", "copy"); err != nil {
		t.Fatalf("guest report: %v", err)
	}
	if err := m.Report(ctx, r, nil, id, "spam", "again"); err != nil {
		t.Fatalf("duplicate guest report must be ignored: %v", err)
	}
	rows, total, err := db.GalleryReports(ctx, "open", 10, 0)
	if err != nil || total != 1 || len(rows) != 1 || rows[0].Reason != "copyright" {
		t.Fatalf("reports = %d/%d err=%v", len(rows), total, err)
	}

	var safe *media.Error
	err = m.Report(ctx, r, &store.SessionUser{ID: "owner"}, id, "spam", "")
	if !errors.As(err, &safe) || safe.Code != "GALLERY_SELF_REPORT" {
		t.Fatalf("self report error = %v", err)
	}
	err = m.Report(ctx, r, &store.SessionUser{ID: "reporter"}, id, "other", " ")
	if !errors.As(err, &safe) || safe.Code != "GALLERY_REPORT_REASON" {
		t.Fatalf("empty detail error = %v", err)
	}
	if err := m.Report(ctx, r, &store.SessionUser{ID: "reporter"}, id, "copyright", "copy"); err != nil {
		t.Fatalf("signed-in report: %v", err)
	}
	if _, total, err := db.GalleryReports(ctx, "open", 10, 0); err != nil || total != 2 {
		t.Fatalf("open reports after signed-in report = %d err=%v", total, err)
	}
}

func TestImportFavoritesSkipsPrivateAndHiddenWorks(t *testing.T) {
	ctx := context.Background()
	m, db := galleryManager(t)
	galleryUser(t, db, "u1")
	publicKey := strings.Repeat("d", 64)
	hiddenKey := strings.Repeat("e", 64)
	otherKey := strings.Repeat("f", 64)
	galleryAsset(t, db, "u1", publicKey)
	galleryAsset(t, db, "u1", hiddenKey)
	if _, err := db.ExecContext(ctx, `INSERT INTO studio_records (key, user_id, store, record_id, data, updated_at)
		VALUES (?, 'u1', 'chats', 'chat-1', '{"status":"completed"}', 1)`, otherKey); err != nil {
		t.Fatalf("insert private record: %v", err)
	}
	if err := db.HideGalleryRecord(ctx, hiddenKey, "moderation", "admin"); err != nil {
		t.Fatalf("hide: %v", err)
	}
	ids := []string{"gallery_" + publicKey, "gallery_" + hiddenKey, "gallery_" + otherKey, "not-a-gallery-id"}
	imported, err := m.ImportFavorites(ctx, "u1", ids)
	if err != nil || imported != 1 {
		t.Fatalf("imported = %d err=%v", imported, err)
	}
	set, err := db.GalleryFavoriteSet(ctx, "u1", []string{publicKey, hiddenKey, otherKey})
	if err != nil || !set[publicKey] || set[hiddenKey] || set[otherKey] {
		t.Fatalf("favorite set = %v err=%v", set, err)
	}
	if imported, err := m.ImportFavorites(ctx, "", ids); err == nil || imported != 0 {
		t.Fatalf("guest import = %d err=%v", imported, err)
	}
}

func TestListNewOrdersByCreationTime(t *testing.T) {
	ctx := context.Background()
	m, db := galleryManager(t)
	galleryUser(t, db, "u1")
	oldest := strings.Repeat("1", 64)
	middle := strings.Repeat("2", 64)
	newest := strings.Repeat("3", 64)
	hidden := strings.Repeat("4", 64)
	incomplete := strings.Repeat("5", 64)
	galleryAssetAt(t, db, "u1", oldest, 1_000)
	galleryAssetAt(t, db, "u1", middle, 2_000)
	galleryAssetAt(t, db, "u1", newest, 3_000)
	galleryAssetAt(t, db, "u1", hidden, 4_000)
	if err := db.HideGalleryRecord(ctx, hidden, "moderation", "admin"); err != nil {
		t.Fatalf("hide: %v", err)
	}
	// An incomplete work sorts newest but is skipped instead of paged; it must
	// not disturb the creation order of the works around it.
	incompleteRecord := store.StudioRecord{
		Key: incomplete, UserID: "u1", Store: "assets", RecordID: "asset-incomplete",
		Data: `{"status":"pending","kind":"image","prompt":"test","createdAt":5000}`, CreatedAt: 5_000, UpdatedAt: 5_000,
	}
	if err := db.SaveRecord(ctx, incompleteRecord, nil); err != nil {
		t.Fatalf("save incomplete: %v", err)
	}

	page, err := m.List(ctx, galleryRequest(t, "/api/gallery?sort=new&limit=2"), "")
	if err != nil {
		t.Fatalf("list newest page: %v", err)
	}
	firstPage := galleryIDs(t, page)
	wantFirst := []string{"gallery_" + newest, "gallery_" + middle}
	if len(firstPage) != len(wantFirst) || firstPage[0] != wantFirst[0] || firstPage[1] != wantFirst[1] {
		t.Fatalf("first page = %v, want %v", firstPage, wantFirst)
	}
	if page["nextOffset"] != int64(2) {
		t.Fatalf("nextOffset = %v, want 2", page["nextOffset"])
	}

	page, err = m.List(ctx, galleryRequest(t, "/api/gallery?sort=new&limit=2&offset=2"), "")
	if err != nil {
		t.Fatalf("list oldest page: %v", err)
	}
	secondPage := galleryIDs(t, page)
	if len(secondPage) != 1 || secondPage[0] != "gallery_"+oldest {
		t.Fatalf("second page = %v", secondPage)
	}
	if page["nextOffset"] != nil {
		t.Fatalf("nextOffset = %v, want nil", page["nextOffset"])
	}

	// The default sort (no parameter) uses the same newest-first order.
	page, err = m.List(ctx, galleryRequest(t, "/api/gallery?limit=2"), "")
	if err != nil {
		t.Fatalf("list default page: %v", err)
	}
	if got := galleryIDs(t, page); len(got) != 2 || got[0] != "gallery_"+newest {
		t.Fatalf("default page = %v", got)
	}
}

func TestGalleryCommentsLifecycle(t *testing.T) {
	ctx := context.Background()
	m, db := galleryManager(t)
	galleryUser(t, db, "u1")
	galleryUser(t, db, "u2")
	if _, err := db.ExecContext(ctx, `UPDATE users SET name = ?, avatar = ? WHERE id = ?`, "Reader", "ocean", "u2"); err != nil {
		t.Fatalf("name test user: %v", err)
	}
	key := strings.Repeat("b", 64)
	galleryAsset(t, db, "u1", key)
	id := "gallery_" + key
	name := "Reader"
	avatar := "ocean"
	user := &store.SessionUser{ID: "u2", Name: &name, Avatar: &avatar}

	created, err := m.AddComment(ctx, galleryRequest(t, "/api/gallery/"+id+"/comments"), user, id, "  Nice work  ")
	if err != nil {
		t.Fatalf("add comment: %v", err)
	}
	if created["total"] != int64(1) {
		t.Fatalf("comment total = %v, want 1", created["total"])
	}
	comment, ok := created["comment"].(map[string]any)
	if !ok || comment["body"] != "Nice work" {
		t.Fatalf("created comment = %v", created["comment"])
	}
	author, ok := comment["author"].(map[string]any)
	if !ok || author["name"] != "Reader" || author["avatar"] != "ocean" {
		t.Fatalf("comment author = %v", comment["author"])
	}

	page, err := m.ListComments(ctx, galleryRequest(t, "/api/gallery/"+id+"/comments"), id)
	if err != nil {
		t.Fatalf("list comments: %v", err)
	}
	if page["total"] != int64(1) {
		t.Fatalf("list total = %v, want 1", page["total"])
	}
	comments, ok := page["comments"].([]any)
	if !ok || len(comments) != 1 {
		t.Fatalf("comments = %v", page["comments"])
	}
	listed, ok := comments[0].(map[string]any)
	if !ok || listed["body"] != "Nice work" {
		t.Fatalf("listed comment = %v", comments[0])
	}
	listedAuthor, ok := listed["author"].(map[string]any)
	if !ok || listedAuthor["name"] != "Reader" || listedAuthor["avatar"] != "ocean" {
		t.Fatalf("listed author = %v", listed["author"])
	}

	if _, err := m.AddComment(ctx, galleryRequest(t, "/api/gallery/"+id+"/comments"), user, id, "   "); err == nil {
		t.Fatal("blank comment should be rejected")
	}
}
