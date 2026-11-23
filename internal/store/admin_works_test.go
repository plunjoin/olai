package store

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

func saveTestWork(t *testing.T, db *DB, index int, userID, title, kind, visibility string) string {
	t.Helper()
	key := recordKey(index)
	record := StudioRecord{
		Key: key, UserID: userID, Store: "assets", RecordID: "asset-" + key[:8],
		Data:      `{"id":"asset","kind":"` + kind + `","prompt":"p"}`,
		CreatedAt: int64(1000 + index), UpdatedAt: int64(1000 + index),
		Visibility: visibility, Title: title, Kind: kind,
	}
	if err := db.SaveRecord(context.Background(), record, nil); err != nil {
		t.Fatalf("save work: %v", err)
	}
	return key
}

func TestAdminWorksFiltersAndSearch(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	insertUser(t, db, "u1")
	official, err := db.EnsureSystemUser(ctx)
	if err != nil {
		t.Fatalf("ensure system user: %v", err)
	}
	saveTestWork(t, db, 0, "u1", "Sunset over the sea", "image", "public")
	saveTestWork(t, db, 1, "u1", "Night drive", "music", "private")
	hiddenKey := saveTestWork(t, db, 2, official, "Official poster", "image", "public")
	if err := db.HideGalleryRecord(ctx, hiddenKey, "test", "admin@example.com"); err != nil {
		t.Fatalf("hide work: %v", err)
	}

	cases := []struct {
		name       string
		query      string
		kind       string
		visibility string
		hidden     string
		want       int
	}{
		{name: "all", want: 3},
		{name: "title search", query: "Sunset", want: 1},
		{name: "case-insensitive search", query: "sunset", want: 1},
		{name: "record id search", query: "asset-", want: 3},
		{name: "email search", query: "u1@example.com", want: 2},
		{name: "literal wildcard", query: "%", want: 0},
		{name: "literal underscore", query: "_", want: 0},
		{name: "kind", kind: "music", want: 1},
		{name: "visibility", visibility: "private", want: 1},
		{name: "hidden", hidden: "hidden", want: 1},
		{name: "visible", hidden: "visible", want: 2},
	}
	for _, testCase := range cases {
		rows, total, err := db.AdminWorks(ctx, testCase.query, testCase.kind, testCase.visibility, testCase.hidden, 20, 0)
		if err != nil {
			t.Fatalf("%s: %v", testCase.name, err)
		}
		if int(total) != testCase.want || len(rows) != testCase.want {
			t.Fatalf("%s: total=%d rows=%d want %d", testCase.name, total, len(rows), testCase.want)
		}
	}
	rows, _, err := db.AdminWorks(ctx, "Official poster", "", "", "", 20, 0)
	if err != nil || len(rows) != 1 {
		t.Fatalf("official rows = %+v err=%v", rows, err)
	}
	if !rows[0].System || rows[0].UserID != official || !rows[0].Hidden {
		t.Fatalf("official row = %+v", rows[0])
	}
}

func TestUpdateWorkRecordReplacesBodyAndChecksRevision(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	insertUser(t, db, "u1")
	key := saveTestWork(t, db, 0, "u1", "Old name", "image", "public")
	record, err := db.RecordByKey(ctx, key)
	if err != nil {
		t.Fatalf("load record: %v", err)
	}
	updated, err := db.UpdateWorkRecord(ctx, key, "u1", record.UpdatedAt, WorkRecordUpdate{
		Data: `{"id":"asset","kind":"image","prompt":"new","title":"New name"}`, Title: "New name", Kind: "image", Visibility: "private",
	})
	if err != nil || !updated {
		t.Fatalf("update = %v err=%v", updated, err)
	}
	reloaded, err := db.RecordByKey(ctx, key)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if reloaded.Body != `{"id":"asset","kind":"image","prompt":"new","title":"New name"}` || reloaded.Visibility != "private" {
		t.Fatalf("reloaded = %+v", reloaded)
	}
	// The admin detail dialog reports createdAt from the same read.
	if reloaded.CreatedAt != record.CreatedAt || reloaded.CreatedAt == 0 {
		t.Fatalf("createdAt = %d, want %d", reloaded.CreatedAt, record.CreatedAt)
	}
	var title, kind string
	if err := db.QueryRowContext(ctx, `SELECT title, kind FROM studio_records WHERE key = ?`, key).Scan(&title, &kind); err != nil {
		t.Fatalf("read projection: %v", err)
	}
	if title != "New name" || kind != "image" {
		t.Fatalf("projection = %q/%q", title, kind)
	}
	// Editing with the old revision must not overwrite the newer body.
	stale, err := db.UpdateWorkRecord(ctx, key, "u1", record.UpdatedAt, WorkRecordUpdate{Data: `{"stale":true}`})
	if err != nil || stale {
		t.Fatalf("stale update = %v err=%v", stale, err)
	}
	// Another account can never rename someone else's work.
	insertUser(t, db, "u2")
	reloaded, _ = db.RecordByKey(ctx, key)
	other, err := db.UpdateWorkRecord(ctx, key, "u2", reloaded.UpdatedAt, WorkRecordUpdate{Data: `{"stolen":true}`})
	if err != nil || other {
		t.Fatalf("foreign update = %v err=%v", other, err)
	}
}

func TestBackfillRecordMetaReadsPrefixesAndChunks(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	insertUser(t, db, "u1")
	now := int64(100)
	insert := func(key, data string) {
		if _, err := db.ExecContext(ctx, `INSERT INTO studio_records
			(key, user_id, store, record_id, data, created_at, updated_at, visibility)
			VALUES (?, 'u1', 'assets', ?, ?, ?, ?, 'public')`, key, key[:8], data, now, now); err != nil {
			t.Fatalf("insert %s: %v", key, err)
		}
	}
	insert(recordKey(0), `{"id":"a","kind":"image","title":"Legacy Name","prompt":"x"}`)
	insert(recordKey(1), `{"id":"b","kind":"music","prompt":"First line\nsecond line"}`)
	chunked := recordKey(2)
	insert(chunked, "")
	if _, err := db.ExecContext(ctx, `INSERT INTO record_chunks (id, record_key, chunk_index, data)
		VALUES (?, ?, 0, ?)`, chunked+":0", chunked, `{"id":"c","kind":"video","title":"Split Name","prompt":"x"}`); err != nil {
		t.Fatalf("insert chunk: %v", err)
	}
	// Inline media stores the fields after a payload larger than the old
	// 512 KB prefix, so the scan must reach the end of a split body.
	deep := recordKey(3)
	insert(deep, "")
	body := `{"blobData":"` + strings.Repeat("A", workMetaPrefixBytes+64*1024) +
		`","createdAt":100,"id":"d","kind":"image","prompt":"deep prompt","title":"Deep Name"}`
	for index := 0; index*recordChunkPage < len(body); index++ {
		end := (index + 1) * recordChunkPage
		if end > len(body) {
			end = len(body)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO record_chunks (id, record_key, chunk_index, data)
			VALUES (?, ?, ?, ?)`, fmt.Sprintf("%s:%d", deep, index), deep, index, body[index*recordChunkPage:end]); err != nil {
			t.Fatalf("insert deep chunk %d: %v", index, err)
		}
	}
	if err := db.BackfillRecordMeta(ctx); err != nil {
		t.Fatalf("backfill: %v", err)
	}
	for key, want := range map[string][2]string{
		recordKey(0): {"Legacy Name", "image"},
		recordKey(1): {"First line", "music"},
		chunked:      {"Split Name", "video"},
		deep:         {"Deep Name", "image"},
	} {
		var title, kind string
		if err := db.QueryRowContext(ctx, `SELECT title, kind FROM studio_records WHERE key = ?`, key).Scan(&title, &kind); err != nil {
			t.Fatalf("read %s: %v", key, err)
		}
		if title != want[0] || kind != want[1] {
			t.Fatalf("%s = %q/%q, want %q/%q", key, title, kind, want[0], want[1])
		}
	}
	// A second run is a no-op and must not clear or rewrite the projection.
	if err := db.BackfillRecordMeta(ctx); err != nil {
		t.Fatalf("second backfill: %v", err)
	}
}

func TestEnsureSystemUserIsHiddenFromUserManagement(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	first, err := db.EnsureSystemUser(ctx)
	if err != nil {
		t.Fatalf("ensure system user: %v", err)
	}
	again, err := db.EnsureSystemUser(ctx)
	if err != nil || again != first {
		t.Fatalf("second ensure = %q err=%v", again, err)
	}
	user, err := db.UserByID(ctx, first)
	if err != nil {
		t.Fatalf("load system user: %v", err)
	}
	if user.Name == nil || *user.Name != OfficialUserName {
		t.Fatalf("system user name = %v", user.Name)
	}
	if profile, err := db.ProfileByUser(ctx, first); err != nil || profile.Handle != officialHandle {
		t.Fatalf("system profile = %+v err=%v", profile, err)
	}
	rows, total, err := db.AdminUsers(ctx, "", 20, 0)
	if err != nil || total != 0 || len(rows) != 0 {
		t.Fatalf("admin users = %+v total=%d err=%v", rows, total, err)
	}
	overview, err := db.Overview(ctx, 0, 0)
	if err != nil || overview.UsersTotal != 0 {
		t.Fatalf("overview users total = %d err=%v", overview.UsersTotal, err)
	}
}
