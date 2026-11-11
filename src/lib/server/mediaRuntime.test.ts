import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

// Exercise the real additive initializer against SQLite while replacing env-file
// loading and database construction. Never touch deployment files or credentials.
vi.mock('node:process', async importOriginal => ({
  ...await importOriginal<typeof import('node:process')>(), loadEnvFile: vi.fn(),
}));
vi.mock('@libsql/client', async importOriginal => {
  const original = await importOriginal<typeof import('@libsql/client')>();
  return { ...original, createClient: vi.fn(() => original.createClient({ url: 'file::memory:' })) };
});
import { initializeDatabase } from '../../../db/runtime.mjs';
import { createClient } from '@libsql/client';
import { loadEnvFile } from 'node:process';
import type { Client } from '@libsql/client';
let client: Client | undefined;
afterEach(() => vi.unstubAllEnvs());
afterAll(() => client?.close());

describe('media additive runtime schema', () => {
  it('initializes the MediaObject schema without reading real .env files', async () => {
    vi.stubEnv('DATABASE_URL', 'libsql://mock.invalid');
    vi.stubEnv('DATABASE_AUTH_TOKEN', 'FAKE_TEST_TOKEN_NOT_REAL');
    client = await initializeDatabase();
    expect(vi.isMockFunction(loadEnvFile)).toBe(true);
    expect(vi.isMockFunction(createClient)).toBe(true);
    const tables = await client.execute("SELECT name FROM sqlite_master WHERE type='table'");
    expect(tables.rows.map(row => row.name)).toContain('MediaObject');
    const columns = await client.execute('PRAGMA table_info(MediaObject)');
    expect(columns.rows.map(row => row.name)).toEqual(['id', 'objectKey', 'owner', 'attachmentId', 'mime', 'size', 'sha256', 'createdAt']);
    await client.execute({ sql: 'INSERT INTO MediaObject VALUES (?, ?, ?, ?, ?, ?, ?, ?)', args: ['one', 'private-key-one', 'guest:hash', 'attachment', 'image/png', 5, 'sha', 0] });
    await expect(client.execute({ sql: 'INSERT INTO MediaObject VALUES (?, ?, ?, ?, ?, ?, ?, ?)', args: ['two', 'private-key-two', 'guest:hash', 'attachment', 'image/png', 5, 'sha', 0] })).rejects.toThrow();
    // MIME is part of the deduplication identity.
    await client.execute({ sql: 'INSERT INTO MediaObject VALUES (?, ?, ?, ?, ?, ?, ?, ?)', args: ['three', 'private-key-three', 'guest:hash', 'attachment', 'audio/mpeg', 5, 'sha', 0] });
    const indexes = await client.execute('PRAGMA index_list(MediaObject)');
    expect(indexes.rows.some(row => row.name === 'MediaObject_identity_idx' && row.unique === 1)).toBe(true);
  });
});
