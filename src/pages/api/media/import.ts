import type { APIRoute } from 'astro';
import { assertMediaOrigin, mediaFailure, mediaIdentity, reserveMediaUpload, reserveMediaBytes, storeMedia } from '../../../lib/server/media';
import { ossEnabled } from '../../../lib/server/oss';
import { importRemoteMedia } from '../../../lib/server/mediaImport';
export const prerender = false;
export const POST: APIRoute = async context => {
  const fail = (message: string, status: number) => Response.json({ error: { message } }, { status, headers: { 'Cache-Control': 'no-store' } });
  try {
    assertMediaOrigin(context, true);
    if (!ossEnabled()) return fail('媒体云存储尚未启用。', 503);
    const identity = await mediaIdentity(context);
    const expected = context.request.headers.get('x-olai-user');
    if (expected !== (identity.userId || 'guest')) return fail('账号已切换，请刷新后再同步。', 409);
    await reserveMediaUpload(identity);
    const reader = context.request.body?.getReader();
    if (!reader) return fail('请求内容无效。', 400);
    let size = 0; const parts: Uint8Array[] = [];
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.length; if (size > 8192) { await reader.cancel().catch(() => {}); return fail('请求内容过长。', 413); }
        parts.push(value);
      }
    } finally { reader.releaseLock(); }
    const input = JSON.parse(Buffer.concat(parts).toString('utf8'));
    if (typeof input.url !== 'string' || typeof input.attachmentId !== 'string' || !/^[a-zA-Z0-9_-]{1,250}$/.test(input.attachmentId)) return fail('媒体同步参数无效。', 400);
    const { bytes, mime } = await importRemoteMedia(input.url);
    await reserveMediaBytes(identity, bytes.byteLength);
    return Response.json(await storeMedia(bytes, mime, input.attachmentId, identity), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return mediaFailure(error); }
};
