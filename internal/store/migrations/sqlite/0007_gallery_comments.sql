-- Public comments on gallery works. Authors are portal accounts; the display
-- name and preset avatar are resolved at read time and never expose the email.

CREATE TABLE gallery_comments (
  id TEXT PRIMARY KEY,
  record_key TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX gallery_comments_record_created_idx ON gallery_comments(record_key, created_at DESC);
