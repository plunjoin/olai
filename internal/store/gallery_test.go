package store

import (
	"context"
	"testing"
)

func galleryRecord(t *testing.T, db *DB, userID, key string) StudioRecord {
	t.Helper()
	record := StudioRecord{
		Key: key, UserID: userID, Store: "assets", RecordID: "asset-" + key[:4],
		Data: `{"status":"completed","kind":"image","prompt":"test","createdAt":1}`, UpdatedAt: 1,
	}
	if err := db.SaveRecord(context.Background(), record, nil); err != nil {
		t.Fatalf("save record %s: %v", key, err)
	}
	return record
}

func TestGalleryFavoritesAreAccountScoped(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	insertUser(t, db, "u1")
	insertUser(t, db, "u2")
	galleryRecord(t, db, "u1", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")

	added, err := db.AddGalleryFavorite(ctx, "u1", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	if err != nil || !added {
		t.Fatalf("first favorite: added=%v err=%v", added, err)
	}
	added, err = db.AddGalleryFavorite(ctx, "u1", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	if err != nil || added {
		t.Fatalf("duplicate favorite must be idempotent: added=%v err=%v", added, err)
	}
	if total, err := db.GalleryFavoriteTotal(ctx, "u1"); err != nil || total != 1 {
		t.Fatalf("u1 favorite total = %d, err=%v", total, err)
	}
	if total, err := db.GalleryFavoriteTotal(ctx, "u2"); err != nil || total != 0 {
		t.Fatalf("u2 favorite total = %d, err=%v", total, err)
	}
	set, err := db.GalleryFavoriteSet(ctx, "u1", []string{"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"})
	if err != nil || !set["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] {
		t.Fatalf("favorite set missed the key: %v err=%v", set, err)
	}
	if removed, err := db.RemoveGalleryFavorite(ctx, "u1", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"); err != nil || !removed {
		t.Fatalf("remove favorite: removed=%v err=%v", removed, err)
	}
}

func TestGalleryStatsAggregateViewsDownloadsAndFavorites(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	insertUser(t, db, "u1")
	insertUser(t, db, "u2")
	key := "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	galleryRecord(t, db, "u1", key)
	for index := 0; index < 3; index++ {
		if err := db.IncrementGalleryView(ctx, key); err != nil {
			t.Fatalf("view %d: %v", index, err)
		}
	}
	if err := db.IncrementGalleryDownload(ctx, key); err != nil {
		t.Fatalf("download: %v", err)
	}
	for _, user := range []string{"u1", "u2"} {
		if _, err := db.AddGalleryFavorite(ctx, user, key); err != nil {
			t.Fatalf("favorite by %s: %v", user, err)
		}
	}
	stats, err := db.GalleryStatsFor(ctx, []string{key})
	if err != nil {
		t.Fatalf("stats: %v", err)
	}
	got := stats[key]
	if got.Views != 3 || got.Downloads != 1 || got.Favorites != 2 {
		t.Fatalf("stats = %+v, want views=3 downloads=1 favorites=2", got)
	}
}

func TestGalleryReportsAndTakedown(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	insertUser(t, db, "u1")
	insertUser(t, db, "reporter")
	key := "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
	galleryRecord(t, db, "u1", key)
	report := GalleryReportRow{
		ID: "r1", RecordKey: key, ReporterID: "reporter", ReporterFingerprint: "fp",
		Reason: "copyright", Detail: "copy", Status: "open", CreatedAt: 10,
	}
	if err := db.InsertGalleryReport(ctx, report); err != nil {
		t.Fatalf("insert report: %v", err)
	}
	exists, err := db.GalleryOpenReportExists(ctx, key, "reporter", "fp", 0)
	if err != nil || !exists {
		t.Fatalf("open report lookup: exists=%v err=%v", exists, err)
	}
	rows, total, err := db.GalleryReports(ctx, "open", 20, 0)
	if err != nil || total != 1 || len(rows) != 1 {
		t.Fatalf("reports = %d/%d err=%v", len(rows), total, err)
	}
	if rows[0].ReporterEmail != "reporter@example.com" {
		t.Fatalf("reporter email = %q", rows[0].ReporterEmail)
	}
	if err := db.SetRecordReportsStatus(ctx, key, "resolved", "admin@example.com", 20); err != nil {
		t.Fatalf("resolve reports: %v", err)
	}
	if count, err := db.CountOpenGalleryReports(ctx); err != nil || count != 0 {
		t.Fatalf("open reports after resolve = %d err=%v", count, err)
	}
	if hidden, err := db.IsGalleryHidden(ctx, key); err != nil || hidden {
		t.Fatalf("record should start visible: hidden=%v err=%v", hidden, err)
	}
	if err := db.HideGalleryRecord(ctx, key, "moderation", "admin@example.com"); err != nil {
		t.Fatalf("hide: %v", err)
	}
	hiddenKeys, err := db.GalleryHiddenKeys(ctx)
	if err != nil || !hiddenKeys[key] {
		t.Fatalf("hidden keys = %v err=%v", hiddenKeys, err)
	}
	if err := db.UnhideGalleryRecord(ctx, key); err != nil {
		t.Fatalf("unhide: %v", err)
	}
	if hidden, err := db.IsGalleryHidden(ctx, key); err != nil || hidden {
		t.Fatalf("record should be visible after unhide: hidden=%v err=%v", hidden, err)
	}
}

func TestDeleteRecordCleansGalleryMetadata(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	insertUser(t, db, "u1")
	key := "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
	record := galleryRecord(t, db, "u1", key)
	if _, err := db.AddGalleryFavorite(ctx, "u1", key); err != nil {
		t.Fatalf("favorite: %v", err)
	}
	if err := db.IncrementGalleryView(ctx, key); err != nil {
		t.Fatalf("view: %v", err)
	}
	if err := db.DeleteRecord(ctx, record.Key, record.UserID, record.Store); err != nil {
		t.Fatalf("delete record: %v", err)
	}
	if total, err := db.GalleryFavoriteTotal(ctx, "u1"); err != nil || total != 0 {
		t.Fatalf("favorites after delete = %d err=%v", total, err)
	}
	stats, err := db.GalleryStatsFor(ctx, []string{key})
	if err != nil {
		t.Fatalf("stats after delete: %v", err)
	}
	if stats[key].Views != 0 {
		t.Fatalf("views after delete = %d", stats[key].Views)
	}
}
