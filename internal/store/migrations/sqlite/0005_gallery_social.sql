-- Account-backed gallery favorites, engagement metrics, reports and takedowns.

CREATE TABLE gallery_favorites (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  record_key TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, record_key)
);
CREATE INDEX gallery_favorites_user_created_idx ON gallery_favorites(user_id, created_at);

CREATE TABLE gallery_metrics (
  record_key TEXT PRIMARY KEY,
  views BIGINT NOT NULL DEFAULT 0,
  downloads BIGINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL
);

CREATE TABLE gallery_hidden (
  record_key TEXT PRIMARY KEY,
  reason TEXT NOT NULL DEFAULT '',
  hidden_by TEXT NOT NULL DEFAULT '',
  hidden_at BIGINT NOT NULL
);

CREATE TABLE gallery_reports (
  id TEXT PRIMARY KEY,
  record_key TEXT NOT NULL,
  reporter_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reporter_fingerprint TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at BIGINT NOT NULL,
  handled_at BIGINT,
  handled_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX gallery_reports_status_created_idx ON gallery_reports(status, created_at);
CREATE INDEX gallery_reports_record_idx ON gallery_reports(record_key);
