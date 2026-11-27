-- Profile banner. The cover band above a profile avatar is either a preset
-- tone id or "upload:<uuid>" pointing at a media object owned by the account.
-- Existing profiles keep an empty banner, which the portal renders as the
-- neutral paper band.

ALTER TABLE user_profiles ADD COLUMN banner TEXT NOT NULL DEFAULT '';
