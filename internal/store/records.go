package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"
)

type StudioRecord struct {
	Key        string
	UserID     string
	Store      string
	RecordID   string
	Data       string
	CreatedAt  int64
	UpdatedAt  int64
	Visibility string
}

type RecordChunk struct {
	ID         string
	RecordKey  string
	ChunkIndex int
	Data       string
}

type RecordWithBody struct {
	StudioRecord
	Body string
}

func (d *DB) RecordsFor(ctx context.Context, userID, storeName string) ([]RecordWithBody, error) {
	rows, err := d.QueryContext(ctx, `SELECT key, user_id, store, record_id, data, updated_at
		FROM studio_records WHERE user_id = ? AND store = ?`, userID, storeName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var records []StudioRecord
	for rows.Next() {
		var record StudioRecord
		if err := rows.Scan(&record.Key, &record.UserID, &record.Store, &record.RecordID, &record.Data, &record.UpdatedAt); err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return d.attachBodies(ctx, records)
}

// GalleryBatch returns a keyset page of raw records for public gallery
// scanning. Bodies may be chunked; attachBodies normalizes them.
func (d *DB) GalleryBatch(ctx context.Context, cursor string, limit int) ([]RecordWithBody, error) {
	rows, err := d.QueryContext(ctx, `SELECT key, user_id, store, record_id, data, updated_at
		FROM studio_records WHERE store = 'assets' AND visibility = 'public' AND key > ? ORDER BY key LIMIT ?`, cursor, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var records []StudioRecord
	for rows.Next() {
		var record StudioRecord
		if err := rows.Scan(&record.Key, &record.UserID, &record.Store, &record.RecordID, &record.Data, &record.UpdatedAt); err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return d.attachBodies(ctx, records)
}

// GalleryNewBatch returns a newest-first keyset page of public gallery
// records ordered by the stored creation time. Rows written before the
// created_at column existed default to 0 and sort last; the startup backfill
// fills them in. Bodies may be chunked; attachBodies normalizes them.
func (d *DB) GalleryNewBatch(ctx context.Context, cursorCreatedAt int64, cursorKey string, limit int) ([]RecordWithBody, error) {
	// Row-value comparison keeps the keyset predicate sargable on the
	// (store, created_at DESC, key DESC) index; the OR form is not.
	rows, err := d.QueryContext(ctx, `SELECT key, user_id, store, record_id, data, created_at, updated_at
		FROM studio_records
		WHERE store = 'assets' AND visibility = 'public' AND (created_at, key) < (?, ?)
		ORDER BY created_at DESC, key DESC LIMIT ?`,
		cursorCreatedAt, cursorKey, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var records []StudioRecord
	for rows.Next() {
		var record StudioRecord
		if err := rows.Scan(&record.Key, &record.UserID, &record.Store, &record.RecordID, &record.Data, &record.CreatedAt, &record.UpdatedAt); err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return d.attachBodies(ctx, records)
}

// BackfillRecordCreatedAt fills created_at for asset rows written before the
// column existed, using the creation time kept in the record body. It only
// touches rows that still read 0, so it is cheap and safe on every startup.
//
// The backfill is memory-bounded: every page is a plain query, chunked bodies
// are scanned one at a time, and each page is written with one batched UPDATE
// instead of a transaction per row. Future timestamps are clamped to now so a
// bogus clock cannot pin a work to the top of the newest feed forever.
func (d *DB) BackfillRecordCreatedAt(ctx context.Context) error {
	const pageSize = 200
	const updateBatch = 100
	const maxPrefixBytes = 2 << 20
	now := time.Now().UnixMilli()
	cursor := ""
	for {
		rows, err := d.QueryContext(ctx, `SELECT key, data, updated_at
			FROM studio_records WHERE store = 'assets' AND created_at = 0 AND key > ? ORDER BY key LIMIT ?`,
			cursor, pageSize)
		if err != nil {
			return err
		}
		type pending struct {
			key     string
			data    string
			updated int64
		}
		var records []pending
		for rows.Next() {
			var record pending
			if err := rows.Scan(&record.key, &record.data, &record.updated); err != nil {
				rows.Close()
				return err
			}
			records = append(records, record)
		}
		scanErr := rows.Err()
		rows.Close()
		if scanErr != nil {
			return scanErr
		}
		if len(records) == 0 {
			return nil
		}
		entries := make([]createdAtEntry, 0, len(records))
		for _, record := range records {
			createdAt := bodyCreatedAt(record.data)
			if record.data == "" {
				createdAt, err = d.chunkedCreatedAt(ctx, record.key, maxPrefixBytes)
				if err != nil {
					return err
				}
			}
			if createdAt <= 0 {
				createdAt = record.updated
			}
			if createdAt <= 0 {
				// Never leave a row stuck at the sentinel; 1 keeps it in the
				// oldest bucket without being re-scanned forever.
				createdAt = 1
			}
			if createdAt > now {
				createdAt = now
			}
			entries = append(entries, createdAtEntry{key: record.key, createdAt: createdAt})
		}
		if err := d.updateCreatedAt(ctx, entries, updateBatch); err != nil {
			return err
		}
		cursor = records[len(records)-1].key
		if len(records) < pageSize {
			return nil
		}
	}
}

type createdAtEntry struct {
	key       string
	createdAt int64
}

// updateCreatedAt writes pairs with one CASE statement per batch. The
// created_at = 0 guard keeps a concurrent SaveRecord authoritative.
func (d *DB) updateCreatedAt(ctx context.Context, entries []createdAtEntry, batchSize int) error {
	for start := 0; start < len(entries); start += batchSize {
		end := start + batchSize
		if end > len(entries) {
			end = len(entries)
		}
		batch := entries[start:end]
		var cases strings.Builder
		cases.WriteString(`UPDATE studio_records SET created_at = CASE key`)
		placeholders := make([]string, 0, len(batch))
		args := make([]any, 0, len(batch)*3)
		for _, entry := range batch {
			cases.WriteString(` WHEN ? THEN ?`)
			args = append(args, entry.key, entry.createdAt)
			placeholders = append(placeholders, "?")
		}
		cases.WriteString(` END WHERE created_at = 0 AND key IN (` + strings.Join(placeholders, ",") + `)`)
		for _, entry := range batch {
			args = append(args, entry.key)
		}
		if _, err := d.ExecContext(ctx, cases.String(), args...); err != nil {
			return err
		}
	}
	return nil
}

// createdAtPrefixRE reads the field out of a JSON prefix. Requiring the closing
// comma or brace avoids accepting a number that is still being buffered.
var createdAtPrefixRE = regexp.MustCompile(`"createdAt"\s*:\s*(\d{1,16})\s*[,}]`)

// chunkedCreatedAt scans a chunked body from the start until createdAt is
// complete, so a large base64 payload is never materialized in memory.
func (d *DB) chunkedCreatedAt(ctx context.Context, key string, maxBytes int) (int64, error) {
	rows, err := d.QueryContext(ctx, `SELECT data FROM record_chunks WHERE record_key = ? ORDER BY chunk_index`, key)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	prefix := make([]byte, 0, recordChunkPage)
	for rows.Next() {
		var chunk string
		if err := rows.Scan(&chunk); err != nil {
			return 0, err
		}
		prefix = append(prefix, chunk...)
		if match := createdAtPrefixRE.FindSubmatch(prefix); match != nil {
			var createdAt int64
			for _, digit := range match[1] {
				createdAt = createdAt*10 + int64(digit-'0')
			}
			return createdAt, nil
		}
		if len(prefix) >= maxBytes {
			break
		}
	}
	return 0, rows.Err()
}

const recordChunkPage = 128 * 1024

// bodyCreatedAt reads the client-side creation time out of a stored record
// body. Bodies are validated JSON objects, but a malformed one must never
// block the backfill.
func bodyCreatedAt(body string) int64 {
	if body == "" {
		return 0
	}
	decoder := json.NewDecoder(strings.NewReader(body))
	decoder.UseNumber()
	var value map[string]any
	if err := decoder.Decode(&value); err != nil {
		return 0
	}
	switch created := value["createdAt"].(type) {
	case json.Number:
		if number, err := created.Int64(); err == nil {
			return number
		}
		if number, err := created.Float64(); err == nil {
			return int64(number)
		}
	case float64:
		return int64(created)
	}
	return 0
}

func (d *DB) attachBodies(ctx context.Context, records []StudioRecord) ([]RecordWithBody, error) {
	out := make([]RecordWithBody, 0, len(records))
	needChunks := make([]string, 0, len(records))
	for _, record := range records {
		out = append(out, RecordWithBody{StudioRecord: record, Body: record.Data})
		if record.Data == "" {
			needChunks = append(needChunks, record.Key)
		}
	}
	if len(needChunks) == 0 {
		return out, nil
	}
	placeholders := make([]string, len(needChunks))
	args := make([]any, len(needChunks))
	for i, key := range needChunks {
		placeholders[i] = "?"
		args[i] = key
	}
	rows, err := d.QueryContext(ctx, `SELECT id, record_key, chunk_index, data FROM record_chunks
		WHERE record_key IN (`+strings.Join(placeholders, ",")+`) ORDER BY record_key, chunk_index`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	bodies := make(map[string]*strings.Builder)
	for rows.Next() {
		var chunk RecordChunk
		if err := rows.Scan(&chunk.ID, &chunk.RecordKey, &chunk.ChunkIndex, &chunk.Data); err != nil {
			return nil, err
		}
		builder := bodies[chunk.RecordKey]
		if builder == nil {
			builder = &strings.Builder{}
			bodies[chunk.RecordKey] = builder
		}
		builder.WriteString(chunk.Data)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		if out[i].Body == "" {
			if builder := bodies[out[i].Key]; builder != nil {
				out[i].Body = builder.String()
			}
		}
	}
	return out, nil
}

// SaveRecord replaces metadata and chunks atomically.
func (d *DB) SaveRecord(ctx context.Context, record StudioRecord, chunks []RecordChunk) error {
	return d.InTx(ctx, func(tx *Tx) error {
		createdAt := record.CreatedAt
		if createdAt <= 0 {
			createdAt = record.UpdatedAt
		}
		// A row created before the created_at column existed (or by a rolling
		// old binary) still reads 0; an ordinary edit must keep the original
		// creation time, but a 0 is healed from this write.
		if _, err := tx.ExecContext(ctx, `INSERT INTO studio_records (key, user_id, store, record_id, data, created_at, updated_at, visibility)
			VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(NULLIF(?, ''), 'public'))
			ON CONFLICT (key) DO UPDATE SET
				data = excluded.data,
				updated_at = excluded.updated_at,
				visibility = CASE WHEN ? <> '' THEN ? ELSE studio_records.visibility END,
				created_at = CASE WHEN studio_records.created_at = 0 THEN excluded.created_at ELSE studio_records.created_at END`,
			record.Key, record.UserID, record.Store, record.RecordID, record.Data, createdAt, record.UpdatedAt,
			record.Visibility, record.Visibility, record.Visibility); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM record_chunks WHERE record_key = ?`, record.Key); err != nil {
			return err
		}
		for _, chunk := range chunks {
			if _, err := tx.ExecContext(ctx, `INSERT INTO record_chunks (id, record_key, chunk_index, data)
				VALUES (?, ?, ?, ?)`, chunk.ID, chunk.RecordKey, chunk.ChunkIndex, chunk.Data); err != nil {
				return err
			}
		}
		return nil
	})
}

// InsertRecordIfAbsent implements the idempotent guest import. It never
// replaces a cloud record that already exists.
func (d *DB) InsertRecordIfAbsent(ctx context.Context, record StudioRecord, chunks []RecordChunk, guestOwner, userOwner, remoteID string) (bool, error) {
	inserted := false
	err := d.InTx(ctx, func(tx *Tx) error {
		createdAt := record.CreatedAt
		if createdAt <= 0 {
			createdAt = record.UpdatedAt
		}
		result, err := tx.ExecContext(ctx, `INSERT INTO studio_records (key, user_id, store, record_id, data, created_at, updated_at, visibility)
			VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(NULLIF(?, ''), 'public')) ON CONFLICT (key) DO NOTHING`,
			record.Key, record.UserID, record.Store, record.RecordID, record.Data, createdAt, record.UpdatedAt,
			record.Visibility)
		if err != nil {
			return err
		}
		rows, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if rows == 0 {
			return nil
		}
		inserted = true
		for _, chunk := range chunks {
			if _, err := tx.ExecContext(ctx, `INSERT INTO record_chunks (id, record_key, chunk_index, data)
				VALUES (?, ?, ?, ?)`, chunk.ID, chunk.RecordKey, chunk.ChunkIndex, chunk.Data); err != nil {
				return err
			}
		}
		if remoteID != "" && guestOwner != "" && userOwner != "" {
			if _, err := tx.ExecContext(ctx, `UPDATE video_jobs SET owner = ? WHERE id = ? AND owner = ?`,
				userOwner, remoteID, guestOwner); err != nil {
				return err
			}
		}
		return nil
	})
	return inserted, err
}

func (d *DB) UpdateRecordData(ctx context.Context, key, userID, storeName string, expectedUpdatedAt int64, data string) (bool, error) {
	result, err := d.ExecContext(ctx, `UPDATE studio_records SET data = ?, updated_at = ?
		WHERE key = ? AND user_id = ? AND store = ? AND updated_at = ?`,
		data, time.Now().UnixMilli(), key, userID, storeName, expectedUpdatedAt)
	if err != nil {
		return false, err
	}
	rows, err := result.RowsAffected()
	return rows == 1, err
}

func (d *DB) DeleteChunks(ctx context.Context, key string) error {
	_, err := d.ExecContext(ctx, `DELETE FROM record_chunks WHERE record_key = ?`, key)
	return err
}

func (d *DB) DeleteRecord(ctx context.Context, key, userID, storeName string) error {
	return d.InTx(ctx, func(tx *Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM record_chunks WHERE record_key = ?`, key); err != nil {
			return err
		}
		// Gallery metadata never outlives its record.
		for _, query := range []string{
			`DELETE FROM gallery_favorites WHERE record_key = ?`,
			`DELETE FROM gallery_metrics WHERE record_key = ?`,
			`DELETE FROM gallery_hidden WHERE record_key = ?`,
			`DELETE FROM gallery_reports WHERE record_key = ?`,
		} {
			if _, err := tx.ExecContext(ctx, query, key); err != nil {
				return err
			}
		}
		_, err := tx.ExecContext(ctx, `DELETE FROM studio_records WHERE key = ? AND user_id = ? AND store = ?`,
			key, userID, storeName)
		return err
	})
}

func (d *DB) RecordByKey(ctx context.Context, key string) (*RecordWithBody, error) {
	rows, err := d.QueryContext(ctx, `SELECT key, user_id, store, record_id, data, updated_at, visibility
		FROM studio_records WHERE key = ?`, key)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	if !rows.Next() {
		if err := rows.Err(); err != nil {
			return nil, err
		}
		return nil, ErrNotFound
	}
	var record StudioRecord
	if err := rows.Scan(&record.Key, &record.UserID, &record.Store, &record.RecordID, &record.Data, &record.UpdatedAt, &record.Visibility); err != nil {
		return nil, err
	}
	rows.Close()
	withBodies, err := d.attachBodies(ctx, []StudioRecord{record})
	if err != nil {
		return nil, err
	}
	if len(withBodies) == 0 {
		return nil, ErrNotFound
	}
	return &withBodies[0], nil
}

func (d *DB) CountRecords(ctx context.Context, storeName string) (int64, error) {
	var count int64
	err := d.QueryRowContext(ctx, `SELECT COUNT(*) FROM studio_records WHERE store = ?`, storeName).Scan(&count)
	return count, err
}

func (d *DB) CountUserRecords(ctx context.Context, userID, storeName string) (int64, error) {
	var count int64
	err := d.QueryRowContext(ctx, `SELECT COUNT(*) FROM studio_records WHERE user_id = ? AND store = ?`, userID, storeName).Scan(&count)
	return count, err
}

// ---- video task ownership ----

func (d *DB) InsertVideoJob(ctx context.Context, id, owner string) error {
	_, err := d.ExecContext(ctx, `INSERT INTO video_jobs (id, owner, created_at) VALUES (?, ?, ?)`,
		id, owner, time.Now().UnixMilli())
	return err
}

func (d *DB) VideoJobOwner(ctx context.Context, id string) (string, error) {
	var owner string
	err := d.QueryRowContext(ctx, `SELECT owner FROM video_jobs WHERE id = ?`, id).Scan(&owner)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return owner, err
}
