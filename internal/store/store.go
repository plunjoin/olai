package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	_ "github.com/jackc/pgx/v5/stdlib"
	_ "modernc.org/sqlite"

	"olai/internal/config"
)

// DB is a small driver-neutral wrapper. It rebinds `?` placeholders to `$n`
// for PostgreSQL so every query can be written once.
type DB struct {
	*sql.DB
	driver string
}

func Open(ctx context.Context, cfg config.Config) (*DB, error) {
	driver, dsn, err := config.NormalizeDatabaseURL(cfg.DatabaseURL)
	if err != nil {
		return nil, err
	}
	conn, err := sql.Open(driver, dsn)
	if err != nil {
		return nil, err
	}
	if driver == "sqlite" {
		// WAL keeps readers concurrent; writes are serialized with a busy timeout.
		conn.SetMaxOpenConns(8)
		conn.SetMaxIdleConns(4)
		conn.SetConnMaxLifetime(0)
	} else {
		conn.SetMaxOpenConns(20)
		conn.SetMaxIdleConns(10)
		conn.SetConnMaxLifetime(30 * time.Minute)
	}
	pingCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if err := conn.PingContext(pingCtx); err != nil {
		conn.Close()
		return nil, fmt.Errorf("数据库连接失败：%w", err)
	}
	db := &DB{DB: conn, driver: driver}
	if err := db.migrate(ctx); err != nil {
		conn.Close()
		return nil, err
	}
	if err := db.BackfillRecordCreatedAt(ctx); err != nil {
		conn.Close()
		return nil, fmt.Errorf("回填作品创建时间失败：%w", err)
	}
	return db, nil
}

func (d *DB) Driver() string { return d.driver }
func (d *DB) Postgres() bool { return d.driver == "pgx" }

// Bind converts the portable `?` placeholder style to the active dialect.
func (d *DB) Bind(query string) string {
	if !d.Postgres() {
		return query
	}
	var out strings.Builder
	out.Grow(len(query) + 8)
	index := 0
	for i := 0; i < len(query); i++ {
		if query[i] == '?' {
			index++
			fmt.Fprintf(&out, "$%d", index)
			continue
		}
		out.WriteByte(query[i])
	}
	return out.String()
}

func (d *DB) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return d.DB.ExecContext(ctx, d.Bind(query), args...)
}

func (d *DB) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return d.DB.QueryContext(ctx, d.Bind(query), args...)
}

func (d *DB) QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row {
	return d.DB.QueryRowContext(ctx, d.Bind(query), args...)
}

// Tx mirrors DB inside a transaction.
type Tx struct {
	tx *sql.Tx
	d  *DB
}

func (t *Tx) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return t.tx.ExecContext(ctx, t.d.Bind(query), args...)
}
func (t *Tx) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return t.tx.QueryContext(ctx, t.d.Bind(query), args...)
}
func (t *Tx) QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row {
	return t.tx.QueryRowContext(ctx, t.d.Bind(query), args...)
}

func (d *DB) InTx(ctx context.Context, fn func(*Tx) error) error {
	tx, err := d.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	wrapped := &Tx{tx: tx, d: d}
	if err := fn(wrapped); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

// IsUniqueViolation reports a duplicate-key error on either driver. Callers use
// it for idempotent inserts (invite rewards, ledger entries, media identities).
func IsUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505"
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "unique constraint") || strings.Contains(message, "constraint failed: unique")
}

var cleanupCounter atomic.Int64

// MaybeCleanupExpired removes stale quota rows and sessions at most once per
// hour per process. Failures are intentionally ignored: they must not block a
// user request.
func (d *DB) MaybeCleanupExpired(ctx context.Context) {
	now := time.Now().UnixMilli()
	last := cleanupCounter.Load()
	if last != 0 && now-last < 3_600_000 {
		return
	}
	if !cleanupCounter.CompareAndSwap(last, now) {
		return
	}
	_, _ = d.ExecContext(ctx, `DELETE FROM daily_usage WHERE expires_at < ?`, now)
	_, _ = d.ExecContext(ctx, `DELETE FROM sessions WHERE expires_at < ?`, now)
	_, _ = d.ExecContext(ctx, `DELETE FROM admin_sessions WHERE expires_at < ?`, now)
}
