import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';
import { loadEnvFile } from 'node:process';

export function configureDatabase({ development = false } = {}) {
  for (const path of ['.env.production', '.env']) {
    try { loadEnvFile(path); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const configured = process.env.DATABASE_URL?.trim() || process.env.ASTRO_DB_REMOTE_URL?.trim();
  let url = configured || (development ? 'file:./.astro/olai-dev.db' : 'file:./data/olai.db');
  // Accept plain file paths from older deployments as well as file: URLs.
  if (!/^[a-z][a-z\d+.-]*:/i.test(url) || /^[a-z]:[\\/]/i.test(url)) url = pathToFileURL(resolve(url)).href;
  else if (url.startsWith('file:') && !url.startsWith('file:/')) url = pathToFileURL(resolve(url.slice(5))).href;
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('数据库地址无效，请填写文件路径、file: 或 libsql:// 地址。'); }
  if (!['file:', 'libsql:', 'https:', 'http:'].includes(parsed.protocol)) throw new Error('数据库地址协议不受支持，请使用 file: 或 libsql:// 地址。');
  const local = parsed.protocol === 'file:';
  if (local) mkdirSync(dirname(fileURLToPath(parsed)), { recursive: true });
  return { url, authToken: local ? undefined : (process.env.DATABASE_AUTH_TOKEN ?? process.env.ASTRO_DB_APP_TOKEN), local };
}

// Additive, idempotent initialization preserves existing accounts and records.
const schema = [
  'CREATE TABLE IF NOT EXISTS "User" ("id" TEXT PRIMARY KEY, "email" TEXT NOT NULL UNIQUE, "passwordHash" TEXT NOT NULL, "createdAt" INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS "LoginSession" ("tokenHash" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User" ("id"), "expiresAt" INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS "StudioRecord" ("key" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User" ("id"), "store" TEXT NOT NULL, "recordId" TEXT NOT NULL, "data" TEXT NOT NULL, "updatedAt" INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS "StudioRecord_store_userId_idx" ON "StudioRecord" ("store", "userId")',
  'CREATE TABLE IF NOT EXISTS "RecordChunk" ("id" TEXT PRIMARY KEY, "recordKey" TEXT NOT NULL REFERENCES "StudioRecord" ("key"), "position" INTEGER NOT NULL, "data" TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS "RecordChunk_position_recordKey_idx" ON "RecordChunk" ("position", "recordKey")',
  'CREATE TABLE IF NOT EXISTS "DailyUsage" ("key" TEXT PRIMARY KEY, "count" INTEGER NOT NULL, "expiresAt" INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS "VideoJob" ("id" TEXT PRIMARY KEY, "owner" TEXT NOT NULL, "createdAt" INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS "OAuthAccount" ("provider" TEXT NOT NULL, "providerId" TEXT NOT NULL, "userId" TEXT NOT NULL REFERENCES "User" ("id"), "createdAt" INTEGER NOT NULL, PRIMARY KEY ("provider", "providerId"))',
  'CREATE INDEX IF NOT EXISTS "OAuthAccount_userId_idx" ON "OAuthAccount" ("userId")',
  'CREATE TABLE IF NOT EXISTS "PointAccount" ("userId" TEXT PRIMARY KEY REFERENCES "User" ("id"), "balance" INTEGER NOT NULL, "updatedAt" INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS "PointLedger" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User" ("id"), "delta" INTEGER NOT NULL, "reason" TEXT NOT NULL, "refId" TEXT NOT NULL, "createdAt" INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS "PointLedger_userId_createdAt_idx" ON "PointLedger" ("userId", "createdAt")',
  'CREATE UNIQUE INDEX IF NOT EXISTS "PointLedger_reason_refId_idx" ON "PointLedger" ("reason", "refId")',
  'CREATE TABLE IF NOT EXISTS "InviteCode" ("code" TEXT PRIMARY KEY, "userId" TEXT NOT NULL UNIQUE REFERENCES "User" ("id"), "createdAt" INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS "Invite" ("id" TEXT PRIMARY KEY, "inviterId" TEXT NOT NULL REFERENCES "User" ("id"), "inviteeId" TEXT NOT NULL UNIQUE REFERENCES "User" ("id"), "code" TEXT NOT NULL, "createdAt" INTEGER NOT NULL, "rewardedAt" INTEGER)',
  'CREATE INDEX IF NOT EXISTS "Invite_inviterId_idx" ON "Invite" ("inviterId")',
  'CREATE TABLE IF NOT EXISTS "AppSetting" ("key" TEXT PRIMARY KEY, "value" TEXT NOT NULL, "updatedAt" INTEGER NOT NULL, "updatedBy" TEXT)',
  'CREATE TABLE IF NOT EXISTS "UserBan" ("userId" TEXT PRIMARY KEY REFERENCES "User" ("id"), "reason" TEXT NOT NULL, "bannedBy" TEXT NOT NULL, "bannedAt" INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS "AdminLog" ("id" TEXT PRIMARY KEY, "adminId" TEXT NOT NULL, "adminEmail" TEXT NOT NULL, "action" TEXT NOT NULL, "target" TEXT NOT NULL, "detail" TEXT NOT NULL, "ip" TEXT NOT NULL, "createdAt" INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS "AdminLog_createdAt_idx" ON "AdminLog" ("createdAt")',
  'CREATE TABLE IF NOT EXISTS "ModelCatalog" ("publicId" TEXT PRIMARY KEY, "upstreamId" TEXT NOT NULL UNIQUE, "alias" TEXT NOT NULL, "kind" TEXT NOT NULL, "enabled" INTEGER NOT NULL, "prices" TEXT NOT NULL, "sort" INTEGER NOT NULL, "createdAt" INTEGER NOT NULL, "updatedAt" INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS "MediaObject" ("id" TEXT PRIMARY KEY, "objectKey" TEXT NOT NULL UNIQUE, "owner" TEXT NOT NULL, "attachmentId" TEXT NOT NULL, "mime" TEXT NOT NULL, "size" INTEGER NOT NULL, "sha256" TEXT NOT NULL, "createdAt" INTEGER NOT NULL)',
  'CREATE UNIQUE INDEX IF NOT EXISTS "MediaObject_identity_idx" ON "MediaObject" ("owner", "attachmentId", "sha256", "mime")',
  'CREATE TABLE IF NOT EXISTS "EmailToken" ("tokenHash" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User" ("id"), "purpose" TEXT NOT NULL, "expiresAt" INTEGER NOT NULL, "createdAt" INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS "EmailToken_userId_purpose_idx" ON "EmailToken" ("userId", "purpose")',
];

export async function initializeDatabase(options = {}) {
  const { url, authToken, local } = configureDatabase(options);
  const client = createClient({ url, authToken });
  try {
    if (local) {
      await client.execute('PRAGMA busy_timeout = 10000');
      await client.execute('PRAGMA journal_mode = WAL');
      // WAL keeps the database consistent without an fsync per commit. Media
      // streaming charges traffic as chunks arrive, and FULL sync turned every
      // commit into a disk wait (~24ms on a slow volume), throttling downloads.
      await client.execute('PRAGMA synchronous = NORMAL');
    }
    await client.execute('PRAGMA foreign_keys = ON');
    await client.batch(schema, 'write');
    const columns = await client.execute('PRAGMA table_info("User")');
    const names = new Set((columns.rows || []).map(row => row.name));
    if (!names.has('emailVerifiedAt')) {
      await client.execute('ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" INTEGER');
      await client.execute('UPDATE "User" SET "emailVerifiedAt" = "createdAt" WHERE "emailVerifiedAt" IS NULL');
    }
    return client;
  } catch (error) {
    client.close();
    throw error;
  }
}
