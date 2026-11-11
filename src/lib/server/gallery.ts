import type { APIContext } from 'astro';
import { inArray } from 'drizzle-orm';
import { db, StudioRecord, RecordChunk, MediaObject, and, asc, eq, gt } from './database';
import { env, hash } from './policy';
import { privateValues, redactText } from './publicResponse';
import { assertMediaOrigin, downloadPublishedMedia, mediaFailure, mediaHeaders, MediaError, THUMBNAIL_WIDTH } from './media';

const FIELDS = ['url', 'coverUrl', 'lyricsUrl', 'lrcUrl'] as const;
type Field = typeof FIELDS[number];
type RecordRow = typeof StudioRecord.$inferSelect;
const KEY = /^[a-f0-9]{64}$/;
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const HANDLE = new RegExp(`^/api/media/(${UUID})$`, 'i');
const PUBLIC_HANDLE = new RegExp(`^([a-f0-9]{64})\\.(url|coverUrl|lyricsUrl|lrcUrl)\\.(${UUID}|inline-[a-f0-9]{64})$`);
const MAX_RECORD_CHARS = 64 * 1024 * 1024;
export const GALLERY_INLINE_MAX_BYTES = 32 * 1024 * 1024;
interface InlineMedia { mime: string; payload: string }
interface Reference { field: Field; id: string; inline?: InlineMedia }

/** Never interpret foreign media paths, data/blob URLs, query strings or provider
 * links as public references. Absolute local URLs are normalized only at origin. */
function mediaId(value: unknown, origin: string): string | null {
  if (typeof value !== 'string') return null;
  let path = value;
  if (!path.startsWith('/')) {
    try {
      const url = new URL(value);
      if (url.origin !== origin || url.username || url.password || url.search || url.hash) return null;
      path = url.pathname;
    } catch { return null; }
  }
  return HANDLE.exec(path)?.[1].toLowerCase() ?? null;
}
function accepts(kind: string, field: Field, mime: string): boolean {
  if (field === 'coverUrl') return /^image\/(?:png|jpeg|webp|gif|avif|bmp)$/.test(mime);
  if (field === 'lyricsUrl') return mime === 'text/plain';
  if (field === 'lrcUrl') return ['text/plain', 'text/lrc', 'application/x-lrc'].includes(mime);
  if (kind === 'image') return accepts(kind, 'coverUrl', mime);
  if (kind === 'music') return /^audio\/(?:mpeg|mp3|mp4|aac|wav|x-wav|ogg|webm|flac|x-flac)$/.test(mime);
  return /^video\/(?:mp4|webm|quicktime|ogg)$/.test(mime);
}
function completed(value: any): boolean {
  return value && typeof value === 'object' && !Array.isArray(value)
    && value.status === 'completed' && ['image', 'music', 'video'].includes(value.kind)
    && typeof value.prompt === 'string' && Number.isFinite(value.createdAt);
}
async function bodies(tx: Pick<typeof db, 'select'>, rows: RecordRow[]): Promise<Map<string, any>> {
  const empty = rows.filter(row => !row.data).map(row => row.key);
  const parts = new Map<string, string[]>();
  if (empty.length) {
    const chunks = await tx.select().from(RecordChunk).where(inArray(RecordChunk.recordKey, empty)).orderBy(asc(RecordChunk.position));
    const positions = new Map<string, number>();
    const lengths = new Map<string, number>();
    const invalid = new Set<string>();
    for (const chunk of chunks) {
      const expected = positions.get(chunk.recordKey) ?? 0;
      const size = (lengths.get(chunk.recordKey) ?? 0) + chunk.data.length;
      if (chunk.position !== expected || size > MAX_RECORD_CHARS) invalid.add(chunk.recordKey);
      positions.set(chunk.recordKey, expected + 1); lengths.set(chunk.recordKey, size);
      if (!invalid.has(chunk.recordKey)) {
        const list = parts.get(chunk.recordKey) ?? []; list.push(chunk.data); parts.set(chunk.recordKey, list);
      }
    }
    for (const key of invalid) parts.delete(key);
  }
  const output = new Map<string, any>();
  for (const row of rows) {
    if (!KEY.test(row.key)) continue;
    const raw = row.data || parts.get(row.key)?.join('');
    if (!raw || raw.length > MAX_RECORD_CHARS) continue;
    try { const value = JSON.parse(raw); if (completed(value)) output.set(row.key, value); }
    catch { /* A malformed legacy row must not expose errors or break the page. */ }
  }
  return output;
}
function sourceOrigin(context: APIContext): string { return new URL(env('SITE_ORIGIN').trim() || context.url.origin).origin; }
function inlineMedia(value: unknown, kind: string, field: Field): InlineMedia | null {
  if (typeof value !== 'string' || value.length > Math.ceil(GALLERY_INLINE_MAX_BYTES / 3) * 4 + 4096) return null;
  const comma = value.indexOf(',');
  if (comma < 0 || comma > 100) return null;
  const header = /^data:([a-z0-9.+/-]+)(?:;charset=[a-z0-9_-]+)?;base64$/i.exec(value.slice(0, comma));
  if (!header) return null;
  const mime = header[1].toLowerCase();
  if (!accepts(kind, field, mime)) return null;
  const payload = value.slice(comma + 1).replace(/\s/g, '');
  if (!payload.length || payload.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) return null;
  const size = payload.length / 4 * 3 - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0);
  if (size < 1 || size > GALLERY_INLINE_MAX_BYTES) return null;
  return { mime, payload };
}
function references(value: any, origin: string): Reference[] {
  return FIELDS.flatMap<Reference>(field => {
    // A pending/failed cover is not itself a completed output.
    if (field === 'coverUrl' && value.coverStatus && value.coverStatus !== 'completed') return [];
    // blobData is the private serializer's primary-media slot, never a new
    // arbitrary attachment capability. Raw data/base64 never enters the list.
    const inline = (field === 'url' ? inlineMedia(value.blobData, value.kind, field) : null)
      ?? inlineMedia(value[field], value.kind, field);
    if (inline) return [{ field, id: `inline-${hash(`${inline.mime}:${inline.payload}`)}`, inline }];
    const id = mediaId(value[field], origin);
    return id ? [{ field, id }] : [];
  });
}
function projection(row: RecordRow, value: any, secrets: string[]): Record<string, any> {
  const text = (s: string, max: number) => redactText(s, secrets).slice(0, max);
  const output: Record<string, any> = {
    id: `gallery_${row.key}`, kind: value.kind, status: 'completed',
    prompt: text(value.prompt, 16_000), createdAt: value.createdAt, options: {},
  };
  // Explicit primitive/enum whitelist, never copy options/config or nested objects.
  if (typeof value.options?.aspect_ratio === 'string' && /^(?:auto|1:1|16:9|9:16|4:3|3:4|3:2|2:3|21:9)$/.test(value.options.aspect_ratio)) output.options.aspect_ratio = value.options.aspect_ratio;
  if (['1K', '2K', '4K'].includes(value.options?.image_size)) output.options.image_size = value.options.image_size;
  if (typeof value.options?.duration === 'number' && Number.isFinite(value.options.duration) && value.options.duration > 0 && value.options.duration <= 3600) output.options.duration = value.options.duration;
  for (const field of ['imageWidth', 'imageHeight', 'audioDuration'] as const) {
    if (typeof value[field] === 'number' && Number.isFinite(value[field]) && value[field] > 0 && value[field] <= 1_000_000) output[field] = value[field];
  }
  for (const field of ['lyrics', 'lrc'] as const) if (typeof value[field] === 'string') output[field] = text(value[field], 64_000);
  if (['estimated', 'audio'].includes(value.lrcSource)) output.lrcSource = value.lrcSource;
  if (value.song && typeof value.song === 'object' && !Array.isArray(value.song)) {
    output.song = {
      title: typeof value.song.title === 'string' ? text(value.song.title, 200) : '',
      style: typeof value.song.style === 'string' ? text(value.song.style, 2000) : '',
      instrumental: value.song.instrumental === true, sections: [],
    };
  }
  return output;
}
function parameter(url: URL, name: string, fallback: number, min: number, max: number): number {
  const values = url.searchParams.getAll(name);
  if (!values.length) return fallback;
  if (values.length !== 1 || !/^\d{1,16}$/.test(values[0])) throw new MediaError(400, 'GALLERY_PAGE', '分页参数无效。');
  const value = Number(values[0]);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new MediaError(400, 'GALLERY_PAGE', '分页参数无效。');
  return value;
}

/** Offset counts publishable completed assets, not raw DB rows. Keyset scans keep
 * memory bounded and chunk queries page-local without a schema migration. The
 * opaque server key supplies a stable total order independent of viewer identity. */
export async function galleryList(context: APIContext): Promise<Response> {
  assertMediaOrigin(context);
  const offset = parameter(context.url, 'offset', 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = parameter(context.url, 'limit', 30, 1, 100);
  const origin = sourceOrigin(context), secrets = privateValues();
  const output: Record<string, any>[] = [];
  let cursor = '', skipped = 0;
  while (output.length <= limit) {
    const page = await db.transaction(async tx => {
      const rows = await tx.select().from(StudioRecord).where(and(eq(StudioRecord.store, 'assets'), gt(StudioRecord.key, cursor)))
        .orderBy(asc(StudioRecord.key)).limit(30);
      const values = await bodies(tx, rows);
      const refs = new Map([...values].map(([key, value]) => [key, references(value, origin)]));
      const ids = [...new Set([...refs.values()].flatMap(items => items.filter(ref => !ref.inline).map(ref => ref.id)))];
      const media = ids.length ? await tx.select().from(MediaObject).where(inArray(MediaObject.id, ids)) : [];
      return { rows, values, refs, media: new Map(media.map(row => [row.id, row])) };
    });
    for (const row of page.rows) {
      const value = page.values.get(row.key);
      if (!value) continue;
      if (skipped++ < offset) continue;
      const asset = projection(row, value, secrets);
      for (const ref of page.refs.get(row.key) ?? []) {
        const media = page.media.get(ref.id);
        if (!ref.inline && (!media || media.owner !== `user:${row.userId}` || !accepts(value.kind, ref.field, media.mime))) continue;
        asset[ref.field] = `/api/gallery/media/${row.key}.${ref.field}.${ref.id}`;
        // Cards load a small bucket-side copy; the detail view keeps the original.
        if (media?.mime.startsWith('image/') && (ref.field === 'url' || ref.field === 'coverUrl'))
          asset[ref.field === 'url' ? 'thumbnail' : 'coverThumbnail'] = `${asset[ref.field]}?w=${THUMBNAIL_WIDTH}`;
        if (ref.field === 'coverUrl') asset.coverStatus = 'completed';
      }
      output.push(asset);
      if (output.length > limit) break;
    }
    if (page.rows.length < 30 || output.length > limit) break;
    cursor = page.rows[page.rows.length - 1].key;
  }
  return Response.json({ records: output.slice(0, limit), nextOffset: output.length > limit ? offset + limit : null }, { headers: mediaHeaders() });
}

export async function galleryMedia(context: APIContext): Promise<Response> {
  return downloadPublishedMedia(context, async () => {
    const match = PUBLIC_HANDLE.exec(context.params.id ?? '');
    if (!match) return null;
    const key = match[1], field = match[2] as Field, id = match[3];
    return db.transaction(async tx => {
      const rows = await tx.select().from(StudioRecord).where(and(eq(StudioRecord.key, key), eq(StudioRecord.store, 'assets'))).limit(1);
      const row = rows[0];
      if (!row) return null;
      const value = (await bodies(tx, rows)).get(key);
      if (!value) return null;
      const reference = references(value, sourceOrigin(context)).find(ref => ref.field === field && ref.id === id);
      if (!reference) return null;
      if (reference.inline) return { id: id.slice('inline-'.length), bytes: Buffer.from(reference.inline.payload, 'base64'), mime: reference.inline.mime };
      return { id, owner: `user:${row.userId}`, accepts: (mime: string) => accepts(value.kind, field, mime) };
    });
  });
}

export function galleryFailure(error: unknown, head = false): Response {
  return mediaFailure(error instanceof MediaError ? error : new MediaError(503, 'GALLERY_UNAVAILABLE', '公开作品暂不可用。'), head);
}
