package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// ErrMemoryLimit reports that the account already holds the maximum number of
// saved memories. The message is surfaced by the server as a readable error.
var ErrMemoryLimit = errors.New("memory limit reached")

// Memory is one short, durable fact or preference the user chose to keep.
type Memory struct {
	ID        string `json:"id"`
	Content   string `json:"content"`
	Source    string `json:"source"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
}

// MemorySettings controls whether saved memories are used in chats and whether
// new ones may be captured automatically. The zero value matches the database
// default: memory on, automatic capture off.
type MemorySettings struct {
	Enabled     bool `json:"enabled"`
	AutoCapture bool `json:"autoCapture"`
}

func (d *DB) MemorySettings(ctx context.Context, userID string) (MemorySettings, error) {
	var enabled, autoCapture int
	err := d.QueryRowContext(ctx, `SELECT enabled, auto_capture FROM user_memory_settings WHERE user_id = ?`, userID).
		Scan(&enabled, &autoCapture)
	if errors.Is(err, sql.ErrNoRows) {
		return MemorySettings{Enabled: true}, nil
	}
	if err != nil {
		return MemorySettings{}, err
	}
	return MemorySettings{Enabled: enabled != 0, AutoCapture: autoCapture != 0}, nil
}

func (d *DB) SaveMemorySettings(ctx context.Context, userID string, settings MemorySettings) error {
	now := time.Now().UnixMilli()
	enabled, autoCapture := boolInt(settings.Enabled), boolInt(settings.AutoCapture)
	_, err := d.ExecContext(ctx, `INSERT INTO user_memory_settings (user_id, enabled, auto_capture, updated_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT (user_id) DO UPDATE SET enabled = ?, auto_capture = ?, updated_at = ?`,
		userID, enabled, autoCapture, now, enabled, autoCapture, now)
	return err
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

// MemoryList returns memories oldest first so the settings list and the system
// prompt stay in a stable order.
func (d *DB) MemoryList(ctx context.Context, userID string) ([]Memory, error) {
	rows, err := d.QueryContext(ctx, `SELECT id, content, source, created_at, updated_at
		FROM user_memories WHERE user_id = ? ORDER BY created_at ASC, id ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Memory{}
	for rows.Next() {
		var item Memory
		if err := rows.Scan(&item.ID, &item.Content, &item.Source, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (d *DB) MemoryCount(ctx context.Context, userID string) (int, error) {
	var count int
	err := d.QueryRowContext(ctx, `SELECT COUNT(*) FROM user_memories WHERE user_id = ?`, userID).Scan(&count)
	return count, err
}

// CreateMemory inserts one memory inside a transaction that re-checks the cap,
// so two concurrent adds cannot both slip past the limit.
func (d *DB) CreateMemory(ctx context.Context, userID, id, content, source string, limit int) (*Memory, error) {
	now := time.Now().UnixMilli()
	item := &Memory{ID: id, Content: content, Source: source, CreatedAt: now, UpdatedAt: now}
	err := d.InTx(ctx, func(tx *Tx) error {
		var count int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM user_memories WHERE user_id = ?`, userID).Scan(&count); err != nil {
			return err
		}
		if count >= limit {
			return ErrMemoryLimit
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO user_memories (id, user_id, content, source, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?)`, id, userID, content, source, now, now)
		return err
	})
	if err != nil {
		return nil, err
	}
	return item, nil
}

func (d *DB) UpdateMemory(ctx context.Context, userID, id, content string) (bool, error) {
	result, err := d.ExecContext(ctx, `UPDATE user_memories SET content = ?, updated_at = ?
		WHERE id = ? AND user_id = ?`, content, time.Now().UnixMilli(), id, userID)
	if err != nil {
		return false, err
	}
	affected, err := result.RowsAffected()
	return affected > 0, err
}

func (d *DB) DeleteMemory(ctx context.Context, userID, id string) (bool, error) {
	result, err := d.ExecContext(ctx, `DELETE FROM user_memories WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return false, err
	}
	affected, err := result.RowsAffected()
	return affected > 0, err
}

func (d *DB) ClearMemories(ctx context.Context, userID string) error {
	_, err := d.ExecContext(ctx, `DELETE FROM user_memories WHERE user_id = ?`, userID)
	return err
}

// ChatMemories returns the contents to inject into a chat system prompt. It
// returns nil when the account switched memory off, so a disabled setting is
// enforced server-side and cannot be bypassed by the browser.
func (d *DB) ChatMemories(ctx context.Context, userID string) ([]string, error) {
	var enabled int
	err := d.QueryRowContext(ctx, `SELECT enabled FROM user_memory_settings WHERE user_id = ?`, userID).Scan(&enabled)
	if errors.Is(err, sql.ErrNoRows) {
		err = nil
		enabled = 1
	}
	if err != nil || enabled == 0 {
		return nil, err
	}
	rows, err := d.QueryContext(ctx, `SELECT content FROM user_memories WHERE user_id = ?
		ORDER BY created_at ASC, id ASC LIMIT 50`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	contents := []string{}
	for rows.Next() {
		var content string
		if err := rows.Scan(&content); err != nil {
			return nil, err
		}
		contents = append(contents, content)
	}
	return contents, rows.Err()
}
