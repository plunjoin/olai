package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// ErrSetupComplete is returned when the one-time installation wizard has
// already been completed (or a concurrent request completed it first).
var ErrSetupComplete = errors.New("setup already complete")

type AppSetting struct {
	Key   string
	Value string
}

func (d *DB) Settings(ctx context.Context) ([]AppSetting, error) {
	rows, err := d.QueryContext(ctx, `SELECT key, value FROM app_settings`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AppSetting
	for rows.Next() {
		var item AppSetting
		if err := rows.Scan(&item.Key, &item.Value); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (d *DB) SaveSettings(ctx context.Context, values map[string]string, removals []string, adminID string) error {
	now := time.Now().UnixMilli()
	return d.InTx(ctx, func(tx *Tx) error {
		for key, value := range values {
			if _, err := tx.ExecContext(ctx, `INSERT INTO app_settings (key, value, updated_at, updated_by)
				VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = ?, updated_at = ?, updated_by = ?`,
				key, value, now, adminID, value, now, adminID); err != nil {
				return err
			}
		}
		for _, key := range removals {
			if _, err := tx.ExecContext(ctx, `DELETE FROM app_settings WHERE key = ?`, key); err != nil {
				return err
			}
		}
		return nil
	})
}

// SettingValue reads one raw app_settings row. Internal keys such as
// SETUP_COMPLETED and SETTINGS_SEEDED are intentionally not part of
// settings.Defs, so they never reach the admin UI.
func (d *DB) SettingValue(ctx context.Context, key string) (string, bool, error) {
	var value string
	err := d.QueryRowContext(ctx, `SELECT value FROM app_settings WHERE key = ?`, key).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	return value, err == nil, err
}

// SeedSettings imports the .env configuration into SQLite once. Existing rows
// always win, so an admin edit or a previous import is never overwritten.
func (d *DB) SeedSettings(ctx context.Context, values map[string]string) error {
	now := time.Now().UnixMilli()
	return d.InTx(ctx, func(tx *Tx) error {
		for key, value := range values {
			if _, err := tx.ExecContext(ctx, `INSERT INTO app_settings (key, value, updated_at, updated_by)
				VALUES (?, ?, ?, 'system:env') ON CONFLICT (key) DO NOTHING`, key, value, now); err != nil {
				return err
			}
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO app_settings (key, value, updated_at, updated_by)
			VALUES ('SETTINGS_SEEDED', 'true', ?, 'system:env') ON CONFLICT (key) DO NOTHING`, now)
		return err
	})
}

// SetupRequired reports whether this is a brand-new installation. A completed
// setup flag freezes the wizard permanently; a database that already has users
// is treated as an existing installation even if the flag predates this code.
func (d *DB) SetupRequired(ctx context.Context) (bool, error) {
	value, ok, err := d.SettingValue(ctx, "SETUP_COMPLETED")
	if err != nil {
		return false, err
	}
	if ok && value == "true" {
		return false, nil
	}
	var users int64
	if err := d.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&users); err != nil {
		return false, err
	}
	return users == 0, nil
}

// EnsureSetupComplete marks an existing installation as set up so the public
// wizard cannot be reopened just because all users were later deleted.
func (d *DB) EnsureSetupComplete(ctx context.Context) error {
	value, ok, err := d.SettingValue(ctx, "SETUP_COMPLETED")
	if err != nil {
		return err
	}
	if ok && value == "true" {
		return nil
	}
	var users int64
	if err := d.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&users); err != nil {
		return err
	}
	if users == 0 {
		return nil
	}
	_, err = d.ExecContext(ctx, `INSERT INTO app_settings (key, value, updated_at, updated_by)
		VALUES ('SETUP_COMPLETED', 'true', ?, 'system') ON CONFLICT (key) DO NOTHING`, time.Now().UnixMilli())
	return err
}

// CompleteSetup creates the first console administrator and writes the site
// settings in one transaction. It does not create a portal user: the admin
// console keeps its own account table and login. Inserting SETUP_COMPLETED
// first makes two concurrent setup requests mutually exclusive on both SQLite
// and PostgreSQL.
func (d *DB) CompleteSetup(ctx context.Context, adminID, email, passwordHash, name string, settings map[string]string) error {
	now := time.Now().UnixMilli()
	var nameValue any
	if name != "" {
		nameValue = name
	}
	return d.InTx(ctx, func(tx *Tx) error {
		result, err := tx.ExecContext(ctx, `INSERT INTO app_settings (key, value, updated_at, updated_by)
			VALUES ('SETUP_COMPLETED', 'true', ?, 'setup') ON CONFLICT (key) DO NOTHING`, now)
		if err != nil {
			return err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if affected == 0 {
			return ErrSetupComplete
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO admin_accounts
			(id, email, password_hash, name, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?)`, adminID, email, passwordHash, nameValue, now, now); err != nil {
			return err
		}
		for key, value := range settings {
			if _, err := tx.ExecContext(ctx, `INSERT INTO app_settings (key, value, updated_at, updated_by)
				VALUES (?, ?, ?, 'setup') ON CONFLICT (key) DO UPDATE
				SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
				key, value, now); err != nil {
				return err
			}
		}
		return nil
	})
}

// ---- admin audit ----

type AdminLog struct {
	ID         string `json:"id"`
	AdminID    string `json:"adminId"`
	AdminEmail string `json:"adminEmail"`
	Action     string `json:"action"`
	Target     string `json:"target"`
	Detail     string `json:"detail"`
	IP         string `json:"ip"`
	CreatedAt  int64  `json:"createdAt"`
}

func (d *DB) InsertAdminLog(ctx context.Context, log AdminLog) error {
	_, err := d.ExecContext(ctx, `INSERT INTO admin_logs (id, admin_id, admin_email, action, target, detail, ip, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, log.ID, log.AdminID, log.AdminEmail, log.Action, log.Target, log.Detail, log.IP, log.CreatedAt)
	return err
}

func (d *DB) AdminLogs(ctx context.Context, query string, limit, offset int) ([]AdminLog, int64, error) {
	filter := ""
	args := []any{}
	if query != "" {
		filter = ` WHERE (action LIKE ? OR admin_email LIKE ? OR target LIKE ?)`
		like := "%" + query + "%"
		args = append(args, like, like, like)
	}
	var total int64
	if err := d.QueryRowContext(ctx, `SELECT COUNT(*) FROM admin_logs`+filter, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	pageArgs := append(append([]any{}, args...), limit, offset)
	rows, err := d.QueryContext(ctx, `SELECT id, admin_id, admin_email, action, target, detail, ip, created_at
		FROM admin_logs`+filter+` ORDER BY created_at DESC LIMIT ? OFFSET ?`, pageArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []AdminLog
	for rows.Next() {
		var log AdminLog
		if err := rows.Scan(&log.ID, &log.AdminID, &log.AdminEmail, &log.Action, &log.Target, &log.Detail, &log.IP, &log.CreatedAt); err != nil {
			return nil, 0, err
		}
		out = append(out, log)
	}
	return out, total, rows.Err()
}
