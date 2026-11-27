package store

import (
	"context"
)

// AccountGalleryStats is the public engagement snapshot of one account. Every
// number here counts only works the gallery would actually list: public,
// completed and not taken down.
type AccountGalleryStats struct {
	// Works is the number of public completed works the owner has.
	Works int64
	// Images, Videos and Music split that total by the work kind.
	Images int64
	Videos int64
	Music  int64
	// Plays is the number of times the owner's public works were opened.
	Plays int64
	// Likes is the number of favorites the owner's public works received.
	Likes int64
}

// AccountGalleryStats aggregates one account's public engagement. It reads
// the title/kind/status projection columns, so no record body is materialized
// and the counters stay cheap even for accounts with many works.
//
// The counted rows match what the gallery lists: public visibility, a
// completed status and no takedown. A work whose status was never projected
// reads "unknown" and is therefore not counted until the startup backfill
// fills it in.
func (d *DB) AccountGalleryStats(ctx context.Context, userID string) (AccountGalleryStats, error) {
	var stats AccountGalleryStats
	rows, err := d.QueryContext(ctx, `SELECT r.kind, COUNT(*)
		FROM studio_records r
		WHERE r.user_id = ? AND r.store = 'assets' AND r.visibility = 'public' AND r.status = 'completed'
			AND NOT EXISTS (SELECT 1 FROM gallery_hidden h WHERE h.record_key = r.key)
		GROUP BY r.kind`, userID)
	if err != nil {
		return stats, err
	}
	for rows.Next() {
		var kind string
		var count int64
		if err := rows.Scan(&kind, &count); err != nil {
			rows.Close()
			return stats, err
		}
		stats.Works += count
		switch kind {
		case "image":
			stats.Images = count
		case "video":
			stats.Videos = count
		case "music":
			stats.Music = count
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return stats, err
	}
	rows.Close()

	// The CAST keeps the result a BIGINT on Postgres, where SUM over an
	// integer column returns numeric.
	if err := d.QueryRowContext(ctx, `SELECT CAST(COALESCE(SUM(m.views), 0) AS BIGINT)
		FROM gallery_metrics m
		JOIN studio_records r ON r.key = m.record_key
		WHERE r.user_id = ? AND r.store = 'assets' AND r.visibility = 'public' AND r.status = 'completed'
			AND NOT EXISTS (SELECT 1 FROM gallery_hidden h WHERE h.record_key = r.key)`,
		userID).Scan(&stats.Plays); err != nil {
		return stats, err
	}

	if err := d.QueryRowContext(ctx, `SELECT CAST(COALESCE(COUNT(*), 0) AS BIGINT)
		FROM gallery_favorites f
		JOIN studio_records r ON r.key = f.record_key
		WHERE r.user_id = ? AND r.store = 'assets' AND r.visibility = 'public' AND r.status = 'completed'
			AND NOT EXISTS (SELECT 1 FROM gallery_hidden h WHERE h.record_key = r.key)`,
		userID).Scan(&stats.Likes); err != nil {
		return stats, err
	}
	return stats, nil
}

// PublicFavoriteCount counts the favorites an account shows on its profile.
// Private works are excluded so the number never reveals how much of the
// list the owner keeps to themselves.
func (d *DB) PublicFavoriteCount(ctx context.Context, userID string) (int64, error) {
	return d.galleryFavoriteTotalIn(ctx, userID, "", true)
}
