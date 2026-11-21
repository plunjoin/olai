-- User-managed long-term memory: short facts and preferences injected into
-- future chats. Settings live in their own row so users can switch memory off
-- without deleting what they saved.

CREATE TABLE user_memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX user_memories_user_created_idx ON user_memories(user_id, created_at);

CREATE TABLE user_memory_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1,
  auto_capture INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL
);
