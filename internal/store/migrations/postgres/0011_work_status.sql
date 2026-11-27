-- Work status projection. The record body stays authoritative; this column
-- mirrors its "status" field so the portal can count public works without
-- materializing large inline-media bodies.
--
-- Rows written before this column existed read 'unknown'. The startup
-- backfill fills them in from the body, the same way title and kind were
-- filled in. An unknown status is treated as "not a published work" until it
-- is backfilled, so a stale row can never inflate a public count.

ALTER TABLE studio_records ADD COLUMN status TEXT NOT NULL DEFAULT 'unknown';
CREATE INDEX studio_records_owner_status_idx ON studio_records(user_id, store, visibility, status);
