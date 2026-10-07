import { column, defineDb, defineTable } from 'astro:db';

const User = defineTable({ columns: {
  id: column.text({ primaryKey: true }), email: column.text({ unique: true }),
  passwordHash: column.text(), createdAt: column.number(),
} });
const LoginSession = defineTable({ columns: {
  tokenHash: column.text({ primaryKey: true }), userId: column.text({ references: () => User.columns.id }),
  expiresAt: column.number(),
} });
const StudioRecord = defineTable({ columns: {
  key: column.text({ primaryKey: true }), userId: column.text({ references: () => User.columns.id }),
  store: column.text(), recordId: column.text(), data: column.text(), updatedAt: column.number(),
}, indexes: [{ on: ['userId', 'store'] }] });
// Small rows keep audio/video data below libSQL's per-row size limit.
const RecordChunk = defineTable({ columns: {
  id: column.text({ primaryKey: true }), recordKey: column.text({ references: () => StudioRecord.columns.key }),
  position: column.number(), data: column.text(),
}, indexes: [{ on: ['recordKey', 'position'] }] });
const DailyUsage = defineTable({ columns: {
  key: column.text({ primaryKey: true }), count: column.number(), expiresAt: column.number(),
} });
const VideoJob = defineTable({ columns: {
  id: column.text({ primaryKey: true }), owner: column.text(), createdAt: column.number(),
} });

export default defineDb({ tables: { User, LoginSession, StudioRecord, RecordChunk, DailyUsage, VideoJob } });
