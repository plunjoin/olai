import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

// Keep the existing names and types so Astro DB files can be opened in place.
export const User = sqliteTable('User', {
  id: text('id').primaryKey(), email: text('email').notNull().unique(),
  passwordHash: text('passwordHash').notNull(), createdAt: integer('createdAt').notNull(),
});
export const LoginSession = sqliteTable('LoginSession', {
  tokenHash: text('tokenHash').primaryKey(), userId: text('userId').notNull().references(() => User.id),
  expiresAt: integer('expiresAt').notNull(),
});
export const StudioRecord = sqliteTable('StudioRecord', {
  key: text('key').primaryKey(), userId: text('userId').notNull().references(() => User.id),
  store: text('store').notNull(), recordId: text('recordId').notNull(),
  data: text('data').notNull(), updatedAt: integer('updatedAt').notNull(),
}, table => [index('StudioRecord_store_userId_idx').on(table.store, table.userId)]);
export const RecordChunk = sqliteTable('RecordChunk', {
  id: text('id').primaryKey(), recordKey: text('recordKey').notNull().references(() => StudioRecord.key),
  position: integer('position').notNull(), data: text('data').notNull(),
}, table => [index('RecordChunk_position_recordKey_idx').on(table.position, table.recordKey)]);
export const DailyUsage = sqliteTable('DailyUsage', {
  key: text('key').primaryKey(), count: integer('count').notNull(), expiresAt: integer('expiresAt').notNull(),
});
export const VideoJob = sqliteTable('VideoJob', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), createdAt: integer('createdAt').notNull(),
});
