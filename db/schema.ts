import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';

// Keep the existing names and types so Astro DB files can be opened in place.
export const User = sqliteTable('User', {
  id: text('id').primaryKey(), email: text('email').notNull().unique(),
  passwordHash: text('passwordHash').notNull(), createdAt: integer('createdAt').notNull(),
  emailVerifiedAt: integer('emailVerifiedAt'),
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
// 第三方登录绑定：provider + providerId 唯一，一个账号可绑定多个平台。
export const OAuthAccount = sqliteTable('OAuthAccount', {
  provider: text('provider').notNull(), providerId: text('providerId').notNull(),
  userId: text('userId').notNull().references(() => User.id), createdAt: integer('createdAt').notNull(),
}, table => [primaryKey({ columns: [table.provider, table.providerId] }),
  index('OAuthAccount_userId_idx').on(table.userId)]);
export const PointAccount = sqliteTable('PointAccount', {
  userId: text('userId').primaryKey().references(() => User.id),
  balance: integer('balance').notNull(), updatedAt: integer('updatedAt').notNull(),
});
export const PointLedger = sqliteTable('PointLedger', {
  id: text('id').primaryKey(), userId: text('userId').notNull().references(() => User.id),
  delta: integer('delta').notNull(), reason: text('reason').notNull(), refId: text('refId').notNull(),
  createdAt: integer('createdAt').notNull(),
}, table => [index('PointLedger_userId_createdAt_idx').on(table.userId, table.createdAt),
  uniqueIndex('PointLedger_reason_refId_idx').on(table.reason, table.refId)]);
export const InviteCode = sqliteTable('InviteCode', {
  code: text('code').primaryKey(), userId: text('userId').notNull().unique().references(() => User.id),
  createdAt: integer('createdAt').notNull(),
});
export const Invite = sqliteTable('Invite', {
  id: text('id').primaryKey(), inviterId: text('inviterId').notNull().references(() => User.id),
  inviteeId: text('inviteeId').notNull().unique().references(() => User.id),
  code: text('code').notNull(), createdAt: integer('createdAt').notNull(), rewardedAt: integer('rewardedAt'),
}, table => [index('Invite_inviterId_idx').on(table.inviterId)]);
// 管理后台：运行时配置覆盖（.env 作为默认值）、封禁状态与操作审计。
export const AppSetting = sqliteTable('AppSetting', {
  key: text('key').primaryKey(), value: text('value').notNull(),
  updatedAt: integer('updatedAt').notNull(), updatedBy: text('updatedBy'),
});
export const UserBan = sqliteTable('UserBan', {
  userId: text('userId').primaryKey().references(() => User.id),
  reason: text('reason').notNull(), bannedBy: text('bannedBy').notNull(), bannedAt: integer('bannedAt').notNull(),
});
export const AdminLog = sqliteTable('AdminLog', {
  id: text('id').primaryKey(), adminId: text('adminId').notNull(), adminEmail: text('adminEmail').notNull(),
  action: text('action').notNull(), target: text('target').notNull(), detail: text('detail').notNull(),
  ip: text('ip').notNull(), createdAt: integer('createdAt').notNull(),
}, table => [index('AdminLog_createdAt_idx').on(table.createdAt)]);
// 模型目录：上游模型 ID 只保存在服务端，客户端只看到 publicId 与别名。
// prices 按模型类型存储档位价格（JSON 文本）。
export const ModelCatalog = sqliteTable('ModelCatalog', {
  publicId: text('publicId').primaryKey(), upstreamId: text('upstreamId').notNull().unique(),
  alias: text('alias').notNull(), kind: text('kind').notNull(), enabled: integer('enabled').notNull(),
  prices: text('prices').notNull(), sort: integer('sort').notNull(),
  createdAt: integer('createdAt').notNull(), updatedAt: integer('updatedAt').notNull(),
});
export const MediaObject = sqliteTable('MediaObject', {
  id: text('id').primaryKey(), objectKey: text('objectKey').notNull().unique(),
  owner: text('owner').notNull(), attachmentId: text('attachmentId').notNull(),
  mime: text('mime').notNull(), size: integer('size').notNull(), sha256: text('sha256').notNull(),
  createdAt: integer('createdAt').notNull(),
}, table => [uniqueIndex('MediaObject_identity_idx').on(table.owner, table.attachmentId, table.sha256, table.mime)]);

export const EmailToken = sqliteTable('EmailToken', {
  tokenHash: text('tokenHash').primaryKey(),
  userId: text('userId').notNull().references(() => User.id),
  purpose: text('purpose').notNull(),
  expiresAt: integer('expiresAt').notNull(),
  createdAt: integer('createdAt').notNull(),
}, table => [index('EmailToken_userId_purpose_idx').on(table.userId, table.purpose)]);
