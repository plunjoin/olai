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
];

export async function initializeDatabase(options = {}) {
  const { url, authToken, local } = configureDatabase(options);
  const client = createClient({ url, authToken });
  try {
    if (local) {
      await client.execute('PRAGMA busy_timeout = 10000');
      await client.execute('PRAGMA journal_mode = WAL');
    }
    await client.execute('PRAGMA foreign_keys = ON');
    await client.batch(schema, 'write');
    return client;
  } catch (error) {
    client.close();
    throw error;
  }
}
