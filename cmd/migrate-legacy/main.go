// Command migrate-legacy copies rows from the old Astro-era PascalCase tables
// into the new Go schema. It is a one-off operator tool: it is not embedded in
// the server and never runs automatically.
//
// The default is a rehearsal: all inserts and checks run inside one
// BEGIN IMMEDIATE transaction that is rolled back at the end. Pass -apply to
// commit. Re-running is safe: rows that already exist are skipped by primary
// key, and any genuine conflict (duplicate email, object key, identity, …)
// aborts the whole transaction instead of silently dropping data.
package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"flag"
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	"olai/internal/config"
	"olai/internal/store"
)

type column struct {
	new  string
	expr string // SQL expression over alias o
}

type step struct {
	name   string
	legacy string
	target string
	keyOld []string
	keyNew []string
	cols   []column
	insert string
}

func c(old, newColumn string) column {
	return column{new: newColumn, expr: `o."` + old + `"`}
}

func e(newColumn, expr string) column {
	return column{new: newColumn, expr: expr}
}

// migrationSteps lists the backfill in foreign-key order. All legacy tables are
// included even when empty today, so a cutover after new old-site activity
// still preserves bans, record chunks, invites, email tokens and counters.
func migrationSteps() []step {
	return []step{
		{
			name:   "users ← User",
			legacy: "User",
			target: "users",
			keyOld: []string{"id"},
			keyNew: []string{"id"},
			cols: []column{
				c("email", "email"),
				c("passwordHash", "password_hash"),
				c("emailVerifiedAt", "email_verified_at"),
				c("name", "name"),
				c("avatar", "avatar"),
				c("createdAt", "created_at"),
				e("updated_at", `MAX(o."createdAt", COALESCE(o."emailVerifiedAt", 0))`),
			},
			insert: `INSERT INTO users (id, email, password_hash, email_verified_at, name, avatar, created_at, updated_at)
SELECT "id", "email", "passwordHash", "emailVerifiedAt", "name", "avatar", "createdAt",
       MAX("createdAt", COALESCE("emailVerifiedAt", 0))
FROM "User" WHERE true
ON CONFLICT (id) DO NOTHING`,
		},
		{
			name:   "sessions ← LoginSession",
			legacy: "LoginSession",
			target: "sessions",
			keyOld: []string{"tokenHash"},
			keyNew: []string{"token_hash"},
			cols: []column{
				c("userId", "user_id"),
				c("expiresAt", "expires_at"),
				e("created_at", `o."expiresAt" - 2592000000`),
			},
			insert: `INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
SELECT "tokenHash", "userId", "expiresAt", "expiresAt" - 2592000000
FROM "LoginSession" WHERE true
ON CONFLICT (token_hash) DO NOTHING`,
		},
		{
			name:   "oauth_accounts ← OAuthAccount",
			legacy: "OAuthAccount",
			target: "oauth_accounts",
			keyOld: []string{"provider", "providerId"},
			keyNew: []string{"provider", "provider_id"},
			cols: []column{
				c("userId", "user_id"),
				c("createdAt", "created_at"),
			},
			insert: `INSERT INTO oauth_accounts (provider, provider_id, user_id, created_at)
SELECT "provider", "providerId", "userId", "createdAt"
FROM "OAuthAccount" WHERE true
ON CONFLICT (provider, provider_id) DO NOTHING`,
		},
		{
			name:   "user_bans ← UserBan",
			legacy: "UserBan",
			target: "user_bans",
			keyOld: []string{"userId"},
			keyNew: []string{"user_id"},
			cols: []column{
				c("reason", "reason"),
				c("bannedBy", "banned_by"),
				c("bannedAt", "banned_at"),
			},
			insert: `INSERT INTO user_bans (user_id, reason, banned_by, banned_at)
SELECT "userId", "reason", "bannedBy", "bannedAt"
FROM "UserBan" WHERE true
ON CONFLICT (user_id) DO NOTHING`,
		},
		{
			name:   "email_tokens ← EmailToken",
			legacy: "EmailToken",
			target: "email_tokens",
			keyOld: []string{"tokenHash"},
			keyNew: []string{"token_hash"},
			cols: []column{
				c("userId", "user_id"),
				c("purpose", "purpose"),
				c("expiresAt", "expires_at"),
				c("createdAt", "created_at"),
			},
			insert: `INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at, created_at)
SELECT "tokenHash", "userId", "purpose", "expiresAt", "createdAt"
FROM "EmailToken" WHERE true
ON CONFLICT (token_hash) DO NOTHING`,
		},
		{
			name:   "point_accounts ← PointAccount",
			legacy: "PointAccount",
			target: "point_accounts",
			keyOld: []string{"userId"},
			keyNew: []string{"user_id"},
			cols: []column{
				c("balance", "balance"),
				c("updatedAt", "updated_at"),
			},
			insert: `INSERT INTO point_accounts (user_id, balance, updated_at)
SELECT "userId", "balance", "updatedAt"
FROM "PointAccount" WHERE true
ON CONFLICT (user_id) DO NOTHING`,
		},
		{
			name:   "point_ledger ← PointLedger",
			legacy: "PointLedger",
			target: "point_ledger",
			keyOld: []string{"id"},
			keyNew: []string{"id"},
			cols: []column{
				c("userId", "user_id"),
				c("delta", "delta"),
				c("reason", "reason"),
				c("refId", "ref_id"),
				e("note", `''`),
				c("createdAt", "created_at"),
			},
			insert: `INSERT INTO point_ledger (id, user_id, delta, reason, ref_id, note, created_at)
SELECT "id", "userId", "delta", "reason", "refId", '', "createdAt"
FROM "PointLedger" WHERE true
ON CONFLICT (id) DO NOTHING`,
		},
		{
			name:   "invite_codes ← InviteCode",
			legacy: "InviteCode",
			target: "invite_codes",
			keyOld: []string{"code"},
			keyNew: []string{"code"},
			cols: []column{
				c("userId", "user_id"),
				c("createdAt", "created_at"),
			},
			insert: `INSERT INTO invite_codes (code, user_id, created_at)
SELECT "code", "userId", "createdAt"
FROM "InviteCode" WHERE true
ON CONFLICT (code) DO NOTHING`,
		},
		{
			name:   "invites ← Invite",
			legacy: "Invite",
			target: "invites",
			keyOld: []string{"id"},
			keyNew: []string{"id"},
			cols: []column{
				c("inviterId", "inviter_id"),
				c("inviteeId", "invitee_id"),
				c("code", "code"),
				c("createdAt", "created_at"),
				c("rewardedAt", "rewarded_at"),
			},
			insert: `INSERT INTO invites (id, inviter_id, invitee_id, code, created_at, rewarded_at)
SELECT "id", "inviterId", "inviteeId", "code", "createdAt", "rewardedAt"
FROM "Invite" WHERE true
ON CONFLICT (id) DO NOTHING`,
		},
		{
			name:   "studio_records ← StudioRecord",
			legacy: "StudioRecord",
			target: "studio_records",
			keyOld: []string{"key"},
			keyNew: []string{"key"},
			cols: []column{
				c("userId", "user_id"),
				c("store", "store"),
				c("recordId", "record_id"),
				c("data", "data"),
				c("updatedAt", "updated_at"),
			},
			insert: `INSERT INTO studio_records (key, user_id, store, record_id, data, updated_at)
SELECT "key", "userId", "store", "recordId", "data", "updatedAt"
FROM "StudioRecord" WHERE true
ON CONFLICT (key) DO NOTHING`,
		},
		{
			name:   "record_chunks ← RecordChunk",
			legacy: "RecordChunk",
			target: "record_chunks",
			keyOld: []string{"id"},
			keyNew: []string{"id"},
			cols: []column{
				c("recordKey", "record_key"),
				c("position", "chunk_index"),
				c("data", "data"),
			},
			insert: `INSERT INTO record_chunks (id, record_key, chunk_index, data)
SELECT "id", "recordKey", "position", "data"
FROM "RecordChunk" WHERE true
ON CONFLICT (id) DO NOTHING`,
		},
		{
			name:   "media_objects ← MediaObject",
			legacy: "MediaObject",
			target: "media_objects",
			keyOld: []string{"id"},
			keyNew: []string{"id"},
			cols: []column{
				c("objectKey", "object_key"),
				c("owner", "owner"),
				c("attachmentId", "attachment_id"),
				c("mime", "mime"),
				c("size", "size"),
				c("sha256", "sha256"),
				c("createdAt", "created_at"),
			},
			insert: `INSERT INTO media_objects (id, object_key, owner, attachment_id, mime, size, sha256, created_at)
SELECT "id", "objectKey", "owner", "attachmentId", "mime", "size", "sha256", "createdAt"
FROM "MediaObject" WHERE true
ON CONFLICT (id) DO NOTHING`,
		},
		{
			name:   "daily_usage ← DailyUsage",
			legacy: "DailyUsage",
			target: "daily_usage",
			keyOld: []string{"key"},
			keyNew: []string{"key"},
			cols: []column{
				c("count", "count"),
				c("expiresAt", "expires_at"),
			},
			insert: `INSERT INTO daily_usage (key, count, expires_at)
SELECT "key", "count", "expiresAt"
FROM "DailyUsage" WHERE true
ON CONFLICT (key) DO NOTHING`,
		},
		{
			name:   "video_jobs ← VideoJob",
			legacy: "VideoJob",
			target: "video_jobs",
			keyOld: []string{"id"},
			keyNew: []string{"id"},
			cols: []column{
				c("owner", "owner"),
				c("createdAt", "created_at"),
			},
			insert: `INSERT INTO video_jobs (id, owner, created_at)
SELECT "id", "owner", "createdAt"
FROM "VideoJob" WHERE true
ON CONFLICT (id) DO NOTHING`,
		},
		{
			name:   "app_settings ← AppSetting",
			legacy: "AppSetting",
			target: "app_settings",
			keyOld: []string{"key"},
			keyNew: []string{"key"},
			cols: []column{
				c("value", "value"),
				c("updatedAt", "updated_at"),
				c("updatedBy", "updated_by"),
			},
			insert: `INSERT INTO app_settings (key, value, updated_at, updated_by)
SELECT "key", "value", "updatedAt", "updatedBy"
FROM "AppSetting" WHERE true
ON CONFLICT (key) DO NOTHING`,
		},
		{
			name:   "admin_logs ← AdminLog",
			legacy: "AdminLog",
			target: "admin_logs",
			keyOld: []string{"id"},
			keyNew: []string{"id"},
			cols: []column{
				c("adminId", "admin_id"),
				c("adminEmail", "admin_email"),
				c("action", "action"),
				c("target", "target"),
				c("detail", "detail"),
				c("ip", "ip"),
				c("createdAt", "created_at"),
			},
			insert: `INSERT INTO admin_logs (id, admin_id, admin_email, action, target, detail, ip, created_at)
SELECT "id", "adminId", "adminEmail", "action", "target", "detail", "ip", "createdAt"
FROM "AdminLog" WHERE true
ON CONFLICT (id) DO NOTHING`,
		},
		{
			name:   "model_catalog ← ModelCatalog",
			legacy: "ModelCatalog",
			target: "model_catalog",
			keyOld: []string{"publicId"},
			keyNew: []string{"public_id"},
			cols: []column{
				c("upstreamId", "upstream_id"),
				c("displayName", "display_name"),
				c("alias", "alias"),
				c("kind", "kind"),
				c("enabled", "enabled"),
				c("prices", "prices"),
				c("sort", "sort"),
				c("createdAt", "created_at"),
				c("updatedAt", "updated_at"),
			},
			insert: `INSERT INTO model_catalog (public_id, upstream_id, display_name, alias, kind, enabled, prices, sort, created_at, updated_at)
SELECT "publicId", "upstreamId", "displayName", "alias", "kind", "enabled", "prices", "sort", "createdAt", "updatedAt"
FROM "ModelCatalog" WHERE true
ON CONFLICT (public_id) DO NOTHING`,
		},
	}
}

// verifySQL returns old/new/missing/mismatch counts for one mapping. Reads run
// inside the same transaction, so a dry run validates exactly what would land.
func verifySQL(s step) string {
	pairs := make([]string, 0, len(s.keyOld))
	for i := range s.keyOld {
		pairs = append(pairs, fmt.Sprintf(`n."%s" IS o."%s"`, s.keyNew[i], s.keyOld[i]))
	}
	keyJoin := strings.Join(pairs, " AND ")
	conditions := make([]string, 0, len(s.cols))
	for _, col := range s.cols {
		conditions = append(conditions, fmt.Sprintf(`n."%s" IS %s`, col.new, col.expr))
	}
	return fmt.Sprintf(`SELECT
 (SELECT COUNT(*) FROM "%s") AS old_count,
 (SELECT COUNT(*) FROM %s) AS new_count,
 (SELECT COUNT(*) FROM "%s" o WHERE NOT EXISTS (SELECT 1 FROM %s n WHERE %s)) AS missing,
 (SELECT COUNT(*) FROM %s n JOIN "%s" o ON %s WHERE NOT (%s)) AS mismatch`,
		s.legacy, s.target, s.legacy, s.target, keyJoin,
		s.target, s.legacy, keyJoin, strings.Join(conditions, " AND "))
}

func main() {
	apply := flag.Bool("apply", false, "提交迁移；不加此参数时只试运行并回滚")
	force := flag.Bool("force", false, "目标表已有数据时仍继续（用于中断后续跑）")
	dbPath := flag.String("db", "", "SQLite 文件路径；默认使用 DATABASE_URL 或 data/olai.db")
	flag.Usage = func() {
		fmt.Fprintf(flag.CommandLine.Output(), `用法：go run ./cmd/migrate-legacy [参数]

把旧 Astro 版本的 PascalCase 表复制到新的 Go 表结构。默认在事务内演练并回滚，
加 -apply 才提交。执行前请停止旧 Astro 与新 Go 两个进程，并备份数据库（含 WAL）。

参数：
`)
		flag.PrintDefaults()
	}
	flag.Parse()

	cfg := config.Load()
	if *dbPath != "" {
		cfg.DatabaseURL = *dbPath
	}
	driver, dsn, err := config.NormalizeDatabaseURL(cfg.DatabaseURL)
	if err != nil {
		fail(fmt.Sprintf("数据库地址无效：%v", err))
	}
	if driver != "sqlite" {
		fail("旧 Astro 数据只存在 SQLite；当前 DATABASE_URL 指向 PostgreSQL，暂不支持自动迁移。")
	}
	filePath := sqliteFilePath(dsn)
	if _, err := os.Stat(filePath); err != nil {
		fail(fmt.Sprintf("数据库文件不存在：%s", filePath))
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	db, err := store.Open(ctx, cfg)
	if err != nil {
		fail(fmt.Sprintf("打开数据库失败：%v", err))
	}
	defer db.Close()

	conn, err := db.Conn(ctx)
	if err != nil {
		fail(fmt.Sprintf("获取数据库连接失败：%v", err))
	}
	defer conn.Close()

	steps := migrationSteps()
	before := make(map[string]int64, len(steps))
	foundLegacy := 0
	for _, s := range steps {
		if !tableExists(ctx, conn, s.legacy) {
			continue
		}
		foundLegacy++
		if !tableExists(ctx, conn, s.target) {
			fail(fmt.Sprintf("新表 %s 不存在；请先启动一次 Go 服务完成建表。", s.target))
		}
		before[s.target] = countRows(ctx, conn, s.target)
	}
	if foundLegacy == 0 {
		fmt.Println("未发现旧 Astro 表，无需迁移。")
		return
	}
	if *apply && !*force {
		var occupied []string
		for _, s := range steps {
			if before[s.target] > 0 {
				occupied = append(occupied, fmt.Sprintf("%s=%d", s.target, before[s.target]))
			}
		}
		if len(occupied) > 0 {
			fail("目标表已有数据（" + strings.Join(occupied, "，") + "）。如果确认要在已有数据上续跑，请加 -force；否则先试运行核对。")
		}
	}

	mode := "试运行（事务结束后回滚）"
	if *apply {
		mode = "正式写入（事务提交）"
	}
	fmt.Printf("模式：%s\n数据库：%s\n\n", mode, filePath)

	if _, err := conn.ExecContext(ctx, `PRAGMA foreign_keys = ON`); err != nil {
		fail(fmt.Sprintf("启用外键检查失败：%v", err))
	}
	if _, err := conn.ExecContext(ctx, `BEGIN IMMEDIATE`); err != nil {
		fail(fmt.Sprintf("无法开始写事务（是否还有服务在运行？）：%v", err))
	}
	inTx := true
	defer func() {
		if inTx {
			_, _ = conn.ExecContext(context.Background(), `ROLLBACK`)
		}
	}()

	fmt.Printf("%-30s %8s %8s %8s %8s\n", "迁移项", "旧表", "新增", "缺失", "不一致")
	var problems []string
	var totalOld, totalInserted int64
	for _, s := range steps {
		if !tableExists(ctx, conn, s.legacy) {
			fmt.Printf("%-30s %s\n", s.name, "旧表不存在，跳过")
			continue
		}
		start := countRows(ctx, conn, s.target)
		if _, err := conn.ExecContext(ctx, s.insert); err != nil {
			_, _ = conn.ExecContext(context.Background(), `ROLLBACK`)
			inTx = false
			fail(fmt.Sprintf("写入 %s 失败，已回滚：%v", s.name, err))
		}
		after := countRows(ctx, conn, s.target)
		var oldCount, newCount, missing, mismatch int64
		if err := conn.QueryRowContext(ctx, verifySQL(s)).Scan(&oldCount, &newCount, &missing, &mismatch); err != nil {
			_, _ = conn.ExecContext(context.Background(), `ROLLBACK`)
			inTx = false
			fail(fmt.Sprintf("校验 %s 失败，已回滚：%v", s.name, err))
		}
		inserted := after - start
		fmt.Printf("%-30s %8d %8d %8d %8d\n", s.name, oldCount, inserted, missing, mismatch)
		totalOld += oldCount
		totalInserted += inserted
		if missing > 0 {
			problems = append(problems, fmt.Sprintf("%s：%d 行未进入新表", s.name, missing))
		}
		if mismatch > 0 {
			problems = append(problems, fmt.Sprintf("%s：%d 行列值不一致", s.name, mismatch))
		}
	}

	problems = append(problems, globalChecks(ctx, conn)...)

	fmt.Printf("\n合计：旧表 %d 行，本次新增 %d 行。\n", totalOld, totalInserted)
	if len(problems) > 0 {
		_, _ = conn.ExecContext(ctx, `ROLLBACK`)
		inTx = false
		fmt.Println("\n校验未通过，已回滚：")
		for _, problem := range problems {
			fmt.Println("- " + problem)
		}
		os.Exit(1)
	}

	if *apply {
		if _, err := conn.ExecContext(ctx, `COMMIT`); err != nil {
			fail(fmt.Sprintf("提交失败：%v", err))
		}
		inTx = false
		fmt.Println("\n迁移已提交。旧 PascalCase 表保持不变，可用于回滚或验收比对。")
		// The copied studio_records rows have no created_at yet; fill it now so
		// the newest feed is ordered correctly before the first server start.
		backfillCtx, cancelBackfill := context.WithTimeout(context.Background(), 2*time.Minute)
		if err := db.BackfillRecordCreatedAt(backfillCtx); err != nil {
			fmt.Fprintf(os.Stderr, "作品创建时间回填未完成，下次启动服务时会继续：%v\n", err)
		}
		cancelBackfill()
		checkpoint(ctx, conn)
		return
	}

	if _, err := conn.ExecContext(ctx, `ROLLBACK`); err != nil {
		fail(fmt.Sprintf("回滚失败：%v", err))
	}
	inTx = false
	fmt.Println("\n试运行通过，事务已回滚，没有写入任何数据。确认无误后加 -apply 正式执行。")
}

func globalChecks(ctx context.Context, conn *sql.Conn) []string {
	var problems []string

	fkRows, err := conn.QueryContext(ctx, `PRAGMA foreign_key_check`)
	if err != nil {
		problems = append(problems, fmt.Sprintf("外键检查执行失败：%v", err))
	} else {
		count := 0
		for fkRows.Next() {
			count++
		}
		if err := fkRows.Err(); err != nil {
			problems = append(problems, fmt.Sprintf("外键检查读取失败：%v", err))
		}
		_ = fkRows.Close()
		fmt.Printf("外键检查：%d 个问题\n", count)
		if count > 0 {
			problems = append(problems, fmt.Sprintf("外键检查发现 %d 个孤儿行", count))
		}
	}

	var integrity string
	if err := conn.QueryRowContext(ctx, `PRAGMA integrity_check`).Scan(&integrity); err != nil {
		problems = append(problems, fmt.Sprintf("完整性检查执行失败：%v", err))
	} else {
		fmt.Printf("完整性检查：%s\n", integrity)
		if integrity != "ok" {
			problems = append(problems, "完整性检查未通过："+firstLine(integrity))
		}
	}

	for _, check := range []struct {
		label string
		query string
	}{
		{"作品 JSON", `SELECT COUNT(*) FROM studio_records WHERE json_valid(data) = 0`},
		{"模型价格 JSON", `SELECT COUNT(*) FROM model_catalog WHERE json_valid(prices) = 0`},
		{"积分账本与余额", `SELECT COUNT(*) FROM point_accounts p
			LEFT JOIN (SELECT user_id, SUM(delta) AS total FROM point_ledger GROUP BY user_id) l
			ON l.user_id = p.user_id
			WHERE p.balance <> COALESCE(l.total, 0)`},
	} {
		var bad int64
		if err := conn.QueryRowContext(ctx, check.query).Scan(&bad); err != nil {
			problems = append(problems, fmt.Sprintf("%s检查失败：%v", check.label, err))
			continue
		}
		fmt.Printf("%s检查：%d 个问题\n", check.label, bad)
		if bad > 0 {
			problems = append(problems, fmt.Sprintf("%s发现 %d 个问题", check.label, bad))
		}
	}

	badKeys, err := recordKeyMismatches(ctx, conn)
	if err != nil {
		problems = append(problems, fmt.Sprintf("作品 key 检查失败：%v", err))
	} else {
		fmt.Printf("作品 key 检查：%d 个问题\n", badKeys)
		if badKeys > 0 {
			problems = append(problems, fmt.Sprintf("%d 条作品的 key 与 user:store:record 的 SHA-256 不一致", badKeys))
		}
	}

	var userOwned, guestOwned int64
	if err := conn.QueryRowContext(ctx, `SELECT
		COALESCE(SUM(CASE WHEN owner LIKE 'user:%' THEN 1 ELSE 0 END), 0),
		COALESCE(SUM(CASE WHEN owner LIKE 'guest:%' THEN 1 ELSE 0 END), 0)
		FROM media_objects`).Scan(&userOwned, &guestOwned); err == nil {
		fmt.Printf("媒体归属：账号 %d 条，游客 %d 条\n", userOwned, guestOwned)
	}

	return problems
}

func recordKeyMismatches(ctx context.Context, conn *sql.Conn) (int, error) {
	rows, err := conn.QueryContext(ctx, `SELECT "key", user_id, store, record_id FROM studio_records`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	bad := 0
	for rows.Next() {
		var key, userID, storeName, recordID string
		if err := rows.Scan(&key, &userID, &storeName, &recordID); err != nil {
			return bad, err
		}
		sum := sha256.Sum256([]byte(userID + ":" + storeName + ":" + recordID))
		if key != hex.EncodeToString(sum[:]) {
			bad++
		}
	}
	return bad, rows.Err()
}

func checkpoint(ctx context.Context, conn *sql.Conn) {
	var busy, logFrames, checkpointed int64
	if err := conn.QueryRowContext(ctx, `PRAGMA wal_checkpoint(TRUNCATE)`).Scan(&busy, &logFrames, &checkpointed); err != nil {
		fmt.Printf("WAL checkpoint 失败（可稍后手动执行）：%v\n", err)
		return
	}
	fmt.Printf("WAL checkpoint：busy=%d log=%d checkpointed=%d\n", busy, logFrames, checkpointed)
	if busy != 0 {
		fmt.Println("提示：仍有连接占用数据库，稍后请在停服状态下再执行一次 PRAGMA wal_checkpoint(TRUNCATE)。")
	}
}

func tableExists(ctx context.Context, conn *sql.Conn, name string) bool {
	var count int
	if err := conn.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, name).Scan(&count); err != nil {
		fail(fmt.Sprintf("读取表结构失败：%v", err))
	}
	return count > 0
}

func countRows(ctx context.Context, conn *sql.Conn, name string) int64 {
	var count int64
	if err := conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM "`+name+`"`).Scan(&count); err != nil {
		fail(fmt.Sprintf("统计 %s 行数失败：%v", name, err))
	}
	return count
}

func sqliteFilePath(dsn string) string {
	path := strings.TrimPrefix(dsn, "file:")
	if index := strings.IndexByte(path, '?'); index >= 0 {
		path = path[:index]
	}
	if decoded, err := url.PathUnescape(path); err == nil {
		path = decoded
	}
	return path
}

func firstLine(value string) string {
	if index := strings.IndexByte(value, '\n'); index >= 0 {
		return value[:index]
	}
	return value
}

func fail(message string) {
	fmt.Fprintln(os.Stderr, "错误："+message)
	os.Exit(1)
}
