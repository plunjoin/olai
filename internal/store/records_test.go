package store

import (
	"context"
	"fmt"
	"testing"
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
	}
	for _, row := range rows {
		if _, err := db.ExecContext(ctx, `INSERT INTO studio_records (key, user_id, store, record_id, data, updated_at)
			VALUES (?, 'u1', ?, ?, ?, ?)`, row.key, row.store, "legacy-"+row.key[:8], row.body, row.updated); err != nil {
			t.Fatalf("insert legacy row %s: %v", row.key, err)
		}
	}
	if err := db.BackfillRecordCreatedAt(ctx); err != nil {
		t.Fatalf("backfill: %v", err)
	}
	// The body's creation time wins; rows without one fall back to updated_at.
	// Non-gallery stores are not scanned by the backfill.
	want := map[string]int64{
		recordKey(0): 1_700_000_000_123,
		recordKey(1): 7,
		recordKey(2): 9,
		recordKey(3): 0,
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
	// A second startup is a no-op.
	if err := db.BackfillRecordCreatedAt(ctx); err != nil {
		t.Fatalf("second backfill: %v", err)
	}
}
