-- Independent admin console identity. Admin accounts and sessions never reuse
-- the portal's users/sessions tables, so a portal login grants no console
-- access and an admin login grants no portal access.

CREATE TABLE admin_accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT,
  last_login_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX admin_sessions_admin_id_idx ON admin_sessions(admin_id);
CREATE INDEX admin_sessions_expires_at_idx ON admin_sessions(expires_at);
