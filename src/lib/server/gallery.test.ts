import { Readable } from 'node:stream';
import type { APIContext } from 'astro';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Real SQLite queries/transactions; never initialize deployment DB or load .env.
vi.mock('./database', async () => {
  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const schema = await import('../../../db/schema');
  const operators = await import('drizzle-orm');
  const client = createClient({ url: 'file::memory:' });
  for (const sql of [
    'CREATE TABLE StudioRecord (key TEXT PRIMARY KEY, userId TEXT NOT NULL, store TEXT NOT NULL, recordId TEXT NOT NULL, data TEXT NOT NULL, updatedAt INTEGER NOT NULL)',
    'CREATE TABLE RecordChunk (id TEXT PRIMARY KEY, recordKey TEXT NOT NULL, position INTEGER NOT NULL, data TEXT NOT NULL)',
    'CREATE TABLE MediaObject (id TEXT PRIMARY KEY, objectKey TEXT NOT NULL UNIQUE, owner TEXT NOT NULL, attachmentId TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, createdAt INTEGER NOT NULL)',
    'CREATE TABLE DailyUsage (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expiresAt INTEGER NOT NULL)',
  ]) await client.execute(sql);
  return { ...schema, ...operators, db: drizzle(client) };
});
vi.mock('./auth', () => ({ currentUser: vi.fn(async () => null) }));
vi.mock('./oss', () => ({
  ossEnabled: vi.fn(() => true),
  ossInteger: vi.fn((name: string, fallback: number) => Number(process.env[name] ?? fallback)),
  ossSettings: vi.fn(() => ({ prefix: 'private', maxFileBytes: 1024 })),
  mediaMaxBytes: vi.fn(() => 1024),
  putOSS: vi.fn(), deleteOSS: vi.fn(),
  readOSS: vi.fn(async () => Readable.from([Buffer.from('hello')])),
  OSSUnavailableError: class extends Error {},
}));
import { db, StudioRecord, RecordChunk, MediaObject, DailyUsage, eq } from './database';
import { currentUser } from './auth';
import { ossEnabled, readOSS } from './oss';
import { hash } from './policy';
import { clearMediaCache } from './mediaCache';
import { claimMediaURLs, mediaIdentity } from './media';
import { GET as list, ALL as listMethod } from '../../pages/api/gallery/index';
import { GET as media, HEAD as head, ALL as mediaMethod } from '../../pages/api/gallery/media/[id]';
import { GET as privateMedia } from '../../pages/api/media/[id]';
import { ALL as records } from '../../pages/api/records/[store]';

const uuid = '00000000-0000-4000-8000-000000000001';
const uuid2 = '00000000-0000-4000-8000-000000000002';
const asset = (extra: Record<string, unknown> = {}) => ({ id: 'same-id', kind: 'image', prompt: 'A forest', status: 'completed', createdAt: 100, options: { aspect_ratio: '16:9', image_size: '1K' }, url: `/api/media/${uuid}`, ...extra });
function ctx(path = '/api/gallery', method = 'GET', headers: Record<string, string> = {}, body?: unknown): APIContext {
  const request = new Request(`https://olai.test${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const url = new URL(request.url);
  return { request, url, params: { id: url.pathname.split('/').pop(), store: 'assets' }, clientAddress: '203.0.113.9', cookies: {
    get: () => ({ value: 'a'.repeat(64) }), set: vi.fn(),
  } } as unknown as APIContext;
}
async function seed(value: any = asset(), userId = 'alice', store = 'assets', chunks = false) {
  const key = hash(`${userId}:${store}:${value.id}`), raw = JSON.stringify(value);
  await db.insert(StudioRecord).values({ key, userId, store, recordId: value.id, updatedAt: 1, data: chunks ? '' : raw });
  if (chunks) {
    const middle = Math.floor(raw.length / 2);
    // Insert in reverse order to ensure the loader orders by position.
    await db.insert(RecordChunk).values([{ id: `${key}:1`, recordKey: key, position: 1, data: raw.slice(middle) }, { id: `${key}:0`, recordKey: key, position: 0, data: raw.slice(0, middle) }]);
  }
  return key;
}
async function object(id = uuid, owner = 'user:alice', mime = 'image/png') {
  await db.insert(MediaObject).values({ id, owner, mime, size: 5, objectKey: `private/bucket/SECRET/${id}`, attachmentId: 'attachment', sha256: id, createdAt: 1 });
}
const mediaPath = (key: string, field = 'url', id = uuid) => `/api/gallery/media/${key}.${field}.${id}`;
async function payload() { const response = await list(ctx()); expect(response.status).toBe(200); return response.json(); }
beforeEach(async () => {
  clearMediaCache();
  vi.clearAllMocks();
  vi.stubEnv('SITE_ORIGIN', 'https://olai.test'); vi.stubEnv('TRUST_PROXY', 'false');
  vi.stubEnv('OSS_MEDIA_READ_RATE_LIMIT', '60'); vi.stubEnv('OSS_MEDIA_READ_DAILY_BYTES', '1048576');
  vi.stubEnv('AI_API_KEY', 'test-gallery-secret');
  vi.mocked(currentUser).mockResolvedValue(null); vi.mocked(ossEnabled).mockReturnValue(true);
  vi.mocked(readOSS).mockImplementation(async () => Readable.from([Buffer.from('hello')]));
  await db.delete(RecordChunk); await db.delete(StudioRecord); await db.delete(MediaObject); await db.delete(DailyUsage);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('public gallery list', () => {
  it('works anonymously, publishes completed assets only, never conversations/workflows', async () => {
    await seed(asset()); await object();
    await seed(asset({ id: 'music', kind: 'music' })); await seed(asset({ id: 'video', kind: 'video' }));
    for (const status of ['pending', 'failed']) await seed(asset({ id: status, status }));
    await seed(asset({ id: 'chat' }), 'alice', 'conversations');
    await seed(asset({ id: 'workflow' }), 'alice', 'workflows');
    await seed(asset({ id: 'other-kind', kind: 'speech' }));
    const result = await payload();
    expect(result.records).toHaveLength(3); expect(result.nextOffset).toBeNull();
    expect(result.records.map((r: any) => r.kind).sort()).toEqual(['image', 'music', 'video']);
    expect(currentUser).not.toHaveBeenCalled();
  });
  it('reconstructs chunked assets and supplies independent public IDs for identical IDs across accounts', async () => {
    const a = await seed(asset({ prompt: 'Alice' }), 'alice', 'assets', true);
    const b = await seed(asset({ prompt: 'Bob' }), 'bob', 'assets', true);
    const result = await payload();
    expect(result.records.map((r: any) => r.id).sort()).toEqual([`gallery_${a}`, `gallery_${b}`].sort());
    expect(result.records.map((r: any) => r.prompt).sort()).toEqual(['Alice', 'Bob']);
    vi.mocked(currentUser).mockResolvedValue({ id: 'bob', email: 'private@bob.test' });
    expect(await payload()).toEqual(result);
  });
  it('uses an explicit nested whitelist and redacts secrets in user-facing text', async () => {
    const key = await seed(asset({ prompt: 'A test-gallery-secret forest', lyrics: 'test-gallery-secret song', lrc: '[00:01] test-gallery-secret',
      accountId: 'PRIVATE_ACCOUNT', userId: 'PRIVATE_USER', remoteId: 'job_PRIVATE', error: 'PRIVATE_ERROR', coverError: 'PRIVATE_ERROR',
      sessions: [{ token: 'PRIVATE_SESSION' }], song: { title: 'A test-gallery-secret song', style: 'Dreamy', instrumental: true, sections: [{ lyrics: 'PRIVATE_SONG_SECTION' }], apiKey: 'PRIVATE_SONG_CONFIG' }, config: { secret: 'PRIVATE_CONFIG' },
      options: { aspect_ratio: '16:9', image_size: '4K', duration: 30, apiKey: 'PRIVATE_KEY', model: 'PRIVATE_MODEL', nested: { secret: 'PRIVATE' } },
    }));
    await object();
    const result = await payload(), json = JSON.stringify(result);
    expect(json).not.toMatch(/PRIVATE_|test-gallery-secret|remoteId|accountId|userId|error|sessions|config|objectKey|sha256|attachmentId/);
    expect(result.records[0]).toEqual({ id: `gallery_${key}`, kind: 'image', status: 'completed', prompt: 'A [已隐藏] forest', createdAt: 100,
      options: { aspect_ratio: '16:9', image_size: '4K', duration: 30 }, lyrics: '[已隐藏] song', lrc: '[00:01] [已隐藏]',
      song: { title: 'A [已隐藏] song', style: 'Dreamy', instrumental: true, sections: [] },
      url: mediaPath(key), thumbnail: `${mediaPath(key)}?w=800` });
  });
  it('paginates filtered records with default 30, stable ordering, no duplicates, and terminal null', async () => {
    for (let n = 0; n < 37; n++) await seed(asset({ id: `item-${n}`, status: n < 2 ? 'pending' : 'completed' }));
    const first = await payload(); expect(first.records).toHaveLength(30); expect(first.nextOffset).toBe(30);
    const next = await (await list(ctx('/api/gallery?offset=30'))).json(); expect(next.records).toHaveLength(5); expect(next.nextOffset).toBeNull();
    expect(new Set([...first.records, ...next.records].map(r => r.id)).size).toBe(35);
    const exact = await (await list(ctx('/api/gallery?offset=30&limit=5'))).json(); expect(exact.nextOffset).toBeNull();
    expect(await (await list(ctx('/api/gallery?offset=999'))).json()).toEqual({ records: [], nextOffset: null });
    const small = await (await list(ctx('/api/gallery?offset=1&limit=2'))).json();
    expect(small.records).toEqual(first.records.slice(1, 3)); expect(small.nextOffset).toBe(3);
  });
  it.each(['offset=-1', 'offset=1.5', 'offset=NaN', 'offset=9007199254740992', 'limit=0', 'limit=101', 'limit=1e2', 'limit=', 'limit=1&limit=2'])('rejects invalid/unbounded pagination %s', async query => {
    expect((await list(ctx(`/api/gallery?${query}`))).status).toBe(400);
  });
  it('skips corrupt JSON, incomplete/reordered chunk sequences and invalid asset shapes', async () => {
    const key = await seed(asset(), 'alice', 'assets', true);
    await db.delete(RecordChunk).where(eq(RecordChunk.id, `${key}:0`));
    const bad = await seed(asset({ id: 'bad' })); await db.update(StudioRecord).set({ data: '{SECRET invalid' }).where(eq(StudioRecord.key, bad));
    await seed(asset({ id: 'null', prompt: null }));
    expect(await payload()).toEqual({ records: [], nextOffset: null });
  });
  it.each([`https://evil.test/api/media/${uuid}`, `//evil.test/api/media/${uuid}`, `/api/media/${uuid}?token=SECRET`, 'data:image/png;base64,SECRET', 'blob:SECRET'])('does not publish legacy/foreign URL %s', async url => {
    await seed(asset({ url })); await object();
    expect((await payload()).records[0].url).toBeUndefined();
  });
  it('normalizes only absolute same-origin references and disallows pending covers or incorrect media ownership/types', async () => {
    await seed(asset({ url: `https://olai.test/api/media/${uuid}`, coverUrl: `/api/media/${uuid2}`, coverStatus: 'pending' }));
    await object(); await object(uuid2);
    const first = (await payload()).records[0]; expect(first.url).toBeTruthy(); expect(first.coverUrl).toBeUndefined();
    await db.update(MediaObject).set({ owner: 'user:bob' });
    expect((await payload()).records[0].url).toBeUndefined();
    await db.update(MediaObject).set({ owner: 'user:alice', mime: 'text/html' });
    expect((await payload()).records[0].url).toBeUndefined();
  });
  it('masks database failures and returns no-store same-origin headers', async () => {
    const response = await list(ctx());
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('SECRET SQL parameters'));
    const failed = await list(ctx()); expect(failed.status).toBe(503); expect(await failed.text()).not.toContain('SECRET');
  });
});

describe('public gallery read-only media capabilities', () => {
  it.each([{ kind: 'music', mime: 'audio/mpeg' }, { kind: 'video', mime: 'video/mp4' }])('publishes playable $kind outputs with the right MIME', async ({ kind, mime }) => {
    const key = await seed(asset({ kind })); await object(uuid, 'user:alice', mime);
    expect((await payload()).records[0].url).toBe(mediaPath(key));
    const response = await media(ctx(mediaPath(key)));
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toBe(mime); expect(await response.text()).toBe('hello');
  });
  it('streams published media for a guest but leaves original private media inaccessible', async () => {
    const key = await seed(); await object();
    const response = await media(ctx(mediaPath(key)));
    expect(response.status).toBe(200); expect(await response.text()).toBe('hello');
    expect(response.headers.get('content-length')).toBe('5'); expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('content-security-policy')).toContain('sandbox');
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    const denied = await privateMedia(ctx(`/api/media/${uuid}`)); expect(denied.status).toBe(404);
    expect((await db.select().from(MediaObject))[0].owner).toBe('user:alice');
  });
  it('serves grid cards a bucket-side thumbnail and keeps the original for detail', async () => {
    const key = await seed(); await object();
    expect((await payload()).records[0].thumbnail).toBe(`${mediaPath(key)}?w=800`);
    const thumb = await media(ctx(`${mediaPath(key)}?w=800`));
    expect(thumb.status).toBe(200);
    expect(readOSS).toHaveBeenCalledWith(expect.stringContaining('/SECRET/'), undefined, 'image/resize,w_800/quality,q_80');
    expect(thumb.headers.get('content-length')).toBeNull();
    expect(thumb.headers.get('accept-ranges')).toBeNull();
    vi.mocked(readOSS).mockClear();
    const full = await media(ctx(mediaPath(key)));
    expect(full.headers.get('content-length')).toBe('5');
    expect(readOSS).toHaveBeenCalledWith(expect.any(String), undefined);
  });
  it('ignores unsupported thumbnail widths and never resizes non-images', async () => {
    const key = await seed(); await object();
    for (const query of ['?w=0', '?w=99999', '?w=abc']) {
      expect((await media(ctx(mediaPath(key) + query))).headers.get('content-length')).toBe('5');
    }
    expect(readOSS).not.toHaveBeenCalledWith(expect.any(String), undefined, expect.any(String));
    const video = await seed(asset({ id: 'clip', kind: 'video', url: `/api/media/${uuid2}` })); await object(uuid2, 'user:alice', 'video/mp4');
    expect((await media(ctx(`${mediaPath(video, 'url', uuid2)}?w=800`))).status).toBe(200);
    expect(readOSS).not.toHaveBeenCalledWith(expect.any(String), undefined, expect.any(String));
  });
  it('allows only exact current url/coverUrl/lyricsUrl/lrcUrl references, not arbitrary attachments', async () => {
    const key = await seed(asset({ coverUrl: `/api/media/${uuid2}`, coverStatus: 'completed', arbitrary: `/api/media/${uuid}` }));
    await object(); await object(uuid2);
    expect((await media(ctx(mediaPath(key, 'coverUrl', uuid2)))).status).toBe(200);
    for (const path of [mediaPath(key, 'url', uuid2), mediaPath(key, 'arbitrary'), mediaPath(hash('unknown')), `/api/gallery/media/${uuid}`, mediaPath(key) + '/extra']) {
      expect((await media(ctx(path))).status).toBe(404);
    }
    await db.update(StudioRecord).set({ data: JSON.stringify(asset({ url: `/api/media/${uuid2}` })) }).where(eq(StudioRecord.key, key));
    expect((await media(ctx(mediaPath(key)))).status).toBe(404);
  });
  it.each(['lyricsUrl', 'lrcUrl'])('publishes safe %s text attachments only when referenced', async field => {
    const key = await seed(asset({ [field]: `/api/media/${uuid2}` })); await object(uuid2, 'user:alice', 'text/plain');
    const response = await head(ctx(mediaPath(key, field, uuid2), 'HEAD'));
    expect(response.status).toBe(200); expect(response.headers.get('content-disposition')).toContain('attachment;');
    expect((await payload()).records[0][field]).toBe(mediaPath(key, field, uuid2));
    await db.update(MediaObject).set({ mime: 'application/json' });
    expect((await head(ctx(mediaPath(key, field, uuid2), 'HEAD'))).status).toBe(404);
  });
  it.each(['pending', 'failed'])('revokes media when asset becomes %s', async status => {
    const key = await seed(); await object();
    await db.update(StudioRecord).set({ data: JSON.stringify(asset({ status })) }).where(eq(StudioRecord.key, key));
    expect((await media(ctx(mediaPath(key)))).status).toBe(404); expect(readOSS).not.toHaveBeenCalled();
  });
  it('revokes deleted assets and rejects non-assets, foreign-owned media and wrong MIME', async () => {
    const key = await seed(); await object(uuid, 'user:bob');
    expect((await media(ctx(mediaPath(key)))).status).toBe(404);
    await db.update(MediaObject).set({ owner: 'user:alice', mime: 'audio/mpeg' });
    expect((await media(ctx(mediaPath(key)))).status).toBe(404);
    await db.update(MediaObject).set({ mime: 'image/png' });
    await db.update(StudioRecord).set({ store: 'conversations' });
    expect((await media(ctx(mediaPath(key)))).status).toBe(404);
    await db.delete(StudioRecord);
    expect((await media(ctx(mediaPath(key)))).status).toBe(404); expect(readOSS).not.toHaveBeenCalled();
  });
  it('resolves chunked records for guests and other logged-in readers without ownership mutation', async () => {
    const key = await seed(asset(), 'alice', 'assets', true); await object();
    vi.mocked(currentUser).mockResolvedValue({ id: 'bob', email: '' });
    expect((await head(ctx(mediaPath(key), 'HEAD'))).status).toBe(200);
    expect((await db.select().from(MediaObject))[0].owner).toBe('user:alice');
    await expect(claimMediaURLs(`/api/media/${uuid}`, await mediaIdentity(ctx()))).rejects.toMatchObject({ status: 404 });
  });
  it('supports HEAD without OSS I/O and normalized range requests', async () => {
    const key = await seed(); await object();
    const response = await head(ctx(mediaPath(key), 'HEAD', { range: 'bytes=1-2' }));
    expect(response.status).toBe(200); expect(await response.text()).toBe(''); expect(response.headers.get('content-length')).toBe('5');
    expect(readOSS).not.toHaveBeenCalled();
    vi.mocked(readOSS).mockResolvedValueOnce(Readable.from([Buffer.from('el')]));
    const range = await media(ctx(mediaPath(key), 'GET', { range: 'bytes=1-2' }));
    expect(range.status).toBe(206); expect(range.headers.get('content-range')).toBe('bytes 1-2/5'); expect(await range.text()).toBe('el');
    expect(readOSS).toHaveBeenCalledWith(expect.any(String), 'bytes=1-2');
    const invalid = await media(ctx(mediaPath(key), 'GET', { range: 'bytes=99-100' }));
    expect(invalid.status).toBe(416); expect(invalid.headers.get('content-range')).toBe('bytes */5');
  });
  it.each<Record<string, string>>([{ origin: 'https://evil.test' }, { referer: 'https://evil.test/page' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }])('retains origin protection %j', async headers => {
    const key = await seed(); await object();
    expect((await media(ctx(mediaPath(key), 'GET', headers))).status).toBe(403);
    expect((await list(ctx('/api/gallery', 'GET', headers))).status).toBe(403); expect(readOSS).not.toHaveBeenCalled();
  });
  it('shares request/traffic quotas with private media and charges readers rather than publishers', async () => {
    const key = await seed(); await object(); vi.stubEnv('OSS_MEDIA_READ_DAILY_BYTES', '5');
    const first = await media(ctx(mediaPath(key))); expect(first.status).toBe(200); expect(await first.text()).toBe('hello');
    const cached = await media(ctx(mediaPath(key))); expect(cached.status).toBe(200); expect(cached.headers.get('x-olai-media-cache')).toBe('HIT'); expect(await cached.text()).toBe('hello');
    clearMediaCache();
    const limitedBytes = await media(ctx(mediaPath(key)));
    expect(limitedBytes.status).toBe(429);
    expect((await limitedBytes.json()).error.message).toContain('今日媒体浏览流量');
    expect(Number(limitedBytes.headers.get('retry-after'))).toBeGreaterThan(0);
    await db.delete(DailyUsage); vi.stubEnv('OSS_MEDIA_READ_RATE_LIMIT', '1');
    expect((await head(ctx(mediaPath(key), 'HEAD'))).status).toBe(200);
    const limited = await head(ctx(mediaPath(key), 'HEAD'));
    expect(limited.status).toBe(429); expect(await limited.text()).toBe(''); expect(limited.headers.get('retry-after')).toBe('60');
  });
  it('fails closed with OSS disabled and masks upstream errors', async () => {
    const key = await seed(); await object(); vi.mocked(ossEnabled).mockReturnValue(false);
    expect((await media(ctx(mediaPath(key)))).status).toBe(503); expect(readOSS).not.toHaveBeenCalled();
    vi.mocked(ossEnabled).mockReturnValue(true); vi.mocked(readOSS).mockRejectedValueOnce(new Error('SECRET bucket.oss.cn'));
    const failed = await media(ctx(mediaPath(key))); expect(failed.status).toBe(503); expect(await failed.text()).not.toMatch(/SECRET|oss.cn/);
  });
  it('revalidates publication before serving warm cache or browser validators', async () => {
    const key = await seed(); await object();
    const first = await media(ctx(mediaPath(key))); expect(await first.text()).toBe('hello');
    const before = await db.select().from(DailyUsage);
    vi.stubEnv('OSS_MEDIA_READ_RATE_LIMIT', '0'); vi.stubEnv('OSS_MEDIA_READ_DAILY_BYTES', '0');
    const hit = await media(ctx(mediaPath(key))); expect(hit.status).toBe(200); expect(hit.headers.get('x-olai-media-cache')).toBe('HIT'); expect(await hit.text()).toBe('hello');
    const validated = await media(ctx(mediaPath(key), 'GET', { 'if-none-match': first.headers.get('etag')! })); expect(validated.status).toBe(304);
    expect(await db.select().from(DailyUsage)).toEqual(before); expect(readOSS).toHaveBeenCalledTimes(1);
    await db.update(StudioRecord).set({ data: JSON.stringify(asset({ status: 'failed' })) }).where(eq(StudioRecord.key, key));
    expect((await media(ctx(mediaPath(key)))).status).toBe(404);
    expect((await media(ctx(mediaPath(key), 'GET', { 'if-none-match': first.headers.get('etag')! }))).status).toBe(404);
  });
  it('propagates cancellation to OSS', async () => {
    const key = await seed(); await object(); const upstream = new Readable({ read() {} });
    vi.mocked(readOSS).mockResolvedValueOnce(upstream);
    const response = await media(ctx(mediaPath(key))); await response.body!.cancel(); expect(upstream.destroyed).toBe(true);
  });
  it.each(['PUT', 'POST', 'PATCH', 'DELETE', 'OPTIONS'])('denies public mutation method %s', async method => {
    expect((await listMethod(ctx('/api/gallery', method))).status).toBe(405);
    expect((await mediaMethod(ctx('/api/gallery/media/anything', method))).status).toBe(405);
    expect(await db.select().from(StudioRecord)).toHaveLength(0);
  });
});

describe('legacy inline cloud media', () => {
  const data = (mime = 'image/png', text = 'hello') => `data:${mime};base64,${Buffer.from(text).toString('base64')}`;
  async function published(value: Record<string, unknown> = {}, chunks = false) {
    await seed(asset({ url: undefined, blobData: data(), ...value }), 'alice', 'assets', chunks);
    const result = await payload();
    expect(result.records[0].url).toMatch(/^\/api\/gallery\/media\/[a-f0-9]{64}\.url\.inline-[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toMatch(/base64|blobData|aGVsbG8=/);
    return result.records[0].url as string;
  }
  it.each([
    { kind: 'image', mime: 'image/png' }, { kind: 'music', mime: 'audio/mpeg' }, { kind: 'video', mime: 'video/mp4' },
  ])('serves chunked blobData $kind with OSS disabled and does not call OSS', async ({ kind, mime }) => {
    vi.mocked(ossEnabled).mockReturnValue(false);
    const url = await published({ kind, blobData: data(mime) }, true);
    const response = await media(ctx(url)); expect(response.status).toBe(200); expect(response.headers.get('content-type')).toBe(mime);
    expect(await response.text()).toBe('hello'); expect(readOSS).not.toHaveBeenCalled();
  });
  it('supports data URL primary and cover references, HEAD, single ranges and safe text attachments', async () => {
    const url = await published({ blobData: undefined, url: data(), coverUrl: data('image/jpeg'), coverStatus: 'completed', lyricsUrl: data('text/plain'), lrcUrl: data('text/lrc') });
    const response = await head(ctx(url, 'HEAD'));
    expect(response.status).toBe(200); expect(response.headers.get('content-length')).toBe('5'); expect(await response.text()).toBe('');
    const range = await media(ctx(url, 'GET', { range: 'bytes=-2' }));
    expect(range.status).toBe(206); expect(range.headers.get('content-range')).toBe('bytes 3-4/5'); expect(await range.text()).toBe('lo');
    const invalid = await media(ctx(url, 'GET', { range: 'bytes=99-100' })); expect(invalid.status).toBe(416);
    const result = (await payload()).records[0];
    expect((await head(ctx(result.coverUrl, 'HEAD'))).headers.get('content-type')).toBe('image/jpeg');
    const lyrics = await media(ctx(result.lyricsUrl)); expect(lyrics.headers.get('content-disposition')).toContain('attachment;'); expect(await lyrics.text()).toBe('hello');
    expect((await media(ctx(result.lrcUrl))).status).toBe(200); expect(readOSS).not.toHaveBeenCalled();
  });
  it.each([
    'data:image/svg+xml;base64,PHN2Zy8+', 'data:text/html;base64,PGh0bWwvPg==', 'data:application/json;base64,e30=',
    'data:image/png;base64,???=', 'data:image/png;base64,aGVsbG8', 'data:image/png;base64,', 'data:image/png,hello',
    'data:audio/mpeg;base64,aGVsbG8=',
  ])('refuses dangerous, wrong-kind and invalid payloads %s', async blobData => {
    await seed(asset({ url: undefined, blobData }));
    expect((await payload()).records[0].url).toBeUndefined();
  });
  it('limits inline payload size and does not expose oversized base64 in the list', async () => {
    const tooLarge = Buffer.alloc(32 * 1024 * 1024 + 1, 1).toString('base64');
    await seed(asset({ url: undefined, blobData: `data:image/png;base64,${tooLarge}` }));
    expect((await payload()).records[0].url).toBeUndefined();
  });
  it('revalidates content digest, field and completion status on every request', async () => {
    const url = await published(); const [row] = await db.select().from(StudioRecord);
    expect((await media(ctx(url.replace('.url.', '.coverUrl.')))).status).toBe(404);
    expect((await media(ctx(url.slice(0, -1) + (url.endsWith('0') ? '1' : '0')))).status).toBe(404);
    await db.update(StudioRecord).set({ data: JSON.stringify(asset({ blobData: data('image/png', 'different'), url: undefined })) }).where(eq(StudioRecord.key, row.key));
    expect((await media(ctx(url))).status).toBe(404);
    await db.update(StudioRecord).set({ data: JSON.stringify(asset({ blobData: data(), url: undefined, status: 'failed' })) }).where(eq(StudioRecord.key, row.key));
    expect((await media(ctx(url))).status).toBe(404); expect(readOSS).not.toHaveBeenCalled();
  });
  it('charges actual inline range bytes and enforces origin/request budgets without OSS', async () => {
    vi.mocked(ossEnabled).mockReturnValue(false); vi.stubEnv('OSS_MEDIA_READ_DAILY_BYTES', '2');
    const url = await published();
    const first = await media(ctx(url, 'GET', { range: 'bytes=0-1' })); expect(first.status).toBe(206); expect(await first.text()).toBe('he');
    const cached = await media(ctx(url, 'GET', { range: 'bytes=0-0' })); expect(cached.status).toBe(206); expect(await cached.text()).toBe('h');
    clearMediaCache();
    expect((await media(ctx(url, 'GET', { range: 'bytes=0-0' }))).status).toBe(429);
    expect((await media(ctx(url, 'GET', { origin: 'https://evil.test' }))).status).toBe(403);
    await db.delete(DailyUsage); vi.stubEnv('OSS_MEDIA_READ_RATE_LIMIT', '1');
    expect((await head(ctx(url, 'HEAD'))).status).toBe(200); expect((await head(ctx(url, 'HEAD'))).status).toBe(429);
  });
});

describe('private records remain private', () => {
  it('still requires login and only returns the signed-in user records', async () => {
    await seed(asset({ prompt: 'Alice' })); await seed(asset({ prompt: 'Bob' }), 'bob'); await object();
    expect((await records(ctx('/api/records/assets'))).status).toBe(401);
    vi.mocked(currentUser).mockResolvedValue({ id: 'bob', email: '' });
    expect((await records(ctx('/api/records/assets'))).status).toBe(409);
    const response = await records(ctx('/api/records/assets', 'GET', { 'x-olai-user': 'bob' }));
    expect(response.status).toBe(200); expect((await response.json()).records.map((r: any) => r.prompt)).toEqual(['Bob']);
  });
  it('cannot claim or overwrite another user media/record after seeing a public asset', async () => {
    const key = await seed(); await object();
    vi.mocked(currentUser).mockResolvedValue({ id: 'bob', email: '' });
    const original = (await db.select().from(StudioRecord))[0];
    const response = await records(ctx('/api/records/assets', 'PUT', { origin: 'https://olai.test', 'x-olai-user': 'bob' }, asset()));
    expect(response.status).toBe(503);
    expect((await db.select().from(StudioRecord)).find(row => row.key === key)).toEqual(original);
    expect((await db.select().from(MediaObject))[0].owner).toBe('user:alice');
    // A public read capability is not an import/edit/ownership capability.
    const copied = await records(ctx('/api/records/assets', 'PUT', { origin: 'https://olai.test', 'x-olai-user': 'bob' }, asset({ url: mediaPath(key) })));
    expect(copied.status).toBe(503);
    expect((await db.select().from(MediaObject))[0].owner).toBe('user:alice');
    await records(ctx(`/api/records/assets?id=${original.recordId}`, 'DELETE', { origin: 'https://olai.test', 'x-olai-user': 'bob' }));
    expect((await db.select().from(StudioRecord)).find(row => row.key === key)).toEqual(original);
  });
});
