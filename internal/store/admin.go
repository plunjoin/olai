package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

type AdminUserRow struct {
	ID        string
	Email     string
	CreatedAt int64
	Balance   int64
	BannedAt  *int64
	BanReason *string
}

func (d *DB) AdminUsers(ctx context.Context, query string, limit, offset int) ([]AdminUserRow, int64, error) {
	// The official publisher account owns works added from the console; it is
	// not a person and stays out of user management.
	filter := ` WHERE u.system = 0`
	args := []any{}
	if query != "" {
		filter += ` AND (u.email LIKE ? OR u.id = ?)`
		args = append(args, "%"+query+"%", query)
	}
	var total int64
	if err := d.QueryRowContext(ctx, `SELECT COUNT(*) FROM users u`+filter, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	pageArgs := append(append([]any{}, args...), limit, offset)
	rows, err := d.QueryContext(ctx, `SELECT u.id, u.email, u.created_at,
		COALESCE(p.balance, 0), b.banned_at, b.reason
		FROM users u
		LEFT JOIN point_accounts p ON p.user_id = u.id
		LEFT JOIN user_bans b ON b.user_id = u.id`+filter+`
		ORDER BY u.created_at DESC LIMIT ? OFFSET ?`, pageArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []AdminUserRow
	for rows.Next() {
		var row AdminUserRow
		var banned sql.NullInt64
		var reason sql.NullString
		if err := rows.Scan(&row.ID, &row.Email, &row.CreatedAt, &row.Balance, &banned, &reason); err != nil {
			return nil, 0, err
		}
		row.BannedAt = nullableInt(banned)
		row.BanReason = nullableString(reason)
		out = append(out, row)
	}
	return out, total, rows.Err()
}

type AdminUserDetail struct {
	ID        string
	Email     string
	CreatedAt int64
	Balance   int64
	BannedAt  *int64
	BanReason *string
}

func (d *DB) AdminUser(ctx context.Context, id string) (*AdminUserDetail, error) {
	var row AdminUserDetail
	var banned sql.NullInt64
	var reason sql.NullString
	err := d.QueryRowContext(ctx, `SELECT u.id, u.email, u.created_at, COALESCE(p.balance, 0), b.banned_at, b.reason
		FROM users u LEFT JOIN point_accounts p ON p.user_id = u.id LEFT JOIN user_bans b ON b.user_id = u.id
		WHERE u.id = ?`, id).Scan(&row.ID, &row.Email, &row.CreatedAt, &row.Balance, &banned, &reason)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	row.BannedAt = nullableInt(banned)
	row.BanReason = nullableString(reason)
	return &row, nil
}

type AdminOAuthRow struct {
	Provider  string `json:"provider"`
	CreatedAt int64  `json:"createdAt"`
}

func (d *DB) AdminOAuthAccounts(ctx context.Context, userID string) ([]AdminOAuthRow, error) {
	rows, err := d.QueryContext(ctx, `SELECT provider, created_at FROM oauth_accounts WHERE user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AdminOAuthRow
	for rows.Next() {
		var row AdminOAuthRow
		if err := rows.Scan(&row.Provider, &row.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

type AdminLedgerRow struct {
	Delta     int64  `json:"delta"`
	Reason    string `json:"reason"`
	RefID     string `json:"refId"`
	CreatedAt int64  `json:"createdAt"`
}

func (d *DB) AdminUserSpend(ctx context.Context, userID string) (count int64, points int64, err error) {
	err = d.QueryRowContext(ctx, `SELECT COUNT(*), CAST(COALESCE(SUM(-delta), 0) AS BIGINT) FROM point_ledger
		WHERE user_id = ? AND reason = 'spend'`, userID).Scan(&count, &points)
	return
}

func (d *DB) AdminInvitesFor(ctx context.Context, userID string, limit int) ([]Invite, error) {
	rows, err := d.QueryContext(ctx, `SELECT id, inviter_id, invitee_id, code, created_at, rewarded_at
		FROM invites WHERE inviter_id = ? ORDER BY created_at DESC LIMIT ?`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Invite
	for rows.Next() {
		var item Invite
		var rewarded sql.NullInt64
		if err := rows.Scan(&item.ID, &item.InviterID, &item.InviteeID, &item.Code, &item.CreatedAt, &rewarded); err != nil {
			return nil, err
		}
		item.RewardedAt = nullableInt(rewarded)
		out = append(out, item)
	}
	return out, rows.Err()
}

func (d *DB) AdminInvitedBy(ctx context.Context, userID string) (*Invite, error) {
	var item Invite
	var rewarded sql.NullInt64
	err := d.QueryRowContext(ctx, `SELECT id, inviter_id, invitee_id, code, created_at, rewarded_at
		FROM invites WHERE invitee_id = ?`, userID).
		Scan(&item.ID, &item.InviterID, &item.InviteeID, &item.Code, &item.CreatedAt, &rewarded)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	item.RewardedAt = nullableInt(rewarded)
	return &item, nil
}

func (d *DB) AdminUserRecordCount(ctx context.Context, userID string) (int64, error) {
	var count int64
	err := d.QueryRowContext(ctx, `SELECT COUNT(*) FROM studio_records WHERE user_id = ? AND store = 'assets'`, userID).Scan(&count)
	return count, err
}

func (d *DB) EmailsByIDs(ctx context.Context, ids []string) (map[string]string, error) {
	out := map[string]string{}
	if len(ids) == 0 {
		return out, nil
	}
	placeholders := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}
	rows, err := d.QueryContext(ctx, `SELECT id, email FROM users WHERE id IN (`+joinStrings(placeholders, ",")+`)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, email string
		if err := rows.Scan(&id, &email); err != nil {
			return nil, err
		}
		out[id] = email
	}
	return out, rows.Err()
}

func joinStrings(items []string, separator string) string {
	if len(items) == 0 {
		return ""
	}
	out := items[0]
	for _, item := range items[1:] {
		out += separator + item
	}
	return out
}

type TopInviter struct {
	InviterID string `json:"inviterId"`
	Total     int64  `json:"total"`
	Rewarded  int64  `json:"rewarded"`
}

func (d *DB) AdminTopInviters(ctx context.Context, limit int) ([]TopInviter, error) {
	rows, err := d.QueryContext(ctx, `SELECT inviter_id, COUNT(*),
		CAST(COALESCE(SUM(CASE WHEN rewarded_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS BIGINT)
		FROM invites GROUP BY inviter_id ORDER BY COUNT(*) DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TopInviter
	for rows.Next() {
		var row TopInviter
		if err := rows.Scan(&row.InviterID, &row.Total, &row.Rewarded); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

type AdminSpendRow struct {
	ID        string
	UserID    string
	Email     string
	Delta     int64
	RefID     string
	CreatedAt int64
}

func (d *DB) AdminSpendSummary(ctx context.Context) (count int64, points int64, err error) {
	err = d.QueryRowContext(ctx, `SELECT COUNT(*), CAST(COALESCE(SUM(-delta), 0) AS BIGINT)
		FROM point_ledger WHERE reason = 'spend'`).Scan(&count, &points)
	return
}

func (d *DB) AdminSpends(ctx context.Context, limit, offset int) ([]AdminSpendRow, int64, error) {
	var total int64
	if err := d.QueryRowContext(ctx, `SELECT COUNT(*) FROM point_ledger WHERE reason = 'spend'`).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := d.QueryContext(ctx, `SELECT l.id, l.user_id, u.email, l.delta, l.ref_id, l.created_at
		FROM point_ledger l JOIN users u ON u.id = l.user_id
		WHERE l.reason = 'spend' ORDER BY l.created_at DESC LIMIT ? OFFSET ?`, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []AdminSpendRow
	for rows.Next() {
		var row AdminSpendRow
		if err := rows.Scan(&row.ID, &row.UserID, &row.Email, &row.Delta, &row.RefID, &row.CreatedAt); err != nil {
			return nil, 0, err
		}
		out = append(out, row)
	}
	return out, total, rows.Err()
}

type AdminRecordRow struct {
	Key       string
	UserID    string
	Email     string
	RecordID  string
	UpdatedAt int64
}

func (d *DB) AdminRecentRecords(ctx context.Context, limit int) ([]AdminRecordRow, error) {
	rows, err := d.QueryContext(ctx, `SELECT r.key, r.user_id, u.email, r.record_id, r.updated_at
		FROM studio_records r JOIN users u ON u.id = r.user_id
		WHERE r.store = 'assets' ORDER BY r.updated_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AdminRecordRow
	for rows.Next() {
		var row AdminRecordRow
		if err := rows.Scan(&row.Key, &row.UserID, &row.Email, &row.RecordID, &row.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

type Overview struct {
	UsersTotal       int64
	UsersToday       int64
	UsersWeek        int64
	PointsCirc       int64
	PointsIssued     int64
	PointsSpent      int64
	TodayGenerations int64
	TodayPoints      int64
	InvitesTotal     int64
	InvitesRewarded  int64
	MediaCount       int64
	MediaBytes       int64
	RecordCount      int64
}

func (d *DB) Overview(ctx context.Context, todayStart, weekAgo int64) (Overview, error) {
	var out Overview
	queries := []struct {
		query string
		args  []any
		dest  *int64
	}{
		{`SELECT COUNT(*) FROM users WHERE system = 0`, nil, &out.UsersTotal},
		{`SELECT COUNT(*) FROM users WHERE system = 0 AND created_at >= ?`, []any{todayStart}, &out.UsersToday},
		{`SELECT COUNT(*) FROM users WHERE system = 0 AND created_at >= ?`, []any{weekAgo}, &out.UsersWeek},
		{`SELECT CAST(COALESCE(SUM(balance), 0) AS BIGINT) FROM point_accounts`, nil, &out.PointsCirc},
		{`SELECT CAST(COALESCE(SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END), 0) AS BIGINT) FROM point_ledger`, nil, &out.PointsIssued},
		{`SELECT CAST(COALESCE(SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END), 0) AS BIGINT) FROM point_ledger`, nil, &out.PointsSpent},
		{`SELECT COUNT(*) FROM point_ledger WHERE reason = 'spend' AND created_at >= ?`, []any{todayStart}, &out.TodayGenerations},
		{`SELECT CAST(COALESCE(SUM(-delta), 0) AS BIGINT) FROM point_ledger WHERE reason = 'spend' AND created_at >= ?`, []any{todayStart}, &out.TodayPoints},
		{`SELECT COUNT(*) FROM invites`, nil, &out.InvitesTotal},
		{`SELECT CAST(COALESCE(SUM(CASE WHEN rewarded_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS BIGINT) FROM invites`, nil, &out.InvitesRewarded},
		{`SELECT COUNT(*) FROM media_objects`, nil, &out.MediaCount},
		{`SELECT CAST(COALESCE(SUM(size), 0) AS BIGINT) FROM media_objects`, nil, &out.MediaBytes},
		{`SELECT COUNT(*) FROM studio_records WHERE store = 'assets'`, nil, &out.RecordCount},
	}
	for _, query := range queries {
		if err := d.QueryRowContext(ctx, query.query, query.args...).Scan(query.dest); err != nil {
			return out, err
		}
	}
	return out, nil
}

type DailyLedger struct {
	Delta     int64
	Reason    string
	CreatedAt int64
}

func (d *DB) LedgerSince(ctx context.Context, since int64) ([]DailyLedger, error) {
	rows, err := d.QueryContext(ctx, `SELECT delta, reason, created_at FROM point_ledger WHERE created_at >= ?`, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DailyLedger
	for rows.Next() {
		var row DailyLedger
		if err := rows.Scan(&row.Delta, &row.Reason, &row.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

type RecentUser struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	CreatedAt int64  `json:"createdAt"`
	Balance   int64  `json:"balance"`
}

func (d *DB) RecentUsers(ctx context.Context, limit int) ([]RecentUser, error) {
	rows, err := d.QueryContext(ctx, `SELECT u.id, u.email, u.created_at, COALESCE(p.balance, 0)
		FROM users u LEFT JOIN point_accounts p ON p.user_id = u.id
		WHERE u.system = 0
		ORDER BY u.created_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RecentUser
	for rows.Next() {
		var row RecentUser
		if err := rows.Scan(&row.ID, &row.Email, &row.CreatedAt, &row.Balance); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

var _ = time.Now
