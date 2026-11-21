package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

type ModelRow struct {
	PublicID    string
	UpstreamID  string
	DisplayName *string
	Alias       string
	Kind        string
	Enabled     bool
	Prices      string
	// Tiers is a JSON array of the option tiers the model supports, for image
	// and video models. Empty means every tier is supported.
	Tiers     string
	Sort      int
	CreatedAt int64
	UpdatedAt int64
}

const modelColumns = `public_id, upstream_id, display_name, alias, kind, enabled, prices, tiers, sort, created_at, updated_at`

func scanModel(row interface{ Scan(...any) error }) (*ModelRow, error) {
	var m ModelRow
	var display sql.NullString
	var enabled int
	err := row.Scan(&m.PublicID, &m.UpstreamID, &display, &m.Alias, &m.Kind, &enabled, &m.Prices, &m.Tiers, &m.Sort, &m.CreatedAt, &m.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	m.DisplayName = nullableString(display)
	m.Enabled = enabled != 0
	return &m, nil
}

func (d *DB) Models(ctx context.Context, enabledOnly bool) ([]ModelRow, error) {
	query := `SELECT ` + modelColumns + ` FROM model_catalog`
	if enabledOnly {
		query += ` WHERE enabled = 1`
	}
	query += ` ORDER BY sort ASC, alias ASC`
	rows, err := d.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ModelRow
	for rows.Next() {
		var m ModelRow
		var display sql.NullString
		var enabled int
		if err := rows.Scan(&m.PublicID, &m.UpstreamID, &display, &m.Alias, &m.Kind, &enabled, &m.Prices, &m.Tiers, &m.Sort, &m.CreatedAt, &m.UpdatedAt); err != nil {
			return nil, err
		}
		m.DisplayName = nullableString(display)
		m.Enabled = enabled != 0
		out = append(out, m)
	}
	return out, rows.Err()
}

func (d *DB) ModelByPublicID(ctx context.Context, publicID string) (*ModelRow, error) {
	return scanModel(d.QueryRowContext(ctx, `SELECT `+modelColumns+` FROM model_catalog WHERE public_id = ?`, publicID))
}

func (d *DB) UpsertModel(ctx context.Context, m ModelRow) error {
	enabled := 0
	if m.Enabled {
		enabled = 1
	}
	var display any
	if m.DisplayName != nil {
		display = *m.DisplayName
	}
	now := time.Now().UnixMilli()
	_, err := d.ExecContext(ctx, `INSERT INTO model_catalog (`+modelColumns+`)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (public_id) DO UPDATE SET alias = ?, kind = ?, enabled = ?, prices = ?, tiers = ?, display_name = ?, updated_at = ?`,
		m.PublicID, m.UpstreamID, display, m.Alias, m.Kind, enabled, m.Prices, m.Tiers, m.Sort, m.CreatedAt, m.UpdatedAt,
		m.Alias, m.Kind, enabled, m.Prices, m.Tiers, display, now)
	return err
}

func (d *DB) DeleteModel(ctx context.Context, publicID string) error {
	_, err := d.ExecContext(ctx, `DELETE FROM model_catalog WHERE public_id = ?`, publicID)
	return err
}

func (d *DB) UpdateModelDisplayName(ctx context.Context, publicID, displayName string) error {
	_, err := d.ExecContext(ctx, `UPDATE model_catalog SET display_name = ?, updated_at = ? WHERE public_id = ?`,
		displayName, time.Now().UnixMilli(), publicID)
	return err
}
