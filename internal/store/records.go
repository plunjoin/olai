package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

type StudioRecord struct {
	Key       string
	UserID    string
	Store     string
	RecordID  string
	Data      string
	CreatedAt int64
	UpdatedAt int64
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
		FROM studio_records WHERE store = 'assets' AND key > ? ORDER BY key LIMIT ?`, cursor, limit)
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
	rows, err := d.QueryContext(ctx, `SELECT key, user_id, store, record_id, data, created_at, updated_at
		FROM studio_records
		WHERE store = 'assets' AND (created_at < ? OR (created_at = ? AND key < ?))
		ORDER BY created_at DESC, key DESC LIMIT ?`,
		cursorCreatedAt, cursorCreatedAt, cursorKey, limit)
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
func (d *DB) BackfillRecordCreatedAt(ctx context.Context) error {
	const pageSize = 200
	cursor := ""
	for {
		rows, err := d.QueryContext(ctx, `SELECT key, user_id, store, record_id, data, updated_at
			FROM studio_records WHERE store = 'assets' AND created_at = 0 AND key > ? ORDER BY key LIMIT ?`,
			cursor, pageSize)
		if err != nil {
			return err
		}
		var records []StudioRecord
		for rows.Next() {
			var record StudioRecord
			if err := rows.Scan(&record.Key, &record.UserID, &record.Store, &record.RecordID, &record.Data, &record.UpdatedAt); err != nil {
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
		withBodies, err := d.attachBodies(ctx, records)
		if err != nil {
			return err
		}
		for _, record := range withBodies {
			createdAt := bodyCreatedAt(record.Body)
			if createdAt <= 0 {
				createdAt = record.UpdatedAt
			}
			if createdAt <= 0 {
				// Never leave a row stuck at the sentinel; 1 keeps it in the
				// oldest bucket without being re-scanned forever.
				createdAt = 1
			}
			if _, err := d.ExecContext(ctx, `UPDATE studio_records SET created_at = ? WHERE key = ? AND created_at = 0`,
				createdAt, record.Key); err != nil {
				return err
			}
		}
		cursor = records[len(records)-1].Key
		if len(records) < pageSize {
			return nil
		}
	}
}

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
		if _, err := tx.ExecContext(ctx, `INSERT INTO studio_records (key, user_id, store, record_id, data, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (key) DO UPDATE SET data = ?, updated_at = ?`,
			record.Key, record.UserID, record.Store, record.RecordID, record.Data, createdAt, record.UpdatedAt,
			record.Data, record.UpdatedAt); err != nil {
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
		result, err := tx.ExecContext(ctx, `INSERT INTO studio_records (key, user_id, store, record_id, data, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (key) DO NOTHING`,
			record.Key, record.UserID, record.Store, record.RecordID, record.Data, createdAt, record.UpdatedAt)
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
	rows, err := d.QueryContext(ctx, `SELECT key, user_id, store, record_id, data, updated_at
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
	if err := rows.Scan(&record.Key, &record.UserID, &record.Store, &record.RecordID, &record.Data, &record.UpdatedAt); err != nil {
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
