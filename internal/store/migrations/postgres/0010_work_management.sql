-- Mirror the public work name and media kind from the record body so the admin
-- console can list and search works without reading large inline media bodies.
-- The body stays authoritative; these columns are a projection maintained on
-- every save and on the startup backfill.
ALTER TABLE studio_records ADD COLUMN title TEXT NOT NULL DEFAULT '';
ALTER TABLE studio_records ADD COLUMN kind TEXT NOT NULL DEFAULT '';
CREATE INDEX studio_records_store_kind_idx ON studio_records(store, kind);

-- System accounts (for example the official publisher used by the admin
-- console) stay out of user-management lists and totals.
ALTER TABLE users ADD COLUMN system INTEGER NOT NULL DEFAULT 0;
