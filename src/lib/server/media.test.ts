import { Readable } from 'node:stream';
import type { APIContext } from 'astro';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// No runtime.mjs import: in-memory SQLite only, no .env loading or network.
vi.mock('./database', async () => {
  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const schema = await import('../../../db/schema');
  const operators = await import('drizzle-orm');
  const client = createClient({ url: 'file::memory:' });
  await client.execute('CREATE TABLE MediaObject (id TEXT PRIMARY KEY, objectKey TEXT NOT NULL UNIQUE, owner TEXT NOT NULL, attachmentId TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, createdAt INTEGER NOT NULL)');
  await client.execute('CREATE UNIQUE INDEX MediaObject_identity_idx ON MediaObject(owner,attachmentId,sha256,mime)');
  await client.execute('CREATE TABLE DailyUsage (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expiresAt INTEGER NOT NULL)');
  return { ...schema, ...operators, db: drizzle(client) };
});
vi.mock('./auth', () => ({ currentUser: vi.fn(async () => null) }));
vi.mock('./oss', () => ({
  ossEnabled: vi.fn(() => true),
  ossSettings: vi.fn(() => ({ prefix: 'opt/olai', maxFileBytes: 1024 })),
  ossInteger: vi.fn((name: string, fallback: number) => Number(process.env[name] ?? fallback)),
  putOSS: vi.fn(async () => {}), deleteOSS: vi.fn(async () => {}),
  readOSS: vi.fn(async () => Readable.from([Buffer.from('hello')])),
  OSSUnavailableError: class extends Error {},
}));
import { currentUser } from './auth';
import { hash } from './policy';
import { clearMediaCache } from './mediaCache';
import { db, DailyUsage, MediaObject, eq } from './database';
import { deleteOSS, ossEnabled, ossSettings, putOSS, readOSS } from './oss';
import { claimMediaURLs, mediaIdentity, mediaURLPath, reserveMediaBytes, reserveMediaUpload, storeMedia } from './media';
import { POST } from '../../pages/api/media/index';
import { GET, HEAD } from '../../pages/api/media/[id]';

const bytes = new TextEncoder().encode('hello');
const uuid = '00000000-0000-4000-8000-000000000001';
function context(options: { method?: string; id?: string; ip?: string; device?: string; headers?: Record<string, string>; body?: Uint8Array | ReadableStream<Uint8Array> } = {}) {
  const jar = new Map<string, string>();
  if (options.device) jar.set('olai_media_device', options.device);
  const headers = new Headers(options.headers);
  const method = options.method ?? 'GET';
  if (method === 'POST' && !headers.has('origin')) headers.set('origin', 'https://olai.test');
  const request = new Request(`https://olai.test/api/media/${options.id ?? ''}`, {
    method, headers, body: options.body as BodyInit | undefined, ...(options.body instanceof ReadableStream ? { duplex: 'half' } : {}),
  });
  const cookies = {
    get: vi.fn((name: string) => jar.has(name) ? { value: jar.get(name) } : undefined),
    set: vi.fn((name: string, value: string, _options: unknown) => jar.set(name, value)),
  };
  return { request, url: new URL(request.url), params: { id: options.id }, cookies, clientAddress: options.ip ?? '203.0.113.7' } as unknown as APIContext;
}
const uploadHeaders = { 'Content-Type': 'image/png', 'X-Olai-Attachment-Id': 'asset-1', 'X-Olai-User': 'guest' };
async function owner(device = 'a'.repeat(64), ip?: string) { return mediaIdentity(context({ device, ip })); }
async function rowOwner(id: string) { return (await db.select().from(MediaObject).where(eq(MediaObject.id, id)))[0]?.owner; }
beforeEach(async () => {
  clearMediaCache();
  vi.clearAllMocks();
  vi.stubEnv('SITE_ORIGIN', 'https://olai.test');
  vi.stubEnv('TRUST_PROXY', 'false');
  vi.stubEnv('OSS_MEDIA_RATE_LIMIT', '60');
  vi.stubEnv('OSS_MEDIA_DAILY_BYTES', String(1024 * 1024));
  vi.stubEnv('OSS_MEDIA_READ_RATE_LIMIT', '240');
  vi.stubEnv('OSS_MEDIA_READ_DAILY_BYTES', String(1024 * 1024));
  vi.mocked(currentUser).mockResolvedValue(null);
  vi.mocked(ossEnabled).mockReturnValue(true);
  vi.mocked(ossSettings).mockReturnValue({ prefix: 'opt/olai', maxFileBytes: 1024 });
  vi.mocked(putOSS).mockResolvedValue(undefined);
  vi.mocked(deleteOSS).mockResolvedValue(undefined);
  vi.mocked(readOSS).mockImplementation(async () => Readable.from([Buffer.from('hello')]));
  await db.delete(MediaObject); await db.delete(DailyUsage);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('media identity', () => {
  it('sets a random HttpOnly device cookie and stores only hashed IP+device owner', async () => {
    const ctx = context();
    const identity = await mediaIdentity(ctx);
    expect(identity.owner).toMatch(/^guest:[a-f0-9]{64}$/);
    expect(identity.guestOwner).toBe(identity.owner);
    expect(JSON.stringify(identity)).not.toContain('203.0.113.7');
    expect(ctx.cookies.set).toHaveBeenCalledWith('olai_media_device', expect.stringMatching(/^[a-f0-9]{64}$/), expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' }));
  });
  it('is stable for a device+IP and isolates other devices and IPs', async () => {
    const first = await owner();
    expect((await owner()).owner).toBe(first.owner);
    expect((await owner('b'.repeat(64))).owner).not.toBe(first.owner);
    expect((await owner('a'.repeat(64), '203.0.113.8')).owner).not.toBe(first.owner);
  });
  it('uses the real account id but keeps guest identity for migration', async () => {
    const guest = await owner();
    vi.mocked(currentUser).mockResolvedValue({ id: 'user-123', email: 'private@test' });
    expect(await owner()).toEqual({ owner: 'user:user-123', guestOwner: guest.owner, userId: 'user-123' });
  });
  it('rejects account switches in either direction', async () => {
    const response = await POST(context({ method: 'POST', headers: { ...uploadHeaders, 'X-Olai-User': 'old-user' }, body: bytes }));
    expect(response.status).toBe(409);
    vi.mocked(currentUser).mockResolvedValue({ id: 'user-123', email: '' });
    expect((await POST(context({ method: 'POST', headers: uploadHeaders, body: bytes }))).status).toBe(409);
  });
  it('rejects spoofed proxy addresses', async () => {
    await expect(mediaIdentity(context({ headers: { 'x-forwarded-for': '203.0.113.8' } }))).rejects.toMatchObject({ status: 400 });
  });
});

describe('private media persistence', () => {
  it('returns only an opaque local handle and builds a safe key', async () => {
    const identity = await owner();
    const result = await storeMedia(bytes, 'image/png; charset=UTF-8', 'record_1-shot-2', identity);
    expect(result).toEqual({ id: expect.any(String), url: expect.stringMatching(/^\/api\/media\/[a-f0-9-]{36}$/), mime: 'image/png', size: 5 });
    expect(putOSS).toHaveBeenCalledWith(expect.stringMatching(/^opt\/olai\/guest-[a-f0-9]{64}\/\d{8}T\d{6}Z\/[a-f0-9-]{36}-record_1-shot-2\.png$/), bytes, 'image/png');
    expect(JSON.stringify(result)).not.toMatch(/objectKey|bucket|203\.0/);
  });
  it('uses the real safe user id in keys and accepts long composite attachment ids', async () => {
    vi.mocked(currentUser).mockResolvedValue({ id: 'user-123', email: '' });
    await storeMedia(bytes, 'image/png', 'a'.repeat(250), await owner());
    expect(putOSS).toHaveBeenCalledWith(expect.stringContaining('/user-123/'), bytes, 'image/png');
    await expect(storeMedia(bytes, 'image/png', 'a'.repeat(251), await owner())).rejects.toMatchObject({ status: 400 });
  });
  it('deduplicates retries by owner+attachment+bytes+mime but not across owners', async () => {
    const identity = await owner();
    const first = await storeMedia(bytes, 'image/png', 'one', identity);
    expect(await storeMedia(bytes, 'image/png', 'one', identity)).toEqual(first);
    expect(putOSS).toHaveBeenCalledTimes(1);
    expect((await storeMedia(bytes, 'audio/mpeg', 'one', identity)).id).not.toBe(first.id);
    expect((await storeMedia(bytes, 'image/png', 'one', await owner('b'.repeat(64)))).id).not.toBe(first.id);
  });
  it('cleans up concurrent duplicate uploads without deleting the winner', async () => {
    let uploads = 0;
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(putOSS).mockImplementation(async () => { if (++uploads === 2) release(); await barrier; });
    const identity = await owner();
    const results = await Promise.all([storeMedia(bytes, 'image/png', 'same', identity), storeMedia(bytes, 'image/png', 'same', identity)]);
    expect(results[0]).toEqual(results[1]);
    expect(await db.select().from(MediaObject)).toHaveLength(1);
    const [winner] = await db.select().from(MediaObject);
    expect(deleteOSS).toHaveBeenCalledTimes(1);
    expect(deleteOSS).not.toHaveBeenCalledWith(winner.objectKey);
  });
  it('deletes newly uploaded OSS object if DB persistence fails', async () => {
    vi.spyOn(db, 'insert').mockImplementationOnce(() => { throw new Error('SECRET KEY objectKey bucket host'); });
    await expect(storeMedia(bytes, 'image/png', 'one', await owner())).rejects.toThrow('私有媒体服务暂不可用。');
    expect(deleteOSS).toHaveBeenCalledWith(vi.mocked(putOSS).mock.calls[0][0]);
  });
  it('cleans up ambiguous failed uploads without leaking SDK failures', async () => {
    vi.mocked(putOSS).mockRejectedValueOnce(new Error('https://secret.oss.cn/private-key'));
    await expect(storeMedia(bytes, 'image/png', 'one', await owner())).rejects.toThrow('私有媒体服务暂不可用。');
    expect(deleteOSS).toHaveBeenCalledTimes(1);
  });
  it.each(['image/svg+xml', 'text/html', 'application/octet-stream', 'text/xml'])('rejects dangerous/unidentified MIME %s', async mime => {
    await expect(storeMedia(bytes, mime, 'one', await owner())).rejects.toMatchObject({ status: 415 });
    expect(putOSS).not.toHaveBeenCalled();
  });
  it('rejects key traversal, empty and oversized bodies', async () => {
    const identity = await owner();
    await expect(storeMedia(bytes, 'image/png', '../escape', identity)).rejects.toMatchObject({ status: 400 });
    await expect(storeMedia(new Uint8Array(), 'image/png', 'one', identity)).rejects.toMatchObject({ status: 413 });
    await expect(storeMedia(new Uint8Array(1025), 'image/png', 'one', identity)).rejects.toMatchObject({ status: 413 });
  });
});

describe('atomic claimMediaURLs', () => {
  it('resolves handles only on this site without rewriting foreign media paths', async () => {
    const identity = await owner();
    expect(mediaURLPath(`/api/media/${uuid}?x=1`, identity)).toBe(`/api/media/${uuid}`);
    expect(mediaURLPath(`https://olai.test/api/media/${uuid}#download`, identity)).toBe(`/api/media/${uuid}`);
    expect(mediaURLPath(`https://evil.test/api/media/${uuid}`, identity)).toBeNull();
    expect(mediaURLPath(`https://olai.test.evil.test/api/media/${uuid}`, identity)).toBeNull();
    expect(mediaURLPath(`https://attacker@olai.test/api/media/${uuid}`, identity)).toBeNull();
    expect(mediaURLPath('/api/media/not-a-uuid', identity)).toBeNull();
  });
  it('claims nested same-origin relative and absolute references; subsequent claims are idempotent', async () => {
    const first = await storeMedia(bytes, 'image/png', 'one', await owner());
    const second = await storeMedia(bytes, 'image/png', 'two', await owner());
    vi.mocked(currentUser).mockResolvedValue({ id: 'user-123', email: '' });
    const identity = await owner();
    const value = { nested: [{ url: first.url }, { url: `https://olai.test${second.url}?download=1` }] };
    await claimMediaURLs(value, identity);
    await claimMediaURLs(value, identity);
    expect(await rowOwner(first.id)).toBe('user:user-123');
    expect(await rowOwner(second.id)).toBe('user:user-123');
  });
  it('does not treat foreign URLs with the same path as local media', async () => {
    await claimMediaURLs({ urls: [`https://evil.test/api/media/${uuid}`, `https://olai.test.evil.test/api/media/${uuid}`, `//evil.test/api/media/${uuid}`] }, await owner());
    expect(await db.select().from(MediaObject)).toHaveLength(0);
  });
  it('gets absolute URL origin from request even with no configured SITE_ORIGIN', async () => {
    vi.stubEnv('SITE_ORIGIN', '');
    await expect(claimMediaURLs(`https://olai.test/api/media/${uuid}`, await owner())).rejects.toMatchObject({ status: 404 });
  });
  it('validates every URL first so a later foreign-owned reference prevents any claim', async () => {
    const first = await storeMedia(bytes, 'image/png', 'one', await owner());
    const foreign = await storeMedia(bytes, 'image/png', 'two', await owner('b'.repeat(64)));
    vi.mocked(currentUser).mockResolvedValue({ id: 'user-123', email: '' });
    await expect(claimMediaURLs([foreign.url, first.url], await owner())).rejects.toMatchObject({ status: 404 });
    expect(await rowOwner(first.id)).toMatch(/^guest:/);
  });
  it('does not let a different guest/device/IP or different user claim media', async () => {
    const first = await storeMedia(bytes, 'image/png', 'one', await owner());
    await expect(claimMediaURLs(first.url, await owner('b'.repeat(64)))).rejects.toMatchObject({ status: 404 });
    vi.mocked(currentUser).mockResolvedValue({ id: 'one', email: '' });
    await expect(claimMediaURLs(first.url, await owner('b'.repeat(64)))).rejects.toMatchObject({ status: 404 });
    await claimMediaURLs(first.url, await owner());
    vi.mocked(currentUser).mockResolvedValue({ id: 'two', email: '' });
    await expect(claimMediaURLs(first.url, await owner())).rejects.toMatchObject({ status: 404 });
  });
  it('rolls all changes back on an ownership-deduplication collision', async () => {
    const guest = await storeMedia(bytes, 'image/png', 'same', await owner());
    const other = await storeMedia(bytes, 'image/png', 'different', await owner());
    vi.mocked(currentUser).mockResolvedValue({ id: 'one', email: '' });
    await storeMedia(bytes, 'image/png', 'same', await owner());
    await expect(claimMediaURLs([guest.url, other.url], await owner())).rejects.toMatchObject({ status: 503 });
    expect(await rowOwner(other.id)).toMatch(/^guest:/);
  });
});

describe('upload route', () => {
  it('accepts raw bytes, returns stable local URL and hides storage metadata', async () => {
    const response = await POST(context({ method: 'POST', headers: uploadHeaders, body: bytes }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: expect.any(String), url: expect.stringMatching(/^\/api\/media\//), mime: 'image/png', size: 5 });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it('fails closed before identity when OSS is disabled', async () => {
    vi.mocked(ossEnabled).mockReturnValue(false);
    const response = await POST({ request: new Request('https://olai.test', { method: 'POST' }) } as APIContext);
    expect(response.status).toBe(503);
    expect(currentUser).not.toHaveBeenCalled();
  });
  it('enforces actual stream size even if Content-Length lies', async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(1000)); controller.enqueue(new Uint8Array(1000)); controller.close(); } });
    const response = await POST(context({ method: 'POST', headers: { ...uploadHeaders, 'content-length': '1' }, body }));
    expect(response.status).toBe(413);
    expect(putOSS).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([
    { origin: 'https://evil.test' },
    { origin: 'null' },
    { 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-site': 'same-site' },
    { referer: 'https://evil.test/page' },
  ])('rejects cross-origin provenance %j', async extra => {
    expect((await POST(context({ method: 'POST', headers: { ...uploadHeaders, ...extra } as Record<string, string>, body: bytes }))).status).toBe(403);
  });
  it('enforces persistent per-minute rate and daily bytes quotas', async () => {
    vi.stubEnv('OSS_MEDIA_RATE_LIMIT', '1');
    const identity = await owner();
    await reserveMediaUpload(identity);
    await expect(reserveMediaUpload(identity)).rejects.toMatchObject({ status: 429 });
    vi.stubEnv('OSS_MEDIA_DAILY_BYTES', '5');
    await reserveMediaBytes(identity, 5);
    await expect(reserveMediaBytes(identity, 1)).rejects.toMatchObject({ status: 429 });
    await expect(reserveMediaBytes(identity, -1)).rejects.toMatchObject({ status: 400 });
  });
  it('does not reset IP rate budget by resetting device cookie', async () => {
    vi.stubEnv('OSS_MEDIA_RATE_LIMIT', '1');
    await reserveMediaUpload(await owner());
    await expect(reserveMediaUpload(await owner('b'.repeat(64)))).rejects.toMatchObject({ status: 429 });
  });
});

describe('GET/HEAD media proxy', () => {
  async function stored(mime = 'image/png') { return storeMedia(bytes, mime, 'one', await owner()); }
  async function readBytesUsed() {
    const identity = await owner();
    const key = hash(`media:read:${identity.owner}:bytes:${new Date().toISOString().slice(0, 10)}`);
    return (await db.select().from(DailyUsage).where(eq(DailyUsage.key, key)))[0]?.count ?? 0;
  }
  it('keeps browsing available after upload quotas are exhausted', async () => {
    vi.stubEnv('OSS_MEDIA_RATE_LIMIT', '1'); vi.stubEnv('OSS_MEDIA_DAILY_BYTES', '5');
    const identity = await owner();
    await reserveMediaUpload(identity); await reserveMediaBytes(identity, 5);
    await expect(reserveMediaUpload(identity)).rejects.toMatchObject({ status: 429 });
    const result = await stored();
    const response = await GET(context({ id: result.id, device: 'a'.repeat(64) }));
    expect(response.status).toBe(200); expect(await response.text()).toBe('hello');
    await expect(reserveMediaBytes(identity, 1)).rejects.toMatchObject({ status: 429 });
  });
  it('serves cache hits, ranges, HEAD and browser 304 without any additional request or byte usage', async () => {
    const result = await stored();
    const first = await GET(context({ id: result.id, device: 'a'.repeat(64) }));
    expect(first.headers.get('x-olai-media-cache')).toBe('MISS'); expect(await first.text()).toBe('hello');
    const before = await db.select().from(DailyUsage);
    vi.stubEnv('OSS_MEDIA_READ_RATE_LIMIT', '0'); vi.stubEnv('OSS_MEDIA_READ_DAILY_BYTES', '0');
    const hit = await GET(context({ id: result.id, device: 'a'.repeat(64) }));
    expect(hit.status).toBe(200); expect(hit.headers.get('x-olai-media-cache')).toBe('HIT'); expect(await hit.text()).toBe('hello');
    const range = await GET(context({ id: result.id, device: 'a'.repeat(64), headers: { range: 'bytes=1-2', 'if-range': first.headers.get('etag')! } }));
    expect(range.status).toBe(206); expect(await range.text()).toBe('el');
    const head = await HEAD(context({ method: 'HEAD', id: result.id, device: 'a'.repeat(64) }));
    expect(head.status).toBe(200); expect(head.headers.get('x-olai-media-cache')).toBe('HIT');
    const revalidated = await GET(context({ id: result.id, device: 'a'.repeat(64), headers: { 'if-none-match': `W/${first.headers.get('etag')}` } }));
    expect(revalidated.status).toBe(304); expect(revalidated.headers.get('x-olai-media-cache')).toBe('REVALIDATED');
    expect(await revalidated.text()).toBe(''); expect(await db.select().from(DailyUsage)).toEqual(before);
    expect(readOSS).toHaveBeenCalledTimes(1);
    expect((await GET(context({ id: result.id, device: 'b'.repeat(64), headers: { 'if-none-match': first.headers.get('etag')! } }))).status).toBe(404);
  });
  it('does not charge an unread or cancelled metadata response as a full file', async () => {
    const result = await stored('video/mp4');
    const upstream = Readable.from([Buffer.from('he'), Buffer.from('llo')]);
    vi.mocked(readOSS).mockResolvedValueOnce(upstream);
    const response = await GET(context({ id: result.id, device: 'a'.repeat(64) }));
    expect(await readBytesUsed()).toBe(0);
    const reader = response.body!.getReader();
    expect(Buffer.from((await reader.read()).value!).toString()).toBe('he');
    await reader.cancel();
    expect(upstream.destroyed).toBe(true); expect(await readBytesUsed()).toBe(2);
    vi.stubEnv('OSS_MEDIA_READ_RATE_LIMIT', '0'); vi.stubEnv('OSS_MEDIA_READ_DAILY_BYTES', '0');
    const hit = await GET(context({ id: result.id, device: 'a'.repeat(64), headers: { range: 'bytes=0-' } }));
    expect(hit.status).toBe(206); expect(hit.headers.get('content-range')).toBe('bytes 0-1/5');
    expect(hit.headers.get('x-olai-media-cache')).toBe('HIT'); expect(await hit.text()).toBe('he');
    expect(await readBytesUsed()).toBe(2); expect(readOSS).toHaveBeenCalledTimes(1);
  });
  it('enforces independent read limits and gives distinct retry guidance', async () => {
    vi.stubEnv('OSS_MEDIA_READ_RATE_LIMIT', '1');
    const result = await stored();
    expect((await HEAD(context({ method: 'HEAD', id: result.id, device: 'a'.repeat(64) }))).status).toBe(200);
    const rate = await HEAD(context({ method: 'HEAD', id: result.id, device: 'a'.repeat(64) }));
    expect(rate.status).toBe(429); expect(rate.headers.get('retry-after')).toBe('60');
    await db.delete(DailyUsage);
    vi.stubEnv('OSS_MEDIA_READ_RATE_LIMIT', '240'); vi.stubEnv('OSS_MEDIA_READ_DAILY_BYTES', '5');
    const first = await GET(context({ id: result.id, device: 'a'.repeat(64) }));
    expect(await first.text()).toBe('hello');
    const cached = await GET(context({ id: result.id, device: 'a'.repeat(64) }));
    expect(cached.headers.get('x-olai-media-cache')).toBe('HIT'); expect(await cached.text()).toBe('hello');
    expect(await readBytesUsed()).toBe(5);
    clearMediaCache();
    const bytes = await GET(context({ id: result.id, device: 'a'.repeat(64) }));
    expect(bytes.status).toBe(429); expect((await bytes.json()).error.message).toContain('今日媒体浏览流量');
    expect(Number(bytes.headers.get('retry-after'))).toBeGreaterThan(0);
  });
  it('still enforces the IP read limit across devices', async () => {
    vi.stubEnv('OSS_MEDIA_READ_RATE_LIMIT', '1');
    const result = await stored();
    expect((await HEAD(context({ method: 'HEAD', id: result.id, device: 'a'.repeat(64) }))).status).toBe(200);
    vi.mocked(currentUser).mockResolvedValue({ id: 'another-user', email: '' });
    // The public resolver verifies publication; changing reader identity cannot reset IP limits.
    const { downloadPublishedMedia } = await import('./media');
    await expect(downloadPublishedMedia(context({ device: 'b'.repeat(64) }), async () => ({ id: result.id, owner: (await rowOwner(result.id))!, accepts: () => true }))).rejects.toMatchObject({ status: 429 });
  });
  it('stops delivery before exceeding the remaining daily byte budget', async () => {
    vi.stubEnv('OSS_MEDIA_READ_DAILY_BYTES', '2');
    const result = await stored();
    vi.mocked(readOSS).mockResolvedValueOnce(Readable.from([Buffer.from('he'), Buffer.from('llo')]));
    const response = await GET(context({ id: result.id, device: 'a'.repeat(64) }));
    const reader = response.body!.getReader();
    expect(Buffer.from((await reader.read()).value!).toString()).toBe('he');
    await expect(reader.read()).rejects.toThrow('浏览流量已达上限');
    expect(await readBytesUsed()).toBe(2);
  });
  it('does not charge bytes when OSS fails before streaming', async () => {
    const result = await stored();
    vi.mocked(readOSS).mockRejectedValueOnce(new Error('private OSS error'));
    expect((await GET(context({ id: result.id, device: 'a'.repeat(64) }))).status).toBe(503);
    expect(await readBytesUsed()).toBe(0);
  });
  it('streams bytes with private security headers and no OSS headers', async () => {
    const result = await stored();
    const response = await GET(context({ id: result.id, device: 'a'.repeat(64) }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('hello');
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toContain('sandbox');
    expect(response.headers.get('cache-control')).toBe('private, no-cache');
    expect(response.headers.get('etag')).toBeTruthy();
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-oss-request-id')).toBeNull();
    expect(response.headers.get('content-length')).toBe('5');
  });
  it('supports HEAD without fetching OSS bytes, including direct downloads without referrer', async () => {
    const result = await stored();
    const response = await HEAD(context({ method: 'HEAD', id: result.id, device: 'a'.repeat(64) }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe('5');
    expect(await response.text()).toBe('');
    expect(readOSS).not.toHaveBeenCalled();
  });
  it.each(['bytes=1-2', 'bytes=-2', 'bytes=3-', 'bytes=3-999'])('supports normalized single byte range %s', async range => {
    const result = await stored('audio/mpeg');
    const expectedRange = range === 'bytes=1-2' ? 'bytes=1-2' : 'bytes=3-4';
    vi.mocked(readOSS).mockImplementation(async () => Readable.from([Buffer.from(range === 'bytes=1-2' ? 'el' : 'lo')]));
    const response = await GET(context({ id: result.id, device: 'a'.repeat(64), headers: { range } }));
    expect(response.status).toBe(206);
    expect(readOSS).toHaveBeenCalledWith(expect.any(String), expectedRange);
    expect(response.headers.get('content-range')).toBe(expectedRange.replace('=', ' ') + '/5');
    expect(await response.text()).toHaveLength(2);
  });
  it.each(['bytes=9-10', 'bytes=2-1', 'bytes=-0', 'bytes=0-1,3-4', 'kilobytes=0-1'])('rejects invalid/unsatisfiable range %s', async range => {
    const result = await stored();
    const response = await GET(context({ id: result.id, device: 'a'.repeat(64), headers: { range } }));
    expect(response.status).toBe(416);
    expect(response.headers.get('content-range')).toBe('bytes */5');
    expect(readOSS).not.toHaveBeenCalled();
  });
  it.each(['text/plain', 'text/lrc', 'application/json', 'application/x-subrip'])('forces %s to attachment', async mime => {
    const result = await stored(mime);
    const response = await HEAD(context({ method: 'HEAD', id: result.id, device: 'a'.repeat(64) }));
    expect(response.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(response.headers.get('content-type')).toBe(mime);
  });
  it('returns indistinguishable errors for missing or foreign-owned ids', async () => {
    const result = await stored();
    const foreign = await GET(context({ id: result.id, device: 'b'.repeat(64) }));
    const missing = await GET(context({ id: uuid, device: 'a'.repeat(64) }));
    expect(foreign.status).toBe(404);
    expect(await foreign.text()).toBe(await missing.text());
    expect(readOSS).not.toHaveBeenCalled();
  });
  it('rejects cross-site embedding and cross-origin referrers/origins', async () => {
    const result = await stored();
    for (const headers of [{ 'sec-fetch-site': 'cross-site' }, { referer: 'https://evil.test/page' }, { origin: 'https://evil.test' }] as Record<string, string>[]) {
      expect((await GET(context({ id: result.id, device: 'a'.repeat(64), headers }))).status).toBe(403);
    }
    expect(readOSS).not.toHaveBeenCalled();
  });
  it('masks SDK download errors and HEAD errors contain no response body', async () => {
    const result = await stored();
    vi.mocked(readOSS).mockRejectedValueOnce(new Error('https://bucket.oss.cn/private-secret'));
    const response = await GET(context({ id: result.id, device: 'a'.repeat(64) }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/bucket|oss\.cn|secret/);
    const head = await HEAD(context({ method: 'HEAD', id: uuid, device: 'a'.repeat(64) }));
    expect(head.status).toBe(404);
    expect(await head.text()).toBe('');
  });
  it('propagates browser cancellation to the upstream stream', async () => {
    const result = await stored();
    const upstream = new Readable({ read() {} });
    vi.mocked(readOSS).mockResolvedValueOnce(upstream);
    const response = await GET(context({ id: result.id, device: 'a'.repeat(64) }));
    await response.body!.cancel();
    expect(upstream.destroyed).toBe(true);
  });
});
