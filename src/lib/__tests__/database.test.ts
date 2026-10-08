import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { configureDatabase } from '../../../db/runtime.mjs';

vi.mock('node:process', () => ({ loadEnvFile: vi.fn() }));
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
  vi.unstubAllEnvs();
});
function runDatabase(source: string) {
  // Windows keeps native SQLite handles alive in a test worker. Let a child
  // exit before deleting the fixture, just as the production verifier does.
  const runtime = new URL('../../../db/runtime.mjs', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import assert from 'node:assert/strict'; import { createClient } from '@libsql/client'; import { initializeDatabase } from ${JSON.stringify(runtime)}; ${source}`],
  { env: process.env, windowsHide: true, encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
}
async function temporaryDatabase() {
  const directory = await mkdtemp(join(tmpdir(), 'olai-database-unit-'));
  directories.push(directory);
  vi.stubEnv('DATABASE_URL', pathToFileURL(join(directory, 'nested', 'olai.db')).href);
  vi.stubEnv('DATABASE_AUTH_TOKEN', '');
  return directory;
}

describe('runtime database', () => {
  it('creates all tables automatically and preserves data across initialization', async () => {
    await temporaryDatabase();
    runDatabase(`
      const client = await initializeDatabase();
      await client.batch([
        "INSERT INTO User VALUES ('existing', 'existing@example.com', 'hash', 1)",
        "INSERT INTO LoginSession VALUES ('session', 'existing', 2)",
        "INSERT INTO StudioRecord VALUES ('record', 'existing', 'assets', 'asset', '', 1)",
        "INSERT INTO RecordChunk VALUES ('chunk', 'record', 0, 'media')",
        "INSERT INTO DailyUsage VALUES ('usage', 1, 2)",
        "INSERT INTO VideoJob VALUES ('video', 'existing', 1)",
      ], 'write');
      client.close();
      const restarted = await initializeDatabase();
      assert.equal((await restarted.execute('SELECT email FROM User')).rows[0].email, 'existing@example.com');
      assert.equal((await restarted.execute('SELECT tokenHash FROM LoginSession')).rows[0].tokenHash, 'session');
      assert.equal((await restarted.execute('SELECT data FROM RecordChunk')).rows[0].data, 'media');
      assert.equal((await restarted.execute('SELECT count FROM DailyUsage')).rows[0].count, 1);
      assert.equal((await restarted.execute('SELECT id FROM VideoJob')).rows[0].id, 'video');
      restarted.close();
    `);
  });
  it('opens an existing Astro DB schema without changing its accounts or records', async () => {
    const directory = await temporaryDatabase();
    const url = pathToFileURL(join(directory, 'legacy.db')).href;
    vi.stubEnv('DATABASE_URL', url);
    runDatabase(`
    const old = createClient({ url: process.env.DATABASE_URL });
    await old.batch(${JSON.stringify([
      'CREATE TABLE "_astro_db_snapshot" (id INTEGER PRIMARY KEY AUTOINCREMENT, version TEXT, snapshot BLOB)',
      'CREATE TABLE "User" ("id" text PRIMARY KEY, "email" text NOT NULL UNIQUE, "passwordHash" text NOT NULL, "createdAt" integer NOT NULL)',
      'CREATE TABLE "StudioRecord" ("key" text PRIMARY KEY, "userId" text NOT NULL REFERENCES "User" ("id"), "store" text NOT NULL, "recordId" text NOT NULL, "data" text NOT NULL, "updatedAt" integer NOT NULL)',
      'INSERT INTO "User" VALUES (\'legacy\', \'legacy@example.com\', \'password-hash\', 1)',
      'INSERT INTO "StudioRecord" VALUES (\'legacy-record\', \'legacy\', \'assets\', \'asset\', \'{"prompt":"saved"}\', 2)',
    ])}, 'write');
    old.close();
    const current = await initializeDatabase();
    assert.equal((await current.execute('SELECT passwordHash FROM User')).rows[0].passwordHash, 'password-hash');
    assert.equal((await current.execute('SELECT data FROM StudioRecord')).rows[0].data, '{"prompt":"saved"}');
    assert.equal((await current.execute("SELECT name FROM sqlite_master WHERE name = '_astro_db_snapshot'")).rows.length, 1);
    current.close();
    `);
  });
  it('accepts the original plain path and ignores local tokens', async () => {
    const directory = await temporaryDatabase();
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('ASTRO_DB_REMOTE_URL', join(directory, 'legacy-path.db'));
    vi.stubEnv('ASTRO_DB_APP_TOKEN', 'unused-local-token');
    expect(configureDatabase().authToken).toBeUndefined();
    expect(configureDatabase().url).toBe(pathToFileURL(join(directory, 'legacy-path.db')).href);
    runDatabase(`const client = await initializeDatabase(); assert.equal((await client.execute('SELECT COUNT(*) FROM "User"')).rows[0][0], 0); client.close();`);
  });
  it('reads remote configuration at runtime and rejects unsupported protocols', () => {
    vi.stubEnv('DATABASE_URL', 'libsql://new.example');
    vi.stubEnv('DATABASE_AUTH_TOKEN', 'new-token');
    vi.stubEnv('ASTRO_DB_REMOTE_URL', 'libsql://old.example');
    vi.stubEnv('ASTRO_DB_APP_TOKEN', 'old-token');
    expect(configureDatabase()).toEqual({ url: 'libsql://new.example', authToken: 'new-token', local: false });
    vi.stubEnv('DATABASE_URL', 'ftp://invalid.example');
    expect(() => configureDatabase()).toThrow(/协议/);
  });
});
