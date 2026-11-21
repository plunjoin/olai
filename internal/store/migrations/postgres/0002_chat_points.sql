-- Fractional chat prices: accumulate hundredths of a point per user and charge
-- whole points only when the running total crosses one point. The per-request
-- charge row makes refunds idempotent.

CREATE TABLE chat_point_remainders (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  hundredths BIGINT NOT NULL DEFAULT 0 CHECK (hundredths >= 0 AND hundredths < 100),
  updated_at BIGINT NOT NULL
);

CREATE TABLE chat_point_charges (
  ref_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hundredths BIGINT NOT NULL,
  whole BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  refunded_at BIGINT
);
CREATE INDEX chat_point_charges_user_idx ON chat_point_charges(user_id, created_at);
