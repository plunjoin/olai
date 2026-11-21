package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

type MediaObject struct {
	ID           string
	ObjectKey    string
	Owner        string
	AttachmentID string
	Mime         string
	Size         int64
	SHA256       string
	CreatedAt    int64
}

const mediaColumns = `id, object_key, owner, attachment_id, mime, size, sha256, created_at`

func scanMedia(row interface{ Scan(...any) error }) (*MediaObject, error) {
	var m MediaObject
	err := row.Scan(&m.ID, &m.ObjectKey, &m.Owner, &m.AttachmentID, &m.Mime, &m.Size, &m.SHA256, &m.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &m, nil
}

func (d *DB) MediaByIDs(ctx context.Context, ids []string) (map[string]*MediaObject, error) {
	out := map[string]*MediaObject{}
	if len(ids) == 0 {
		return out, nil
	}
	placeholders := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}
	rows, err := d.QueryContext(ctx, `SELECT `+mediaColumns+` FROM media_objects WHERE id IN (`+strings.Join(placeholders, ",")+`)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var m MediaObject
		if err := rows.Scan(&m.ID, &m.ObjectKey, &m.Owner, &m.AttachmentID, &m.Mime, &m.Size, &m.SHA256, &m.CreatedAt); err != nil {
			return nil, err
		}
		row := m
		out[m.ID] = &row
	}
	return out, rows.Err()
}

func (d *DB) MediaByID(ctx context.Context, id string) (*MediaObject, error) {
	return scanMedia(d.QueryRowContext(ctx, `SELECT `+mediaColumns+` FROM media_objects WHERE id = ?`, id))
}

func (d *DB) MediaByIdentity(ctx context.Context, owner, attachmentID, sha256, mime string) (*MediaObject, error) {
	return scanMedia(d.QueryRowContext(ctx, `SELECT `+mediaColumns+` FROM media_objects
		WHERE owner = ? AND attachment_id = ? AND sha256 = ? AND mime = ?`, owner, attachmentID, sha256, mime))
}

// InsertMediaIfAbsent returns the winning row. Concurrent uploads of the same
// identity may each upload a distinct object; only one row survives and losers
// delete their object.
func (d *DB) InsertMediaIfAbsent(ctx context.Context, media MediaObject) (*MediaObject, bool, error) {
	_, err := d.ExecContext(ctx, `INSERT INTO media_objects (`+mediaColumns+`)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (owner, attachment_id, sha256, mime) DO NOTHING`,
		media.ID, media.ObjectKey, media.Owner, media.AttachmentID, media.Mime, media.Size, media.SHA256, media.CreatedAt)
	if err != nil {
		return nil, false, err
	}
	winner, err := d.MediaByIdentity(ctx, media.Owner, media.AttachmentID, media.SHA256, media.Mime)
	if err != nil {
		return nil, false, err
	}
	return winner, winner.ID == media.ID, nil
}

// ClaimMediaURLs transfers guest-owned objects to a signed-in account. Every
// reference is validated before any ownership mutation; the whole batch is
// atomic.
func (d *DB) ClaimMediaIDs(ctx context.Context, ids []string, guestOwner, userOwner string) error {
	if len(ids) == 0 {
		return nil
	}
	return d.InTx(ctx, func(tx *Tx) error {
		for _, id := range ids {
			var owner string
			err := tx.QueryRowContext(ctx, `SELECT owner FROM media_objects WHERE id = ?`, id).Scan(&owner)
			if errors.Is(err, sql.ErrNoRows) {
				return ErrNotFound
			}
			if err != nil {
				return err
			}
			if owner == userOwner {
				continue
			}
			if owner != guestOwner {
				return ErrNotFound
			}
			result, err := tx.ExecContext(ctx, `UPDATE media_objects SET owner = ? WHERE id = ? AND owner = ?`,
				userOwner, id, guestOwner)
			if err != nil {
				return err
			}
			rows, err := result.RowsAffected()
			if err != nil {
				return err
			}
			if rows != 1 {
				return ErrNotFound
			}
		}
		return nil
	})
}

func (d *DB) DeleteMediaObject(ctx context.Context, id string) error {
	_, err := d.ExecContext(ctx, `DELETE FROM media_objects WHERE id = ?`, id)
	return err
}

type AdminMediaRow struct {
	MediaObject
	OwnerEmail string
}

func (d *DB) AdminMediaPage(ctx context.Context, query string, limit, offset int) ([]AdminMediaRow, int64, error) {
	filter := ""
	args := []any{}
	if query != "" {
		filter = ` WHERE (owner LIKE ? OR mime LIKE ? OR id = ?)`
		like := "%" + query + "%"
		args = append(args, like, like, query)
	}
	var total int64
	if err := d.QueryRowContext(ctx, `SELECT COUNT(*) FROM media_objects`+filter, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	pageArgs := append(append([]any{}, args...), limit, offset)
	rows, err := d.QueryContext(ctx, `SELECT `+mediaColumns+` FROM media_objects`+filter+`
		ORDER BY created_at DESC LIMIT ? OFFSET ?`, pageArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []AdminMediaRow
	for rows.Next() {
		var m MediaObject
		if err := rows.Scan(&m.ID, &m.ObjectKey, &m.Owner, &m.AttachmentID, &m.Mime, &m.Size, &m.SHA256, &m.CreatedAt); err != nil {
			return nil, 0, err
		}
		out = append(out, AdminMediaRow{MediaObject: m})
	}
	return out, total, rows.Err()
}

func (d *DB) MediaBytes(ctx context.Context) (int64, error) {
	var bytes int64
	err := d.QueryRowContext(ctx, `SELECT CAST(COALESCE(SUM(size), 0) AS BIGINT) FROM media_objects`).Scan(&bytes)
	return bytes, err
}

func (d *DB) CountMedia(ctx context.Context) (int64, error) {
	var count int64
	err := d.QueryRowContext(ctx, `SELECT COUNT(*) FROM media_objects`).Scan(&count)
	return count, err
}

func (d *DB) CountUserMedia(ctx context.Context, owner string) (count int64, bytes int64, err error) {
	err = d.QueryRowContext(ctx, `SELECT COUNT(*), CAST(COALESCE(SUM(size), 0) AS BIGINT) FROM media_objects WHERE owner = ?`, owner).
		Scan(&count, &bytes)
	return
}

var _ = time.Now
