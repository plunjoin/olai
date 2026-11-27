package store

import (
	"context"
	"testing"
)

// insertWork writes one asset row with the given projection fields.
func insertWork(t *testing.T, db *DB, userID, key, kind, status, visibility string) {
	t.Helper()
	body := `{"status":"` + status + `","kind":"` + kind + `","prompt":"p","createdAt":1}`
	if _, err := db.ExecContext(context.Background(), `INSERT INTO studio_records
		(key, user_id, store, record_id, data, created_at, updated_at, visibility, title, kind, status)
		VALUES (?, ?, 'assets', ?, ?, 1, 1, ?, 't', ?, ?)`,
		key, userID, key, body, visibility, kind, status); err != nil {
		t.Fatalf("insert work %s: %v", key, err)
	}
}

func TestAccountGalleryStatsCountsOnlyPublishedWorks(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	insertUser(t, db, "u1")
	insertUser(t, db, "u2")

	insertWork(t, db, "u1", "k1", "image", "completed", "public")
	insertWork(t, db, "u1", "k2", "video", "completed", "public")
	insertWork(t, db, "u1", "k3", "music", "completed", "public")
	// A pending retry of a public work is not a published work.
	insertWork(t, db, "u1", "k4", "image", "pending", "public")
	// A private work is never counted.
	insertWork(t, db, "u1", "k5", "image", "completed", "private")
	// A failed work is not counted either.
	insertWork(t, db, "u1", "k6", "image", "failed", "public")
	// Another account's work must not be counted.
	insertWork(t, db, "u2", "k7", "image", "completed", "public")

	stats, err := db.AccountGalleryStats(ctx, "u1")
	if err != nil {
		t.Fatalf("stats: %v", err)
	}
	if stats.Works != 3 || stats.Images != 1 || stats.Videos != 1 || stats.Music != 1 {
		t.Fatalf("works were miscounted: %+v", stats)
	}

	// Engagement only counts the published works.
	for range []int{0, 1, 2} {
		if err := db.IncrementGalleryView(ctx, "k1"); err != nil {
			t.Fatalf("view: %v", err)
		}
	}
	if err := db.IncrementGalleryView(ctx, "k4"); err != nil {
		t.Fatalf("view: %v", err)
	}
	if _, err := db.AddGalleryFavorite(ctx, "u2", "k1"); err != nil {
		t.Fatalf("favorite: %v", err)
	}
	if _, err := db.AddGalleryFavorite(ctx, "u2", "k4"); err != nil {
		t.Fatalf("favorite: %v", err)
	}

	stats, err = db.AccountGalleryStats(ctx, "u1")
	if err != nil {
		t.Fatalf("stats: %v", err)
	}
	if stats.Plays != 3 {
		t.Fatalf("plays = %d, want 3", stats.Plays)
	}
	if stats.Likes != 1 {
		t.Fatalf("likes = %d, want 1", stats.Likes)
	}
}

func TestAccountGalleryStatsIgnoresHiddenWorks(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	insertUser(t, db, "u1")
	insertWork(t, db, "u1", "k1", "image", "completed", "public")

	if err := db.IncrementGalleryView(ctx, "k1"); err != nil {
		t.Fatalf("view: %v", err)
	}
	if err := db.HideGalleryRecord(ctx, "k1", "spam", "admin"); err != nil {
		t.Fatalf("hide: %v", err)
	}

	stats, err := db.AccountGalleryStats(ctx, "u1")
	if err != nil {
		t.Fatalf("stats: %v", err)
	}
	if stats.Works != 0 || stats.Plays != 0 {
		t.Fatalf("a taken-down work was counted: %+v", stats)
	}
}

func TestPublicFavoriteCountExcludesPrivateFavorites(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	insertUser(t, db, "u1")
	insertUser(t, db, "u2")
	insertWork(t, db, "u2", "k1", "image", "completed", "public")
	insertWork(t, db, "u2", "k2", "image", "completed", "private")
	insertWork(t, db, "u2", "k3", "image", "pending", "public")

	if _, err := db.AddGalleryFavorite(ctx, "u1", "k1"); err != nil {
		t.Fatalf("favorite: %v", err)
	}
	if _, err := db.AddGalleryFavorite(ctx, "u1", "k2"); err != nil {
		t.Fatalf("favorite: %v", err)
	}
	if _, err := db.AddGalleryFavorite(ctx, "u1", "k3"); err != nil {
		t.Fatalf("favorite: %v", err)
	}

	public, err := db.PublicFavoriteCount(ctx, "u1")
	if err != nil {
		t.Fatalf("public count: %v", err)
	}
	if public != 1 {
		t.Fatalf("public favorite count = %d, want 1", public)
	}
	total, err := db.GalleryFavoriteTotal(ctx, "u1")
	if err != nil {
		t.Fatalf("total: %v", err)
	}
	if total != 3 {
		t.Fatalf("total favorite count = %d, want 3", total)
	}
}
