-- Personal profiles, work visibility, follows, direct messages and favorite folders.
-- Existing completed works stay public: visibility defaults to public.

CREATE TABLE user_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  handle TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  show_works INTEGER NOT NULL DEFAULT 1,
  show_favorites INTEGER NOT NULL DEFAULT 0,
  show_bio INTEGER NOT NULL DEFAULT 1,
  show_joined INTEGER NOT NULL DEFAULT 1,
  show_follows INTEGER NOT NULL DEFAULT 1,
  allow_messages INTEGER NOT NULL DEFAULT 1,
  updated_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX user_profiles_handle_idx ON user_profiles(handle);

ALTER TABLE studio_records ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public';
CREATE INDEX studio_records_owner_visibility_idx ON studio_records(user_id, store, visibility);

CREATE TABLE user_follows (
  follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE INDEX user_follows_followee_idx ON user_follows(followee_id, created_at DESC);

CREATE TABLE user_blocks (
  blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE TABLE direct_conversations (
  id TEXT PRIMARY KEY,
  low_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  high_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE (low_user_id, high_user_id),
  CHECK (low_user_id < high_user_id)
);

CREATE TABLE direct_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES direct_conversations(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX direct_messages_conversation_idx ON direct_messages(conversation_id, created_at DESC, id DESC);

CREATE TABLE direct_reads (
  conversation_id TEXT NOT NULL REFERENCES direct_conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at BIGINT NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE favorite_folders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE (user_id, name)
);
CREATE INDEX favorite_folders_user_idx ON favorite_folders(user_id, created_at);

ALTER TABLE gallery_favorites ADD COLUMN folder_id TEXT REFERENCES favorite_folders(id) ON DELETE SET NULL;
