import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { APIContext } from 'astro';
import { db, MediaObject, DailyUsage, and, eq, lt, sql } from './database';
import { currentUser } from './auth';
import { cachedMedia, captureMedia, completeMedia } from './mediaCache';
import { clientIP, env, hash, sameOrigin } from './policy';
import { deleteOSS, ossEnabled, ossInteger, ossSettings, OSSUnavailableError, putOSS, readOSS } from './oss';

export interface MediaIdentity { owner: string; guestOwner: string; userId: string | null }
const identityContext = new WeakMap<MediaIdentity, { origin: string; ipHash: string }>();
const DEVICE_COOKIE = 'olai_media_device';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ATTACHMENT = /^[a-zA-Z0-9_-]{1,250}$/;
const MIME: Record<string, { extension: string; download?: boolean }> = {
  'image/png': { extension: 'png' }, 'image/jpeg': { extension: 'jpg' },
  'image/webp': { extension: 'webp' }, 'image/gif': { extension: 'gif' },
  'image/avif': { extension: 'avif' }, 'image/bmp': { extension: 'bmp' },
  'audio/mpeg': { extension: 'mp3' }, 'audio/mp3': { extension: 'mp3' },
  'audio/mp4': { extension: 'm4a' }, 'audio/aac': { extension: 'aac' },
  'audio/wav': { extension: 'wav' }, 'audio/x-wav': { extension: 'wav' },
  'audio/ogg': { extension: 'ogg' }, 'audio/webm': { extension: 'webm' },
  'audio/flac': { extension: 'flac' }, 'audio/x-flac': { extension: 'flac' },
  'video/mp4': { extension: 'mp4' }, 'video/webm': { extension: 'webm' },
  'video/quicktime': { extension: 'mov' }, 'video/ogg': { extension: 'ogv' },
  'text/plain': { extension: 'txt', download: true },
  'text/lrc': { extension: 'lrc', download: true }, 'application/x-lrc': { extension: 'lrc', download: true },
  'application/json': { extension: 'json', download: true },
  'application/x-subrip': { extension: 'srt', download: true }, 'text/srt': { extension: 'srt', download: true },
};
export class MediaError extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfter?: number) { super(message); }
}
const unavailable = () => new MediaError(503, 'MEDIA_UNAVAILABLE', '私有媒体服务暂不可用。');
const denied = () => new MediaError(404, 'MEDIA_NOT_FOUND', '媒体不存在或无权访问。');
const quotaError = (bytes: boolean, reading: boolean) => bytes
  ? new MediaError(429, 'MEDIA_LIMIT', `今日媒体${reading ? '浏览' : '上传'}流量已达上限，请明日再试或联系管理员调整额度。`, Math.ceil((86400_000 - Date.now() % 86400_000) / 1000))
  : new MediaError(429, 'MEDIA_LIMIT', '媒体访问过于频繁，请 60 秒后重试。', 60);
export const mediaHeaders = (): Record<string, string> => ({
  'Cache-Control': 'private, no-store', 'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'",
  'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
  Vary: 'Cookie, Origin, Sec-Fetch-Site',
});
export function mediaFailure(error: unknown, head = false): Response {
  const safe = error instanceof MediaError ? error : unavailable();
  const headers = { ...mediaHeaders(), 'Content-Type': 'application/json; charset=utf-8',
    ...(safe.status === 429 ? { 'Retry-After': String(safe.retryAfter ?? 60) } : {}) };
  return new Response(head ? null : JSON.stringify({ error: { code: safe.code, message: safe.message } }), { status: safe.status, headers });
}
function requireEnabled() { if (!ossEnabled()) throw unavailable(); }
function destinationOrigin(context: APIContext): string {
  const configured = env('SITE_ORIGIN').trim();
  if (configured) return new URL(configured).origin;
  const host = context.request.headers.get('host');
  if (!host) return context.url.origin;
  const destination = new URL(`${context.url.protocol}//${host}`);
  if (host !== destination.host || destination.username || destination.password) throw unavailable();
  return destination.origin;
}
export function assertMediaOrigin(context: APIContext, upload = false): void {
  const { request } = context;
  const site = request.headers.get('sec-fetch-site');
  // same-site is not same-origin: sibling subdomains must not embed private media.
  if (site && !['same-origin', 'none'].includes(site)) throw new MediaError(403, 'MEDIA_ORIGIN', '不允许跨站调用。');
  if (upload && !sameOrigin(request)) throw new MediaError(403, 'MEDIA_ORIGIN', '不允许跨站调用。');
  const expected = destinationOrigin(context);
  for (const name of ['origin', 'referer']) {
    const value = request.headers.get(name);
    if (!value) continue; // direct downloads and privacy-preserving clients may omit Referer
    try {
      const parsed = new URL(value);
      if (parsed.origin === expected && ['http:', 'https:'].includes(parsed.protocol)
        && !parsed.username && !parsed.password && (name !== 'origin' || value === parsed.origin)) continue;
    } catch { /* Reject malformed provenance. */ }
    throw new MediaError(403, 'MEDIA_ORIGIN', '不允许跨站调用。');
  }
}
export async function mediaIdentity(context: APIContext): Promise<MediaIdentity> {
  let ip: string;
  try { ip = clientIP(context.request, context.clientAddress); }
  catch { throw new MediaError(400, 'MEDIA_IDENTITY', '无法确定媒体访问身份。'); }
  let device = context.cookies.get(DEVICE_COOKIE)?.value;
  if (!device || !/^[a-f0-9]{64}$/.test(device)) {
    device = randomBytes(32).toString('hex');
    context.cookies.set(DEVICE_COOKIE, device, { path: '/', httpOnly: true, sameSite: 'lax',
      secure: destinationOrigin(context).startsWith('https:'), maxAge: 365 * 86400 });
  }
  const user = await currentUser(context);
  const expectedUser = context.request.headers.get('x-olai-user');
  if (expectedUser !== null && expectedUser !== (user?.id ?? 'guest')) {
    throw new MediaError(409, 'MEDIA_ACCOUNT_CHANGED', '账号已切换，请刷新页面后继续。');
  }
  const guestOwner = `guest:${hash(JSON.stringify([ip, device]))}`;
  const identity = { owner: user ? `user:${user.id}` : guestOwner, guestOwner, userId: user?.id ?? null };
  identityContext.set(identity, { origin: destinationOrigin(context), ipHash: hash(ip) });
  return identity;
}
function normalizeMime(value: string): string {
  const mime = value.split(';', 1)[0].trim().toLowerCase();
  if (!Object.hasOwn(MIME, mime)) throw new MediaError(415, 'MEDIA_TYPE', '不支持此媒体类型。');
  return mime;
}
function attachment(value: string): string {
  if (!ATTACHMENT.test(value)) throw new MediaError(400, 'MEDIA_ATTACHMENT', '附件编号无效。');
  return value;
}
function publicMedia(row: { id: string; mime: string; size: number }) {
  return { id: row.id, url: `/api/media/${row.id}`, mime: row.mime, size: row.size };
}
export async function storeMedia(bytes: Uint8Array, mime: string, attachmentId: string, identity: MediaIdentity): Promise<{ id: string; url: string; mime: string; size: number }> {
  requireEnabled();
  mime = normalizeMime(mime);
  attachmentId = attachment(attachmentId);
  const { prefix, maxFileBytes } = ossSettings();
  if (!bytes.byteLength || bytes.byteLength > maxFileBytes) throw new MediaError(413, 'MEDIA_SIZE', '媒体为空或超过大小限制。');
  const userPart = identity.userId ?? identity.guestOwner.replace(/^guest:/, 'guest-');
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(userPart)
    || identity.owner !== (identity.userId ? `user:${identity.userId}` : identity.guestOwner)
    || !/^guest:[a-f0-9]{64}$/.test(identity.guestOwner)) throw new MediaError(400, 'MEDIA_IDENTITY', '无法确定媒体访问身份。');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const matches = and(eq(MediaObject.owner, identity.owner), eq(MediaObject.attachmentId, attachmentId), eq(MediaObject.sha256, sha256), eq(MediaObject.mime, mime));
  const existing = await db.select().from(MediaObject).where(matches).limit(1);
  if (existing[0]) return publicMedia(existing[0]);
  const id = randomUUID();
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const objectKey = `${prefix}/${userPart}/${stamp}/${id}-${attachmentId}.${MIME[mime].extension}`;
  const row = { id, objectKey, owner: identity.owner, attachmentId, mime, size: bytes.byteLength, sha256, createdAt: Date.now() };
  try {
    await putOSS(objectKey, bytes, mime);
    // Each contender uploads a different key. The DB uniqueness constraint chooses
    // one winner across processes; losers delete only their own object.
    const inserted = await db.insert(MediaObject).values(row).onConflictDoNothing({
      target: [MediaObject.owner, MediaObject.attachmentId, MediaObject.sha256, MediaObject.mime],
    }).returning({ id: MediaObject.id });
    if (inserted.length) return publicMedia(row);
    const winner = await db.select().from(MediaObject).where(matches).limit(1);
    if (!winner[0]) throw unavailable();
    await deleteOSS(objectKey);
    return publicMedia(winner[0]);
  } catch {
    // Covers DB failure and ambiguous put timeout. Do not leak object paths or SDK errors.
    try { await deleteOSS(objectKey); } catch { /* Best-effort after SDK's delete retries. */ }
    throw unavailable();
  }
}

/** Resolve only this site's opaque media handles, never an external URL's path. */
export function mediaURLPath(value: string, identity: MediaIdentity): string | null {
  let path: string;
  if (value.startsWith('/api/media/')) path = value.split(/[?#]/, 1)[0];
  else {
    const configured = env('SITE_ORIGIN').trim();
    const origin = identityContext.get(identity)?.origin ?? (configured ? new URL(configured).origin : undefined);
    if (!origin) return null;
    try {
      const url = new URL(value);
      if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
      path = url.pathname;
    } catch { return null; }
  }
  if (!path.startsWith('/api/media/')) return null;
  const id = path.slice('/api/media/'.length);
  return UUID.test(id) ? `/api/media/${id.toLowerCase()}` : null;
}
/** Only actual same-origin media URL strings are references, never foreign paths. */
export async function claimMediaURLs(value: unknown, identity: MediaIdentity): Promise<void> {
  const ids = new Set<string>();
  const seen = new WeakSet<object>();
  const stack: unknown[] = [value];
  let visited = 0;
  while (stack.length) {
    const node = stack.pop();
    if (++visited > 100_000) throw new MediaError(400, 'MEDIA_REFERENCES', '媒体引用无效或过多。');
    if (typeof node === 'string') {
      const path = mediaURLPath(node, identity);
      if (path) ids.add(path.slice('/api/media/'.length));
    } else if (node && typeof node === 'object' && !seen.has(node)) {
      seen.add(node);
      stack.push(...Object.values(node));
    }
    if (ids.size > 1000) throw new MediaError(400, 'MEDIA_REFERENCES', '媒体引用无效或过多。');
  }
  if (!ids.size) return;
  requireEnabled();
  try {
    await db.transaction(async tx => {
      const claims: string[] = [];
      // Validate every reference before any ownership mutation. The write
      // transaction and conditional updates protect against concurrent claims.
      for (const id of ids) {
        const [row] = await tx.select().from(MediaObject).where(eq(MediaObject.id, id)).limit(1);
        if (!row) throw denied();
        if (row.owner === identity.owner) continue;
        if (!identity.userId || row.owner !== identity.guestOwner || identity.owner !== `user:${identity.userId}`) throw denied();
        claims.push(id);
      }
      for (const id of claims) {
        const changed = await tx.update(MediaObject).set({ owner: identity.owner })
          .where(and(eq(MediaObject.id, id), eq(MediaObject.owner, identity.guestOwner))).returning({ id: MediaObject.id });
        if (changed.length !== 1) throw denied();
      }
    });
  } catch (error) {
    if (error instanceof MediaError) throw error;
    throw unavailable(); // Includes atomic rollback if an existing user upload collides.
  }
}

let lastCleanup = 0;
async function reserveBudget(keys: string[], amount: number, limit: number, expiresAt: number, bytes: boolean, reading: boolean): Promise<void> {
  if (limit < amount || limit === 0) throw quotaError(bytes, reading);
  // One statement charges every scope of this request, so streaming a chunk
  // costs a single commit instead of one per scope.
  const result = await db.insert(DailyUsage)
    .values(keys.map(key => ({ key: hash(`media:${key}`), count: amount, expiresAt })))
    .onConflictDoUpdate({ target: DailyUsage.key, set: { count: sql`${DailyUsage.count} + ${amount}` },
      setWhere: amount === 0 ? sql`${DailyUsage.count} < ${limit}` : sql`${DailyUsage.count} <= ${limit - amount}` }).returning({ key: DailyUsage.key });
  if (result.length !== keys.length) throw quotaError(bytes, reading);
}
async function mediaBudget(identity: MediaIdentity, bytes?: number, reading = false) {
  const now = Date.now();
  if (now - lastCleanup > 3600_000) {
    lastCleanup = now;
    await db.delete(DailyUsage).where(lt(DailyUsage.expiresAt, now));
  }
  const scopes = [identity.owner];
  const ip = identityContext.get(identity)?.ipHash;
  if (ip) scopes.push(`ip:${ip}`); // Resetting a device cookie cannot reset IP limits.
  const day = new Date(now).toISOString().slice(0, 10);
  const minute = Math.floor(now / 60_000);
  // Public and private reads share one bounded budget, independent of uploads.
  const keys = scopes.map(scope => {
    const key = reading ? `read:${scope}` : scope;
    return bytes === undefined ? `${key}:minute:${minute}` : `${key}:bytes:${day}`;
  });
  if (bytes === undefined) {
    await reserveBudget(keys, 1,
      reading ? ossInteger('OSS_MEDIA_READ_RATE_LIMIT', 60) : ossInteger('OSS_MEDIA_RATE_LIMIT', 60), now + 120_000, false, reading);
  } else {
    await reserveBudget(keys, bytes,
      reading ? ossInteger('OSS_MEDIA_READ_DAILY_BYTES', 1024 * 1024 * 1024) : ossInteger('OSS_MEDIA_DAILY_BYTES', 1024 * 1024 * 1024), now + 2 * 86400_000, true, reading);
  }
}
/** Reserve a per-minute request and verify daily budget before fetching/reading. */
export async function reserveMediaUpload(identity: MediaIdentity): Promise<void> {
  requireEnabled();
  await mediaBudget(identity);
  await mediaBudget(identity, 0);
}
/** Charge actual upload/download bytes before persisting or streaming. */
export async function reserveMediaBytes(identity: MediaIdentity, bytes: number): Promise<void> {
  requireEnabled();
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new MediaError(400, 'MEDIA_SIZE', '媒体大小无效。');
  await mediaBudget(identity, bytes);
}
let activeUploads = 0;
async function readUpload(request: Request): Promise<Uint8Array> {
  const { maxFileBytes } = ossSettings();
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > maxFileBytes)) {
    throw new MediaError(413, 'MEDIA_SIZE', '媒体为空或超过大小限制。');
  }
  if (!request.body) throw new MediaError(400, 'MEDIA_BODY', '媒体内容为空。');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 60_000);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxFileBytes) {
        void reader.cancel().catch(() => {});
        throw new MediaError(413, 'MEDIA_SIZE', '媒体为空或超过大小限制。');
      }
      chunks.push(value);
    }
    if (timedOut) throw new MediaError(408, 'MEDIA_TIMEOUT', '媒体上传超时，请重试。');
    if (!total) throw new MediaError(400, 'MEDIA_BODY', '媒体内容为空。');
    return Buffer.concat(chunks, total);
  } finally { clearTimeout(timer); reader.releaseLock(); }
}
export async function uploadMedia(context: APIContext): Promise<Response> {
  requireEnabled();
  assertMediaOrigin(context, true);
  const identity = await mediaIdentity(context);
  const mime = normalizeMime(context.request.headers.get('content-type') ?? '');
  const attachmentId = attachment(context.request.headers.get('x-olai-attachment-id') ?? '');
  await mediaBudget(identity);
  await mediaBudget(identity, 0); // Reject exhausted daily budgets before reading a body.
  if (activeUploads >= 4) throw new MediaError(429, 'MEDIA_LIMIT', '同时上传的文件较多，请稍后重试。', 5);
  activeUploads++;
  try {
    const bytes = await readUpload(context.request);
    await mediaBudget(identity, bytes.byteLength);
    const result = await storeMedia(bytes, mime, attachmentId, identity);
    return Response.json(result, { status: 201, headers: mediaHeaders() });
  } finally { activeUploads--; }
}
interface ByteRange { start: number; end: number }
function byteRange(value: string | null, size: number): ByteRange | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  const invalid = () => new MediaError(416, 'MEDIA_RANGE', '媒体范围无效。');
  if (!match || (!match[1] && !match[2])) throw invalid();
  let start: number, end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) throw invalid();
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) throw invalid();
    end = Math.min(end, size - 1);
  }
  if (start >= size || start < 0 || end < 0) throw invalid();
  return { start, end };
}
export async function downloadMedia(context: APIContext): Promise<Response> {
  requireEnabled();
  assertMediaOrigin(context);
  const identity = await mediaIdentity(context);
  const id = context.params.id ?? '';
  if (!UUID.test(id)) throw denied();
  const [row] = await db.select().from(MediaObject).where(eq(MediaObject.id, id.toLowerCase())).limit(1);
  if (!row || (row.owner !== identity.owner && (!identity.userId || row.owner !== identity.guestOwner))) throw denied();
  return streamMedia(context, identity, row);
}

/** Read-only publication capability. The resolver must revalidate a completed
 * cloud asset and its exact whitelisted field, never accept arbitrary media IDs.
 * Ownership is checked against the publisher, not transferred to the reader. */
export async function downloadPublishedMedia(context: APIContext,
  resolve: () => Promise<({ id: string; owner: string; accepts: (mime: string) => boolean }
    | { id: string; bytes: Uint8Array; mime: string }) | null>): Promise<Response> {
  assertMediaOrigin(context);
  const identity = await mediaIdentity(context);
  const reference = await resolve();
  if (!reference) throw denied();
  if ('bytes' in reference) {
    // Inline legacy cloud media does not require OSS. Its publication resolver
    // validates the record, content digest, MIME and bounded bytes before here.
    if (!/^[a-f0-9]{64}$/.test(reference.id) || !reference.bytes.byteLength) throw denied();
    return streamMedia(context, identity, { ...reference, size: reference.bytes.byteLength });
  }
  requireEnabled();
  if (!UUID.test(reference.id)) throw denied();
  const [row] = await db.select().from(MediaObject).where(eq(MediaObject.id, reference.id)).limit(1);
  if (!row || row.owner !== reference.owner || !reference.accepts(row.mime)) throw denied();
  return streamMedia(context, identity, row, thumbnailWidth(context.url));
}

/** Gallery cards may ask for a bucket-side resized copy (?w=800). Anything
 * outside the small supported range is ignored and the original is served. */
export const THUMBNAIL_WIDTH = 800;
function thumbnailWidth(url: URL): number {
  const raw = url.searchParams.get('w');
  if (!raw || !/^\d{1,4}$/.test(raw)) return 0;
  const width = Number(raw);
  return width >= 64 && width <= 1600 ? width : 0;
}

type StreamMedia = Pick<typeof MediaObject.$inferSelect, 'id' | 'mime' | 'size'>
  & ({ objectKey: string } | { bytes: Uint8Array });
async function streamMedia(context: APIContext, identity: MediaIdentity,
  row: StreamMedia, thumbnail = 0): Promise<Response> {
  const mime = normalizeMime(row.mime);
  // Bucket-side transforms apply to stored objects only: legacy inline bytes
  // and non-image types are always served as stored. The output length of a
  // transform is unknown, so such a response has no Content-Length and no Range.
  const resized = thumbnail && 'objectKey' in row && mime.startsWith('image/') ? thumbnail : 0;
  const head = context.request.method === 'HEAD';
  const cacheKey = JSON.stringify([row.id, row.mime, row.size, 'objectKey' in row ? row.objectKey : 'inline', resized]);
  const etag = `"${hash(cacheKey)}"`;
  // Store in the browser, but revalidate permissions/publication on every reuse.
  // A 304 or server byte-cache hit consumes neither requests nor traffic quota.
  const cacheHeaders = { ...mediaHeaders(), 'Cache-Control': 'private, no-cache', ETag: etag };
  const validators = context.request.headers.get('if-none-match')?.split(',').map(value => value.trim().replace(/^W\//, ''));
  if (validators?.includes(etag) || validators?.includes('*')) {
    return new Response(null, { status: 304, headers: { ...cacheHeaders, 'X-Olai-Media-Cache': 'REVALIDATED' } });
  }
  const ifRange = context.request.headers.get('if-range');
  let range: ByteRange | null;
  try { range = resized ? null : byteRange(head || (ifRange && ifRange !== etag) ? null : context.request.headers.get('range'), row.size); }
  catch (error) {
    const response = mediaFailure(error, head);
    response.headers.set('Content-Range', `bytes */${row.size}`);
    return response;
  }
  const hit = resized
    ? completeMedia(cacheKey)
    : cachedMedia(cacheKey, range?.start ?? 0, range?.end ?? row.size - 1, !!range);
  if (hit && range) range = { start: range.start, end: range.start + hit.length - 1 };
  const size = range ? range.end - range.start + 1 : row.size;
  const headers: Record<string, string> = { ...cacheHeaders, 'Content-Type': mime,
    'X-Olai-Media-Cache': hit ? 'HIT' : 'MISS',
    'Content-Disposition': `${MIME[mime].download ? 'attachment' : 'inline'}; filename="${row.id}.${MIME[mime].extension}"`,
    ...(resized ? {} : { 'Content-Length': String(size), 'Accept-Ranges': 'bytes' }),
    ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${row.size}` } : {}),
  };
  if (hit) {
    if (resized) headers['Content-Length'] = String(hit.length);
    return new Response(head ? null : new Blob([hit as BlobPart]), { status: range ? 206 : 200, headers });
  }
  await mediaBudget(identity, undefined, true);
  if (head) return new Response(null, { status: 200, headers });
  // Only cache misses consume requests/traffic. Never precharge an entire range.
  await mediaBudget(identity, 0, true);
  const upstream = 'bytes' in row
    ? Readable.from((function* () {
      const bytes = range ? row.bytes.subarray(range.start, range.end + 1) : row.bytes;
      for (let offset = 0; offset < bytes.length; offset += 64 * 1024) yield bytes.subarray(offset, offset + 64 * 1024);
    })())
    : resized
      ? await readOSS(row.objectKey, undefined, `image/resize,w_${resized}/quality,q_80`)
      : await readOSS(row.objectKey, range ? `bytes=${range.start}-${range.end}` : undefined);
  // No upstream headers are trusted or forwarded. Cancellation propagates to OSS.
  const reader = (Readable.toWeb(upstream) as ReadableStream<Uint8Array>).getReader();
  const cache = captureMedia(cacheKey, range?.start ?? 0);
  let remaining = resized ? -1 : size; // -1: length unknown until the stream ends
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (cancelled) return;
        if (done) {
          if (remaining > 0) throw new OSSUnavailableError();
          cache.commit(true); controller.close(); return;
        }
        if (remaining >= 0 && value.byteLength > remaining) throw new OSSUnavailableError();
        // Charge each delivered chunk atomically against reader and IP budgets.
        await mediaBudget(identity, value.byteLength, true);
        if (cancelled) return;
        if (remaining >= 0) remaining -= value.byteLength;
        cache.append(value);
        controller.enqueue(value);
        if (remaining === 0) { cache.commit(true); controller.close(); await reader.cancel(); }
      } catch {
        cache.commit(); upstream.destroy();
        if (!cancelled) controller.error(new Error('媒体读取失败或浏览流量已达上限。'));
      }
    },
    async cancel() { cancelled = true; cache.commit(); upstream.destroy(); await reader.cancel().catch(() => {}); },
  }, { highWaterMark: 0 });
  return new Response(body, { status: range ? 206 : 200, headers });
}
