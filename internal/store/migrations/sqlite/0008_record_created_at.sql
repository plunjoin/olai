-- Store the work's creation time so the public gallery can page in true
-- creation order instead of record-key (hash) order. Rows written before this
-- migration are backfilled from the record body at startup.

ALTER TABLE studio_records ADD COLUMN created_at BIGINT NOT NULL DEFAULT 0;
CREATE INDEX studio_records_store_created_idx ON studio_records(store, created_at DESC, key DESC);
