-- Per-model capability tiers (JSON array). Image models list the supported
-- qualities (1K/2K/4K); video models list the supported resolutions
-- (360p/720p/1080p/4k). An empty value means every tier is supported, which
-- keeps rows created before this column existed working unchanged.

ALTER TABLE model_catalog ADD COLUMN tiers TEXT NOT NULL DEFAULT '';
