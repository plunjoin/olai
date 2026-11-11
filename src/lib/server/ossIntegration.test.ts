import { Readable } from 'node:stream';
import type { APIContext } from 'astro';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Real transactions without production env/database or any external network.
vi.mock('./database', async () => {
  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const schema = await import('../../../db/schema'); const operators = await import('drizzle-orm');
  const client = createClient({ url: 'file::memory:' });
  await client.batch([
    'CREATE TABLE StudioRecord (key TEXT PRIMARY KEY, userId TEXT, store TEXT, recordId TEXT, data TEXT, updatedAt INTEGER)',
    'CREATE TABLE RecordChunk (id TEXT PRIMARY KEY, recordKey TEXT, position INTEGER, data TEXT)',
    'CREATE TABLE MediaObject (id TEXT PRIMARY KEY, objectKey TEXT UNIQUE, owner TEXT, attachmentId TEXT, mime TEXT, size INTEGER, sha256 TEXT, createdAt INTEGER)',
    'CREATE UNIQUE INDEX MediaObject_identity_idx ON MediaObject(owner,attachmentId,sha256,mime)',
    'CREATE TABLE DailyUsage (key TEXT PRIMARY KEY, count INTEGER, expiresAt INTEGER)',
    'CREATE TABLE LoginSession (tokenHash TEXT PRIMARY KEY, userId TEXT, expiresAt INTEGER)',
    'CREATE TABLE VideoJob (id TEXT PRIMARY KEY, owner TEXT, createdAt INTEGER)',
  ], 'write');
  return { ...schema, ...operators, db: drizzle(client) };
});
vi.mock('./auth', () => ({ currentUser: vi.fn(async () => null) }));
vi.mock('./oss', () => ({
  ossEnabled: vi.fn(() => true), ossSettings: () => ({ prefix: 'opt/olai', maxFileBytes: 1024 * 1024 }),
  mediaMaxBytes: () => 1024 * 1024, ossInteger: (_name: string, fallback: number) => fallback,
  putOSS: vi.fn(async () => {}), deleteOSS: vi.fn(async () => {}), readOSS: async () => Readable.from([Buffer.from([1, 2, 3])]),
  OSSUnavailableError: class extends Error {},
}));
vi.mock('./mediaImport', async importOriginal => ({ ...await importOriginal<typeof import('./mediaImport')>(), importRemoteMedia: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' })) }));
import { currentUser } from './auth';
import { db, DailyUsage, MediaObject, StudioRecord, RecordChunk, VideoJob, eq } from './database';
import { putOSS } from './oss';
import { importRemoteMedia } from './mediaImport';
import { mediaIdentity, storeMedia } from './media';
import { persistGeneratedJSON } from './generatedMedia';
import { ALL } from '../../pages/api/records/[store]';
import { POST as importPOST } from '../../pages/api/media/import';
import { ALL as generateAPI } from '../../pages/api/[...path]';
import { encodeTaskId } from './aiConfig';
function context(method = 'GET', body?: unknown, store = 'assets', query = '', user = 'owner') {
  const url = new URL(`https://olai.test/api/records/${store}${query}`);
  return { url, params: { store }, clientAddress: '203.0.113.7', request: new Request(url, { method, headers: { Origin: url.origin, 'X-Olai-User': user, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }),
    cookies: { get: () => ({ value: 'a'.repeat(64) }), set: vi.fn() } } as unknown as APIContext;
}
const record = (extra: Record<string, unknown> = {}) => ({ id: 'asset', kind: 'image', prompt: 'a forest', status: 'completed', createdAt: 1, options: {}, ...extra });
beforeEach(async () => {
  vi.clearAllMocks(); vi.stubEnv('SITE_ORIGIN', 'https://olai.test'); vi.stubEnv('TRUST_PROXY', 'false'); vi.stubEnv('AI_SHORT_FILM', 'true');
  vi.mocked(currentUser).mockResolvedValue({ id: 'owner', email: 'owner@test' });
  vi.mocked(putOSS).mockResolvedValue(undefined);
  for (const table of [MediaObject, StudioRecord, RecordChunk, DailyUsage, VideoJob]) await db.delete(table);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('OSS generation, record persistence and migration', () => {
  it('uploads JSON and binary generation responses before returning protected URLs', async () => {
    vi.stubEnv('AI_API_BASE_URL', 'https://provider.test/v1'); vi.stubEnv('AI_API_KEY', 'test-only-provider-key'); vi.stubEnv('AI_IMAGE_API_MODE', 'auto');
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ data: [{ b64_json: 'AQID', mime_type: 'image/png', revised_prompt: 'private preset' }] })).mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } }));
    vi.stubGlobal('fetch', fetch);
    for (let i = 0; i < 2; i++) {
      const ctx = context('POST', { prompt: 'a forest' }); ctx.params = { path: 'generate/image' };
      const response = await generateAPI(ctx); expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: [{ url: expect.stringMatching(/^\/api\/media\/[a-f0-9-]{36}$/), mime_type: 'image/png' }] });
    }
    expect(await db.select().from(MediaObject)).toHaveLength(2);
  });
  it('stores asynchronous video content and returns a reusable same-origin handle header', async () => {
    vi.stubEnv('AI_API_BASE_URL', 'https://provider.test/v1'); vi.stubEnv('AI_API_KEY', 'test-only-provider-key');
    const id = encodeTaskId('provider-private-id');
    await db.insert(VideoJob).values({ id, owner: 'user:owner', createdAt: Date.now() });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'video/mp4' } })));
    const ctx = context(); ctx.params = { path: `videos/${id}/content` };
    const response = await generateAPI(ctx); expect(response.status).toBe(200);
    expect(response.headers.get('X-Olai-Media-Url')).toMatch(/^\/api\/media\/[a-f0-9-]{36}$/);
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([1, 2, 3]);
    expect((await db.select().from(MediaObject))[0]).toMatchObject({ mime: 'video/mp4', size: 3, owner: 'user:owner' });
  });
  it('persists generated Base64 and returns only a same-origin handle backed by DB', async () => {
    const result = await persistGeneratedJSON({ data: [{ b64_json: 'AQID', mime_type: 'image/png' }] }, 'image', await mediaIdentity(context()));
    expect(result.data[0]).toEqual({ url: expect.stringMatching(/^\/api\/media\/[a-f0-9-]{36}$/), mime_type: 'image/png' });
    expect(await db.select().from(MediaObject)).toMatchObject([{ owner: 'user:owner', mime: 'image/png', size: 3 }]);
    expect(JSON.stringify(result)).not.toMatch(/oss|objectKey|base64|AQID/);
  });
  it('claims guest media during login import and persists only the protected link', async () => {
    vi.mocked(currentUser).mockResolvedValue(null);
    const guest = await mediaIdentity(context('GET', undefined, 'assets', '', 'guest'));
    const media = await storeMedia(new Uint8Array([1, 2, 3]), 'image/png', 'asset-media', guest);
    vi.mocked(currentUser).mockResolvedValue({ id: 'owner', email: '' });
    expect((await ALL(context('PUT', record({ url: media.url }), 'assets', '?import=guest'))).status).toBe(200);
    const [saved] = await db.select().from(StudioRecord); expect(JSON.parse(saved.data)).toEqual(record({ url: media.url }));
    expect((await db.select().from(MediaObject))[0].owner).toBe('user:owner');
    expect((await (await ALL(context())).json()).records).toEqual([record({ url: media.url })]);
  });
  it('migrates inline and chunked old media without overwriting duplicate imports', async () => {
    const old = record({ blobData: 'data:image/png;base64,AQID' });
    await db.insert(StudioRecord).values({ key: 'old', userId: 'owner', store: 'assets', recordId: 'asset', data: '', updatedAt: 1 });
    await db.insert(RecordChunk).values({ id: 'old:0', recordKey: 'old', position: 0, data: JSON.stringify(old) });
    const response = await ALL(context('POST')); expect(response.status).toBe(200); expect(await response.json()).toEqual({ migrated: 1, migratedIds: ['asset'], failures: [] });
    const [saved] = await db.select().from(StudioRecord); const value = JSON.parse(saved.data);
    expect(value.url).toMatch(/^\/api\/media\//); expect(value.blobData).toBeUndefined(); expect(await db.select().from(RecordChunk)).toEqual([]);
    expect(await (await ALL(context('POST'))).json()).toEqual({ migrated: 0, migratedIds: [], failures: [] }); expect(putOSS).toHaveBeenCalledTimes(1);
  });
  it('leaves original database content intact when an OSS upload fails', async () => {
    const old = record({ blobData: 'data:image/png;base64,AQID' });
    await db.insert(StudioRecord).values({ key: 'old', userId: 'owner', store: 'assets', recordId: 'asset', data: JSON.stringify(old), updatedAt: 1 });
    vi.mocked(putOSS).mockRejectedValue(new Error('private OSS endpoint and key'));
    const response = await ALL(context('POST')); const body = await response.json(); expect(body.failures).toHaveLength(1);
    expect(JSON.parse((await db.select().from(StudioRecord))[0].data)).toEqual(old); expect(await db.select().from(MediaObject)).toEqual([]);
    expect(JSON.stringify(body)).not.toContain('private OSS');
  });
  it('rejects foreign-owned media before creating a record', async () => {
    const media = await storeMedia(new Uint8Array([1, 2, 3]), 'image/png', 'asset-media', await mediaIdentity(context()));
    vi.mocked(currentUser).mockResolvedValue({ id: 'other', email: '' });
    expect((await ALL(context('PUT', record({ url: media.url }), 'assets', '', 'other'))).status).toBe(503);
    expect(await db.select().from(StudioRecord)).toEqual([]);
    expect((await db.select().from(MediaObject))[0].owner).toBe('user:owner');
  });
  it('imports a foreign same-path URL as remote content rather than assigning a local handle', async () => {
    const foreign = 'https://cdn.example.com/api/media/11111111-1111-4111-8111-111111111111';
    expect((await ALL(context('PUT', record({ url: foreign })))).status).toBe(200);
    expect(importRemoteMedia).toHaveBeenCalledWith(foreign);
    const saved = JSON.parse((await db.select().from(StudioRecord))[0].data);
    expect(saved.url).not.toContain('11111111-1111-4111-8111-111111111111');
  });
  it('stores versioned lyric files with the current text and proper LRC extension', async () => {
    const value = record({ kind: 'music', lyrics: '旧歌词', lrc: '[00:01]旧歌词' });
    expect((await ALL(context('PUT', value))).status).toBe(200);
    const old = JSON.parse((await db.select().from(StudioRecord))[0].data);
    expect((await ALL(context('PUT', { ...old, lrc: '[00:02]新歌词' }))).status).toBe(200);
    const updated = JSON.parse((await db.select().from(StudioRecord))[0].data);
    expect(updated.lyricsUrl).toBe(old.lyricsUrl); expect(updated.lrcUrl).not.toBe(old.lrcUrl);
    expect((await db.select().from(MediaObject)).some(row => row.objectKey.endsWith('.lrc'))).toBe(true);
  });
  it('does not overwrite a newer edit made while migration is uploading', async () => {
    const old = record({ blobData: 'data:image/png;base64,AQID' });
    await db.insert(StudioRecord).values({ key: 'old', userId: 'owner', store: 'assets', recordId: 'asset', data: JSON.stringify(old), updatedAt: 1 });
    const newer = { ...old, prompt: 'edited in another tab' };
    vi.mocked(putOSS).mockImplementationOnce(async () => {
      await db.update(StudioRecord).set({ data: JSON.stringify(newer), updatedAt: 2 }).where(eq(StudioRecord.key, 'old'));
    });
    const response = await ALL(context('POST')); expect((await response.json()).failures).toHaveLength(1);
    expect(JSON.parse((await db.select().from(StudioRecord))[0].data)).toEqual(newer);
  });
  it('hides legacy remote bucket URLs until the background migration completes', async () => {
    await db.insert(StudioRecord).values({ key: 'old', userId: 'owner', store: 'assets', recordId: 'asset', data: JSON.stringify(record({ url: 'https://bucket.oss-cn-hangzhou.aliyuncs.com/private.png' })), updatedAt: 1 });
    const response = await ALL(context()); expect(await response.text()).not.toContain('aliyuncs.com');
    expect((await db.select().from(StudioRecord))[0].data).toContain('aliyuncs.com');
  });
  it('guards import provenance and account switches before downloading remote media', async () => {
    const ctx = context('POST', { url: 'https://cdn.example.com/a.png', attachmentId: 'asset-media' });
    ctx.request.headers.set('sec-fetch-site', 'cross-site');
    expect((await importPOST(ctx)).status).toBe(403); expect(importRemoteMedia).not.toHaveBeenCalled();
  });
  it('keeps imported records idempotent and preserves existing cloud edits', async () => {
    await ALL(context('PUT', record({ prompt: 'new cloud edit' })));
    expect((await ALL(context('PUT', record({ prompt: 'old guest' }), 'assets', '?import=guest'))).status).toBe(200);
    expect(JSON.parse((await db.select().from(StudioRecord))[0].data).prompt).toBe('new cloud edit');
  });
});
