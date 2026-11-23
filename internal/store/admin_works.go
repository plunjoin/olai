package store

import (
	"context"
	"strings"
)

// AdminWorkRow is one asset record as the admin works console lists it. Body
// fields are represented by the title/kind projection so large inline media is
// never materialized just to draw the table.
type AdminWorkRow struct {
	Key        string
	UserID     string
	Email      string
	RecordID   string
	Title      string
	Kind       string
	Visibility string
	CreatedAt  int64
	UpdatedAt  int64
	Hidden     bool
	// System marks works published by the console's official account.
	System bool
}

// AdminWorks returns a newest-first page of works with a searchable title,
// kind, visibility and takedown state. Filters outside their allowed values
// are ignored rather than erroring, matching the other admin list handlers.
// likePattern builds a contains pattern for AdminWorks. Wildcard characters in
// the admin's query are escaped so a search for "%" is a literal search, and
// the lowercased pattern matches the LOWER() comparison on both dialects.
func likePattern(query string) string {
	escaped := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(strings.ToLower(query))
	return "%" + escaped + "%"
}

func (d *DB) AdminWorks(ctx context.Context, query, kind, visibility, hidden string, limit, offset int) ([]AdminWorkRow, int64, error) {
	conditions := []string{`r.store = 'assets'`}
	args := []any{}
	if query != "" {
		like := likePattern(query)
		conditions = append(conditions, `(LOWER(r.title) LIKE ? ESCAPE '\' OR LOWER(r.record_id) LIKE ? ESCAPE '\'
			OR LOWER(u.email) LIKE ? ESCAPE '\' OR LOWER(u.id) = ?)`)
		args = append(args, like, like, like, strings.ToLower(query))
	}
	switch kind {
	case "image", "video", "music":
		conditions = append(conditions, `r.kind = ?`)
		args = append(args, kind)
	}
	switch visibility {
	case "public", "private":
		conditions = append(conditions, `r.visibility = ?`)
		args = append(args, visibility)
	}
	switch hidden {
	case "hidden":
		conditions = append(conditions, `EXISTS (SELECT 1 FROM gallery_hidden h WHERE h.record_key = r.key)`)
	case "visible":
		conditions = append(conditions, `NOT EXISTS (SELECT 1 FROM gallery_hidden h WHERE h.record_key = r.key)`)
	}
	where := " WHERE " + strings.Join(conditions, " AND ")
	var total int64
	if err := d.QueryRowContext(ctx, `SELECT COUNT(*)
		FROM studio_records r LEFT JOIN users u ON u.id = r.user_id`+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	pageArgs := append(append([]any{}, args...), limit, offset)
	rows, err := d.QueryContext(ctx, `SELECT r.key, r.user_id, COALESCE(u.email, ''), r.record_id,
			r.title, r.kind, r.visibility, r.created_at, r.updated_at,
			CAST(CASE WHEN EXISTS (SELECT 1 FROM gallery_hidden h WHERE h.record_key = r.key) THEN 1 ELSE 0 END AS BIGINT),
			COALESCE(u.system, 0)
		FROM studio_records r LEFT JOIN users u ON u.id = r.user_id`+where+`
		ORDER BY r.created_at DESC, r.key DESC LIMIT ? OFFSET ?`, pageArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []AdminWorkRow
	for rows.Next() {
		var row AdminWorkRow
		var hiddenFlag, systemFlag int64
		if err := rows.Scan(&row.Key, &row.UserID, &row.Email, &row.RecordID, &row.Title, &row.Kind,
			&row.Visibility, &row.CreatedAt, &row.UpdatedAt, &hiddenFlag, &systemFlag); err != nil {
			return nil, 0, err
		}
		row.Hidden = hiddenFlag != 0
		row.System = systemFlag != 0
		out = append(out, row)
	}
	return out, total, rows.Err()
}
