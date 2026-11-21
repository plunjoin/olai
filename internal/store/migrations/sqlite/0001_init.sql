-- Olai 2.0 schema (SQLite). Times are Unix milliseconds; booleans are 0/1.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email_verified_at BIGINT,
  name TEXT,
  avatar TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE oauth_accounts (
  provider TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (provider, provider_id)
);
CREATE INDEX oauth_accounts_user_id_idx ON oauth_accounts(user_id);

CREATE TABLE user_bans (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  banned_by TEXT NOT NULL,
  banned_at BIGINT NOT NULL
);

CREATE TABLE email_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX email_tokens_user_purpose_idx ON email_tokens(user_id, purpose);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  updated_by TEXT
);

CREATE TABLE admin_logs (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL,
  admin_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  detail TEXT NOT NULL,
  ip TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX admin_logs_created_at_idx ON admin_logs(created_at);

CREATE TABLE model_catalog (
  public_id TEXT PRIMARY KEY,
  upstream_id TEXT NOT NULL UNIQUE,
  display_name TEXT,
  alias TEXT NOT NULL,
  kind TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  prices TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE point_accounts (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance BIGINT NOT NULL CHECK (balance >= 0),
  updated_at BIGINT NOT NULL
);

CREATE TABLE point_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta BIGINT NOT NULL,
  reason TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL
);
CREATE INDEX point_ledger_user_created_idx ON point_ledger(user_id, created_at);
CREATE UNIQUE INDEX point_ledger_reason_ref_idx ON point_ledger(reason, ref_id);

CREATE TABLE invite_codes (
  code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL
);

CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  inviter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  rewarded_at BIGINT
);
CREATE INDEX invites_inviter_id_idx ON invites(inviter_id);

CREATE TABLE studio_records (
  key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store TEXT NOT NULL,
  record_id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX studio_records_store_user_idx ON studio_records(store, user_id);
CREATE INDEX studio_records_user_store_idx ON studio_records(user_id, store);

CREATE TABLE record_chunks (
  id TEXT PRIMARY KEY,
  record_key TEXT NOT NULL REFERENCES studio_records(key) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX record_chunks_record_idx ON record_chunks(record_key, chunk_index);

CREATE TABLE daily_usage (
  key TEXT PRIMARY KEY,
  count BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);
CREATE INDEX daily_usage_expires_idx ON daily_usage(expires_at);

CREATE TABLE video_jobs (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE media_objects (
  id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE,
  owner TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  mime TEXT NOT NULL,
  size BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX media_objects_identity_idx ON media_objects(owner, attachment_id, sha256, mime);
CREATE INDEX media_objects_owner_idx ON media_objects(owner);
CREATE INDEX media_objects_created_idx ON media_objects(created_at);
