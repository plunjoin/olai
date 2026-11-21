package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// galleryKeyChunk keeps `IN (...)` lists well below SQLite's conservative
// parameter limit while still batching gallery pages.
const galleryKeyChunk = 400

// GalleryStats is the engagement snapshot attached to one public work.
type GalleryStats struct {
	Views     int64
	Downloads int64
	Favorites int64
}

// GalleryReportRow is one moderation report, optionally joined with the
// reporter's email for the admin console.
type GalleryReportRow struct {
	ID                  string
	RecordKey           string
	ReporterID          string
	ReporterEmail       string
	ReporterFingerprint string
	Reason              string
	Detail              string
	Status              string
	CreatedAt           int64
	HandledAt           *int64
	HandledBy           string
}

func galleryArgList(keys []string) (string, []any) {
	placeholders := make([]string, len(keys))
	args := make([]any, len(keys))
	for index, key := range keys {
		placeholders[index] = "?"
		args[index] = key
	}
	return joinStrings(placeholders, ","), args
}

// RecordsByKeys loads records (including chunked bodies) in bounded batches.
// Missing keys are simply absent from the result.
func (d *DB) RecordsByKeys(ctx context.Context, keys []string) (map[string]RecordWithBody, error) {
	out := map[string]RecordWithBody{}
	for start := 0; start < len(keys); start += galleryKeyChunk {
		end := start + galleryKeyChunk
		if end > len(keys) {
			end = len(keys)
		}
		list, args := galleryArgList(keys[start:end])
		rows, err := d.QueryContext(ctx, `SELECT key, user_id, store, record_id, data, updated_at
			FROM studio_records WHERE key IN (`+list+`)`, args...)
		if err != nil {
			return nil, err
		}
		var records []StudioRecord
		for rows.Next() {
			var record StudioRecord
			if err := rows.Scan(&record.Key, &record.UserID, &record.Store, &record.RecordID, &record.Data, &record.UpdatedAt); err != nil {
				rows.Close()
				return nil, err
			}
			records = append(records, record)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
		withBodies, err := d.attachBodies(ctx, records)
		if err != nil {
			return nil, err
		}
		for _, record := range withBodies {
			out[record.Key] = record
		}
	}
	return out, nil
}

// ---- favorites ----

func (d *DB) AddGalleryFavorite(ctx context.Context, userID, recordKey string) (bool, error) {
	result, err := d.ExecContext(ctx, `INSERT INTO gallery_favorites (user_id, record_key, created_at)
		VALUES (?, ?, ?) ON CONFLICT (user_id, record_key) DO NOTHING`,
		userID, recordKey, time.Now().UnixMilli())
	if err != nil {
		return false, err
	}
	rows, err := result.RowsAffected()
	return rows > 0, err
}

func (d *DB) RemoveGalleryFavorite(ctx context.Context, userID, recordKey string) (bool, error) {
	result, err := d.ExecContext(ctx, `DELETE FROM gallery_favorites WHERE user_id = ? AND record_key = ?`, userID, recordKey)
	if err != nil {
		return false, err
	}
	rows, err := result.RowsAffected()
	return rows > 0, err
}

// GalleryFavoriteTotal counts only favorites the gallery can still list:
// deleted records and takedowns must not inflate the portal's 收藏 badge.
func (d *DB) GalleryFavoriteTotal(ctx context.Context, userID string) (int64, error) {
	var total int64
	err := d.QueryRowContext(ctx, `SELECT COUNT(*) FROM gallery_favorites f
		JOIN studio_records r ON r.key = f.record_key AND r.store = 'assets'
		WHERE f.user_id = ? AND NOT EXISTS (
			SELECT 1 FROM gallery_hidden h WHERE h.record_key = f.record_key
		)`, userID).Scan(&total)
	return total, err
}

// GalleryFavoriteKeys returns one page of favorited record keys, newest first.
func (d *DB) GalleryFavoriteKeys(ctx context.Context, userID string, limit, offset int) ([]string, int64, error) {
	total, err := d.GalleryFavoriteTotal(ctx, userID)
	if err != nil {
		return nil, 0, err
	}
	rows, err := d.QueryContext(ctx, `SELECT f.record_key FROM gallery_favorites f
		JOIN studio_records r ON r.key = f.record_key AND r.store = 'assets'
		WHERE f.user_id = ? AND NOT EXISTS (
			SELECT 1 FROM gallery_hidden h WHERE h.record_key = f.record_key
		)
		ORDER BY f.created_at DESC, f.record_key LIMIT ? OFFSET ?`, userID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	keys := []string{}
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return nil, 0, err
		}
		keys = append(keys, key)
	}
	return keys, total, rows.Err()
}

func (d *DB) GalleryFavoriteSet(ctx context.Context, userID string, keys []string) (map[string]bool, error) {
	out := map[string]bool{}
	if userID == "" || len(keys) == 0 {
		return out, nil
	}
	list, args := galleryArgList(keys)
	args = append([]any{userID}, args...)
	rows, err := d.QueryContext(ctx, `SELECT record_key FROM gallery_favorites
		WHERE user_id = ? AND record_key IN (`+list+`)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return nil, err
		}
		out[key] = true
	}
	return out, rows.Err()
}

func (d *DB) GalleryFavoriteCounts(ctx context.Context, keys []string) (map[string]int64, error) {
	out := map[string]int64{}
	for start := 0; start < len(keys); start += galleryKeyChunk {
		end := start + galleryKeyChunk
		if end > len(keys) {
			end = len(keys)
		}
		list, args := galleryArgList(keys[start:end])
		rows, err := d.QueryContext(ctx, `SELECT record_key, COUNT(*) FROM gallery_favorites
			WHERE record_key IN (`+list+`) GROUP BY record_key`, args...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var key string
			var count int64
			if err := rows.Scan(&key, &count); err != nil {
				rows.Close()
				return nil, err
			}
			out[key] = count
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}
	return out, nil
}

// ---- engagement metrics ----

func (d *DB) IncrementGalleryView(ctx context.Context, recordKey string) error {
	now := time.Now().UnixMilli()
	_, err := d.ExecContext(ctx, `INSERT INTO gallery_metrics (record_key, views, downloads, updated_at)
		VALUES (?, 1, 0, ?)
		ON CONFLICT (record_key) DO UPDATE SET views = gallery_metrics.views + 1, updated_at = ?`,
		recordKey, now, now)
	return err
}

func (d *DB) IncrementGalleryDownload(ctx context.Context, recordKey string) error {
	now := time.Now().UnixMilli()
	_, err := d.ExecContext(ctx, `INSERT INTO gallery_metrics (record_key, views, downloads, updated_at)
		VALUES (?, 0, 1, ?)
		ON CONFLICT (record_key) DO UPDATE SET downloads = gallery_metrics.downloads + 1, updated_at = ?`,
		recordKey, now, now)
	return err
}

// GalleryStatsFor aggregates views, downloads and favorites for a set of works.
func (d *DB) GalleryStatsFor(ctx context.Context, keys []string) (map[string]GalleryStats, error) {
	out := map[string]GalleryStats{}
	if len(keys) == 0 {
		return out, nil
	}
	for start := 0; start < len(keys); start += galleryKeyChunk {
		end := start + galleryKeyChunk
		if end > len(keys) {
			end = len(keys)
		}
		list, args := galleryArgList(keys[start:end])
		rows, err := d.QueryContext(ctx, `SELECT record_key, views, downloads FROM gallery_metrics
			WHERE record_key IN (`+list+`)`, args...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var key string
			var views, downloads int64
			if err := rows.Scan(&key, &views, &downloads); err != nil {
				rows.Close()
				return nil, err
			}
			stats := out[key]
			stats.Views = views
			stats.Downloads = downloads
			out[key] = stats
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}
	favorites, err := d.GalleryFavoriteCounts(ctx, keys)
	if err != nil {
		return nil, err
	}
	for key, count := range favorites {
		stats := out[key]
		stats.Favorites = count
		out[key] = stats
	}
	return out, nil
}

// ---- takedowns ----

func (d *DB) GalleryHiddenKeys(ctx context.Context) (map[string]bool, error) {
	rows, err := d.QueryContext(ctx, `SELECT record_key FROM gallery_hidden`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return nil, err
		}
		out[key] = true
	}
	return out, rows.Err()
}

func (d *DB) IsGalleryHidden(ctx context.Context, recordKey string) (bool, error) {
	var count int64
	err := d.QueryRowContext(ctx, `SELECT COUNT(*) FROM gallery_hidden WHERE record_key = ?`, recordKey).Scan(&count)
	return count > 0, err
}

func (d *DB) HideGalleryRecord(ctx context.Context, recordKey, reason, hiddenBy string) error {
	_, err := d.ExecContext(ctx, `INSERT INTO gallery_hidden (record_key, reason, hidden_by, hidden_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT (record_key) DO UPDATE SET reason = ?, hidden_by = ?, hidden_at = ?`,
		recordKey, reason, hiddenBy, time.Now().UnixMilli(), reason, hiddenBy, time.Now().UnixMilli())
	return err
}

func (d *DB) UnhideGalleryRecord(ctx context.Context, recordKey string) error {
	_, err := d.ExecContext(ctx, `DELETE FROM gallery_hidden WHERE record_key = ?`, recordKey)
	return err
}

// ---- reports ----

func (d *DB) InsertGalleryReport(ctx context.Context, report GalleryReportRow) error {
	_, err := d.ExecContext(ctx, `INSERT INTO gallery_reports
		(id, record_key, reporter_id, reporter_fingerprint, reason, detail, status, created_at, handled_at, handled_by)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		report.ID, report.RecordKey, nullableID(report.ReporterID), report.ReporterFingerprint,
		report.Reason, report.Detail, report.Status, report.CreatedAt, report.HandledAt, report.HandledBy)
	return err
}

func nullableID(value string) any {
	if value == "" {
		return nil
	}
	return value
}

// GalleryOpenReportExists prevents a second open report from the same viewer
// for the same work within the dedupe window.
func (d *DB) GalleryOpenReportExists(ctx context.Context, recordKey, reporterID, fingerprint string, since int64) (bool, error) {
	query := `SELECT COUNT(*) FROM gallery_reports WHERE record_key = ? AND status = 'open' AND created_at >= ? AND `
	args := []any{recordKey, since}
	if reporterID != "" {
		query += `reporter_id = ?`
		args = append(args, reporterID)
	} else {
		query += `reporter_id IS NULL AND reporter_fingerprint = ?`
		args = append(args, fingerprint)
	}
	var count int64
	err := d.QueryRowContext(ctx, query, args...).Scan(&count)
	return count > 0, err
}

func scanGalleryReport(row interface{ Scan(...any) error }) (*GalleryReportRow, error) {
	var report GalleryReportRow
	var reporterID sql.NullString
	var email sql.NullString
	var handledAt sql.NullInt64
	err := row.Scan(&report.ID, &report.RecordKey, &reporterID, &email, &report.ReporterFingerprint,
		&report.Reason, &report.Detail, &report.Status, &report.CreatedAt, &handledAt, &report.HandledBy)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	report.ReporterID = reporterID.String
	report.ReporterEmail = email.String
	report.HandledAt = nullableInt(handledAt)
	return &report, nil
}

const galleryReportColumns = `r.id, r.record_key, r.reporter_id, u.email, r.reporter_fingerprint,
	r.reason, r.detail, r.status, r.created_at, r.handled_at, r.handled_by`

func (d *DB) GalleryReports(ctx context.Context, status string, limit, offset int) ([]GalleryReportRow, int64, error) {
	filter := ""
	args := []any{}
	if status != "" {
		filter = ` WHERE r.status = ?`
		args = append(args, status)
	}
	var total int64
	if err := d.QueryRowContext(ctx, `SELECT COUNT(*) FROM gallery_reports r`+filter, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	pageArgs := append(append([]any{}, args...), limit, offset)
	rows, err := d.QueryContext(ctx, `SELECT `+galleryReportColumns+`
		FROM gallery_reports r LEFT JOIN users u ON u.id = r.reporter_id`+filter+`
		ORDER BY r.created_at DESC LIMIT ? OFFSET ?`, pageArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []GalleryReportRow{}
	for rows.Next() {
		report, err := scanGalleryReport(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *report)
	}
	return out, total, rows.Err()
}

func (d *DB) GalleryReportByID(ctx context.Context, id string) (*GalleryReportRow, error) {
	return scanGalleryReport(d.QueryRowContext(ctx, `SELECT `+galleryReportColumns+`
		FROM gallery_reports r LEFT JOIN users u ON u.id = r.reporter_id WHERE r.id = ?`, id))
}

func (d *DB) SetGalleryReportStatus(ctx context.Context, id, status, handledBy string, handledAt int64) error {
	_, err := d.ExecContext(ctx, `UPDATE gallery_reports SET status = ?, handled_at = ?, handled_by = ? WHERE id = ?`,
		status, handledAt, handledBy, id)
	return err
}

// SetRecordReportsStatus closes every open report for one work, used when an
// administrator hides it.
func (d *DB) SetRecordReportsStatus(ctx context.Context, recordKey, status, handledBy string, handledAt int64) error {
	_, err := d.ExecContext(ctx, `UPDATE gallery_reports SET status = ?, handled_at = ?, handled_by = ?
		WHERE record_key = ? AND status = 'open'`, status, handledAt, handledBy, recordKey)
	return err
}

func (d *DB) CountOpenGalleryReports(ctx context.Context) (int64, error) {
	var count int64
	err := d.QueryRowContext(ctx, `SELECT COUNT(*) FROM gallery_reports WHERE status = 'open'`).Scan(&count)
	return count, err
}

// ---- public authors and comments ----

// GalleryAuthor is the publishable part of one portal account. Uploaded
// avatars stay out of it: /api/media is owner-scoped, so only preset theme ids
// are meaningful to other visitors.
type GalleryAuthor struct {
	Name   string
	Avatar string
}

// GalleryAuthors resolves display names for a page of works in bounded
// batches. Missing accounts simply stay absent so callers can fall back.
func (d *DB) GalleryAuthors(ctx context.Context, ids []string) (map[string]GalleryAuthor, error) {
	out := map[string]GalleryAuthor{}
	unique := make([]string, 0, len(ids))
	seen := map[string]bool{}
	for _, id := range ids {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		unique = append(unique, id)
	}
	for start := 0; start < len(unique); start += galleryKeyChunk {
		end := start + galleryKeyChunk
		if end > len(unique) {
			end = len(unique)
		}
		list, args := galleryArgList(unique[start:end])
		rows, err := d.QueryContext(ctx, `SELECT id, name, avatar FROM users WHERE id IN (`+list+`)`, args...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var id string
			var name, avatar sql.NullString
			if err := rows.Scan(&id, &name, &avatar); err != nil {
				rows.Close()
				return nil, err
			}
			out[id] = GalleryAuthor{Name: name.String, Avatar: avatar.String}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}
	return out, nil
}

// GalleryComment is one public comment joined with its author's display name.
type GalleryComment struct {
	ID           string
	RecordKey    string
	UserID       string
	Body         string
	AuthorName   string
	AuthorAvatar string
	CreatedAt    int64
}

const galleryCommentSelect = `SELECT c.id, c.record_key, c.user_id, c.body, c.created_at,
	COALESCE(u.name, ''), COALESCE(u.avatar, '')
	FROM gallery_comments c LEFT JOIN users u ON u.id = c.user_id`

func scanGalleryComment(row interface{ Scan(...any) error }) (*GalleryComment, error) {
	var comment GalleryComment
	if err := row.Scan(&comment.ID, &comment.RecordKey, &comment.UserID, &comment.Body,
		&comment.CreatedAt, &comment.AuthorName, &comment.AuthorAvatar); err != nil {
		return nil, err
	}
	return &comment, nil
}

// GalleryComments returns one newest-first page plus the total comment count.
func (d *DB) GalleryComments(ctx context.Context, recordKey string, limit, offset int) ([]GalleryComment, int64, error) {
	var total int64
	if err := d.QueryRowContext(ctx, `SELECT COUNT(*) FROM gallery_comments WHERE record_key = ?`, recordKey).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := d.QueryContext(ctx, galleryCommentSelect+`
		WHERE c.record_key = ? ORDER BY c.created_at DESC, c.id DESC LIMIT ? OFFSET ?`,
		recordKey, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []GalleryComment{}
	for rows.Next() {
		comment, err := scanGalleryComment(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *comment)
	}
	return out, total, rows.Err()
}

// GalleryCommentTotal counts comments for one work after a write.
func (d *DB) GalleryCommentTotal(ctx context.Context, recordKey string) (int64, error) {
	var total int64
	err := d.QueryRowContext(ctx, `SELECT COUNT(*) FROM gallery_comments WHERE record_key = ?`, recordKey).Scan(&total)
	return total, err
}

// AddGalleryComment stores one comment. Visibility and rate limits are
// enforced by the gallery package before this insert.
func (d *DB) AddGalleryComment(ctx context.Context, id, recordKey, userID, body string, createdAt int64) error {
	_, err := d.ExecContext(ctx, `INSERT INTO gallery_comments (id, record_key, user_id, body, created_at)
		VALUES (?, ?, ?, ?, ?)`, id, recordKey, userID, body, createdAt)
	return err
}
