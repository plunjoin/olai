package store

import (
	"context"
	"fmt"
	"testing"
	"time"
)

func recordKey(index int) string {
	return fmt.Sprintf("%064x", index+1)
}

func TestSaveRecordStoresCreationTime(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	insertUser(t, db, "u1")
	record := StudioRecord{
		Key: recordKey(0), UserID: "u1", Store: "assets", RecordID: "asset-a",
		Data: `{"id":"asset-a"}`, CreatedAt: 1_710_000_000_000, UpdatedAt: 1_710_000_000_100,
	}
	if err := db.SaveRecord(ctx, record, nil); err != nil {
		t.Fatalf("save: %v", err)
	}
	batch, err := db.GalleryNewBatch(ctx, 1<<62, "~", 10)
	if err != nil || len(batch) != 1 || batch[0].CreatedAt != 1_710_000_000_000 {
		t.Fatalf("new batch = %+v err=%v", batch, err)
	}
	// Editing a work must keep its original creation time so it does not jump
	// back to the top of the newest feed.
	record.Data = `{"id":"asset-a","edited":true}`
	record.CreatedAt = 0
	record.UpdatedAt = 1_720_000_000_000
	if err := db.SaveRecord(ctx, record, nil); err != nil {
		t.Fatalf("resave: %v", err)
	}
	batch, err = db.GalleryNewBatch(ctx, 1<<62, "~", 10)
	if err != nil || len(batch) != 1 || batch[0].CreatedAt != 1_710_000_000_000 || batch[0].UpdatedAt != 1_720_000_000_000 {
		t.Fatalf("resaved batch = %+v err=%v", batch, err)
	}
}

func TestSaveRecordFallsBackToUpdatedAt(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	insertUser(t, db, "u1")
	record := StudioRecord{
		Key: recordKey(0), UserID: "u1", Store: "assets", RecordID: "asset-a",
		Data: `{"id":"asset-a"}`, UpdatedAt: 99,
	}
	if err := db.SaveRecord(ctx, record, nil); err != nil {
		t.Fatalf("save: %v", err)
	}
	batch, err := db.GalleryNewBatch(ctx, 1<<62, "~", 10)
	if err != nil || len(batch) != 1 || batch[0].CreatedAt != 99 {
		t.Fatalf("new batch = %+v err=%v", batch, err)
	}
}

func TestSaveRecordCreateVisibilityAppliesOnlyOnInsert(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	insertUser(t, db, "u1")
	key := recordKey(0)
	record := StudioRecord{
		Key: key, UserID: "u1", Store: "assets", RecordID: "asset-v",
		Data: `{"id":"asset-v"}`, UpdatedAt: 10, CreateVisibility: "private",
	}
	if err := db.SaveRecord(ctx, record, nil); err != nil {
		t.Fatalf("save: %v", err)
	}
	visibility, err := db.RecordVisibility(ctx, key)
	if err != nil || visibility != "private" {
		t.Fatalf("new visibility = %q err=%v, want private", visibility, err)
	}
	// An ordinary edit carries no visibility and must not change it.
	record.Data = `{"id":"asset-v","edited":true}`
	record.UpdatedAt = 20
	if err := db.SaveRecord(ctx, record, nil); err != nil {
		t.Fatalf("resave: %v", err)
	}
	if visibility, err = db.RecordVisibility(ctx, key); err != nil || visibility != "private" {
		t.Fatalf("visibility after edit = %q err=%v, want private", visibility, err)
	}
	// An explicit visibility still updates the row.
	record.Visibility = "public"
	record.UpdatedAt = 30
	record.CreateVisibility = ""
	if err := db.SaveRecord(ctx, record, nil); err != nil {
		t.Fatalf("publish: %v", err)
	}
	if visibility, err = db.RecordVisibility(ctx, key); err != nil || visibility != "public" {
		t.Fatalf("visibility after publish = %q err=%v, want public", visibility, err)
	}
	// The guest import uses the same create-only default.
	imported := StudioRecord{
		Key: recordKey(1), UserID: "u1", Store: "assets", RecordID: "asset-import",
		Data: `{"id":"asset-import"}`, UpdatedAt: 40, CreateVisibility: "private",
	}
	if _, err := db.InsertRecordIfAbsent(ctx, imported, nil, "", "", ""); err != nil {
		t.Fatalf("import: %v", err)
	}
	if visibility, err = db.RecordVisibility(ctx, recordKey(1)); err != nil || visibility != "private" {
		t.Fatalf("imported visibility = %q err=%v, want private", visibility, err)
	}
}

func TestGalleryNewBatchPagesNewestFirst(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	insertUser(t, db, "u1")
	// Keys 1 and 2 share a timestamp; the key tiebreak must keep paging stable
	// so a row is never skipped or repeated across pages.
	for _, row := range []struct {
		key     string
		created int64
	}{
		{recordKey(3), 100},
		{recordKey(0), 300},
		{recordKey(1), 300},
		{recordKey(2), 200},
	} {
		record := StudioRecord{
			Key: row.key, UserID: "u1", Store: "assets", RecordID: "asset-" + row.key[:8],
			Data: `{"id":"asset"}`, CreatedAt: row.created, UpdatedAt: row.created,
		}
		if err := db.SaveRecord(ctx, record, nil); err != nil {
			t.Fatalf("save %s: %v", row.key, err)
		}
	}
	first, err := db.GalleryNewBatch(ctx, 1<<62, "~", 2)
	if err != nil {
		t.Fatalf("first page: %v", err)
	}
	wantFirst := []string{recordKey(1), recordKey(0)}
	if len(first) != len(wantFirst) {
		t.Fatalf("first page = %+v", first)
	}
	for index, key := range wantFirst {
		if first[index].Key != key {
			t.Fatalf("first page[%d] = %s, want %s", index, first[index].Key, key)
		}
	}
	last := first[len(first)-1]
	second, err := db.GalleryNewBatch(ctx, last.CreatedAt, last.Key, 2)
	if err != nil {
		t.Fatalf("second page: %v", err)
	}
	wantSecond := []string{recordKey(2), recordKey(3)}
	if len(second) != len(wantSecond) {
		t.Fatalf("second page = %+v", second)
	}
	for index, key := range wantSecond {
		if second[index].Key != key {
			t.Fatalf("second page[%d] = %s, want %s", index, second[index].Key, key)
		}
	}
	rest, err := db.GalleryNewBatch(ctx, second[len(second)-1].CreatedAt, second[len(second)-1].Key, 2)
	if err != nil || len(rest) != 0 {
		t.Fatalf("exhausted page = %+v err=%v", rest, err)
	}
}

func TestBackfillRecordCreatedAtUsesRecordBody(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	insertUser(t, db, "u1")
	future := time.Now().UnixMilli() + 86_400_000
	rows := []struct {
		key     string
		store   string
		body    string
		updated int64
	}{
		{recordKey(0), "assets", `{"createdAt":1700000000123}`, 5},
		{recordKey(1), "assets", `{"status":"completed"}`, 7},
		{recordKey(2), "assets", `not json`, 9},
		{recordKey(3), "chats", `{"createdAt":42}`, 11},
		{recordKey(4), "assets", fmt.Sprintf(`{"createdAt":%d}`, future), 13},
	}
	for _, row := range rows {
		if _, err := db.ExecContext(ctx, `INSERT INTO studio_records (key, user_id, store, record_id, data, updated_at)
			VALUES (?, 'u1', ?, ?, ?, ?)`, row.key, row.store, "legacy-"+row.key[:8], row.body, row.updated); err != nil {
			t.Fatalf("insert legacy row %s: %v", row.key, err)
		}
	}
	// A chunked body keeps its createdAt in the chunks, and the key may be split
	// across a chunk boundary; the backfill must still read it without loading
	// the whole body through attachBodies.
	chunked := recordKey(5)
	if _, err := db.ExecContext(ctx, `INSERT INTO studio_records (key, user_id, store, record_id, data, updated_at)
		VALUES (?, 'u1', 'assets', 'legacy-chunked', '', 15)`, chunked); err != nil {
		t.Fatalf("insert chunked row: %v", err)
	}
	for index, chunk := range []string{`{"status":"completed","createdAt":17000`, `00000456}`} {
		if _, err := db.ExecContext(ctx, `INSERT INTO record_chunks (id, record_key, chunk_index, data)
			VALUES (?, ?, ?, ?)`, fmt.Sprintf("chunk-%d", index), chunked, index, chunk); err != nil {
			t.Fatalf("insert chunk %d: %v", index, err)
		}
	}
	before := time.Now().UnixMilli()
	if err := db.BackfillRecordCreatedAt(ctx); err != nil {
		t.Fatalf("backfill: %v", err)
	}
	after := time.Now().UnixMilli()
	// The body's creation time wins; rows without one fall back to updated_at.
	// Non-gallery stores are not scanned by the backfill.
	want := map[string]int64{
		recordKey(0): 1_700_000_000_123,
		recordKey(1): 7,
		recordKey(2): 9,
		recordKey(3): 0,
		recordKey(5): 1_700_000_000_456,
	}
	for key, expected := range want {
		var got int64
		if err := db.QueryRowContext(ctx, `SELECT created_at FROM studio_records WHERE key = ?`, key).Scan(&got); err != nil {
			t.Fatalf("read %s: %v", key, err)
		}
		if got != expected {
			t.Fatalf("created_at for %s = %d, want %d", key, got, expected)
		}
	}
	// A creation time in the future is clamped to the backfill's clock so it
	// cannot pin the work above genuinely newer works forever.
	var clamped int64
	if err := db.QueryRowContext(ctx, `SELECT created_at FROM studio_records WHERE key = ?`, recordKey(4)).Scan(&clamped); err != nil {
		t.Fatalf("read clamped row: %v", err)
	}
	if clamped > after || clamped < before {
		t.Fatalf("future created_at = %d, want clamped into [%d, %d]", clamped, before, after)
	}
	// A second startup is a no-op.
	if err := db.BackfillRecordCreatedAt(ctx); err != nil {
		t.Fatalf("second backfill: %v", err)
	}
}

func TestSaveRecordHealsZeroCreationTime(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	insertUser(t, db, "u1")
	// A row written by migrate-legacy (or a rolling old binary) has no
	// creation time yet.
	if _, err := db.ExecContext(ctx, `INSERT INTO studio_records (key, user_id, store, record_id, data, created_at, updated_at)
		VALUES (?, 'u1', 'assets', 'legacy', '{}', 0, 5)`, recordKey(0)); err != nil {
		t.Fatalf("insert legacy row: %v", err)
	}
	record := StudioRecord{
		Key: recordKey(0), UserID: "u1", Store: "assets", RecordID: "legacy",
		Data: `{"id":"legacy"}`, CreatedAt: 1_710_000_000_000, UpdatedAt: 6,
	}
	if err := db.SaveRecord(ctx, record, nil); err != nil {
		t.Fatalf("save: %v", err)
	}
	var createdAt int64
	if err := db.QueryRowContext(ctx, `SELECT created_at FROM studio_records WHERE key = ?`, record.Key).Scan(&createdAt); err != nil {
		t.Fatalf("read created_at: %v", err)
	}
	if createdAt != 1_710_000_000_000 {
		t.Fatalf("healed created_at = %d", createdAt)
	}
	// Later edits still keep the healed value.
	record.CreatedAt = 2_000_000_000_000
	record.UpdatedAt = 7
	if err := db.SaveRecord(ctx, record, nil); err != nil {
		t.Fatalf("resave: %v", err)
	}
	if err := db.QueryRowContext(ctx, `SELECT created_at FROM studio_records WHERE key = ?`, record.Key).Scan(&createdAt); err != nil {
		t.Fatalf("read created_at after edit: %v", err)
	}
	if createdAt != 1_710_000_000_000 {
		t.Fatalf("created_at after edit = %d, want the first healed value", createdAt)
	}
}
