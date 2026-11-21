package store

import (
	"context"
	"database/sql"
	"errors"
)

// Reserve atomically takes one slot from a counter. It is used for daily
// generation limits, per-minute rate limits and media traffic budgets.
func (d *DB) Reserve(ctx context.Context, key string, limit int, expiresAt int64) (bool, error) {
	if limit == 0 {
		return false, nil
	}
	var count int64
	err := d.QueryRowContext(ctx, `INSERT INTO daily_usage (key, count, expires_at) VALUES (?, 1, ?)
		ON CONFLICT (key) DO UPDATE SET count = daily_usage.count + 1
		WHERE daily_usage.count < ?
		RETURNING count`, key, expiresAt, limit).Scan(&count)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// Refund returns one reserved slot. Used when an upstream generation fails.
func (d *DB) Refund(ctx context.Context, key string) error {
	_, err := d.ExecContext(ctx, `UPDATE daily_usage SET count = CASE WHEN count > 0 THEN count - 1 ELSE 0 END WHERE key = ?`, key)
	return err
}

// ReserveMany charges several counters (identity + IP scopes) in one commit.
func (d *DB) ReserveMany(ctx context.Context, keys []string, amount int64, limit int64, expiresAt int64) (bool, error) {
	if limit < amount || limit == 0 {
		return false, nil
	}
	err := d.InTx(ctx, func(tx *Tx) error {
		for _, key := range keys {
			var count int64
			err := tx.QueryRowContext(ctx, `INSERT INTO daily_usage (key, count, expires_at) VALUES (?, ?, ?)
				ON CONFLICT (key) DO UPDATE SET count = daily_usage.count + ?
				WHERE daily_usage.count <= ?
				RETURNING count`, key, amount, expiresAt, amount, limit-amount).Scan(&count)
			if errors.Is(err, sql.ErrNoRows) {
				return errQuotaExceeded
			}
			if err != nil {
				return err
			}
		}
		return nil
	})
	if errors.Is(err, errQuotaExceeded) {
		return false, nil
	}
	return err == nil, err
}

var errQuotaExceeded = errors.New("quota exceeded")
