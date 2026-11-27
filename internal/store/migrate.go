package store

import (
	"context"
	"embed"
	"fmt"
	"sort"
	"strings"
	"time"
)

//go:embed migrations/sqlite/*.sql migrations/postgres/*.sql
var migrationFS embed.FS

// migrationLockKey serializes PostgreSQL schema checks across replicas.
// SQLite serializes writes itself; the advisory lock is PostgreSQL-only.
const migrationLockKey = "olai-schema-migrations"

func (d *DB) migrate(ctx context.Context) error {
	dialect := "sqlite"
	if d.Postgres() {
		dialect = "postgres"
	}
	if _, err := d.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version INTEGER PRIMARY KEY,
		applied_at BIGINT NOT NULL
	)`); err != nil {
		return fmt.Errorf("创建迁移记录表失败：%w", err)
	}
	entries, err := migrationFS.ReadDir("migrations/" + dialect)
	if err != nil {
		return err
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".sql") {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	if d.Postgres() {
		return d.InTx(ctx, func(tx *Tx) error {
			if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext(?))`, migrationLockKey); err != nil {
				return fmt.Errorf("获取迁移锁失败：%w", err)
			}
			return d.applyMigrations(ctx, tx, dialect, names)
		})
	}
	return d.InTx(ctx, func(tx *Tx) error {
		return d.applyMigrations(ctx, tx, dialect, names)
	})
}

func (d *DB) applyMigrations(ctx context.Context, tx *Tx, dialect string, names []string) error {
	for index, name := range names {
		version := index + 1
		var exists int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM schema_migrations WHERE version = ?`, version).Scan(&exists); err != nil {
			return err
		}
		if exists > 0 {
			continue
		}
		body, err := migrationFS.ReadFile("migrations/" + dialect + "/" + name)
		if err != nil {
			return err
		}
		if err := func() error {
			for _, statement := range splitStatements(string(body)) {
				if _, err := tx.ExecContext(ctx, statement); err != nil {
					return fmt.Errorf("迁移 %s 失败：%w", name, err)
				}
			}
			_, err := tx.ExecContext(ctx, `INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`,
				version, time.Now().UnixMilli())
			return err
		}(); err != nil {
			return err
		}
	}
	return nil
}

// splitStatements splits the small, comment-only SQL files on semicolons at
// line ends. No migration contains semicolons inside string literals.
func splitStatements(body string) []string {
	lines := strings.Split(body, "\n")
	var statements []string
	var current strings.Builder
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "--") {
			continue
		}
		current.WriteString(line)
		current.WriteByte('\n')
		if strings.HasSuffix(trimmed, ";") {
			statement := strings.TrimSpace(current.String())
			statement = strings.TrimSuffix(statement, ";")
			if statement != "" {
				statements = append(statements, statement)
			}
			current.Reset()
		}
	}
	if tail := strings.TrimSpace(current.String()); tail != "" {
		statements = append(statements, strings.TrimSuffix(tail, ";"))
	}
	return statements
}
