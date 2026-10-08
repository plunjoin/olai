import type { APIRoute } from 'astro';
import { db, StudioRecord, RecordChunk, VideoJob, eq, and, asc } from '../../../lib/server/database';
import { currentUser } from '../../../lib/server/auth';
import { clientIP, hash, sameOrigin } from '../../../lib/server/policy';

export const prerender = false;
const MAX_BYTES = 64 * 1024 * 1024;
const CHUNK_SIZE = 128 * 1024;
const fail = (message: string, status: number) => Response.json({ error: { message } }, { status });
async function readBody(request: Request) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return size > MAX_BYTES ? null : text + decoder.decode();
      size += value.byteLength;
      // Drain oversized requests without buffering them. Cancelling the Node
      // request stream can close the connection before the 413 reaches the client.
      if (size > MAX_BYTES) { text = ''; continue; }
      text += decoder.decode(value, { stream: true });
    }
  } finally { reader.releaseLock(); }
}
function recordError(value: any, store: string): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '记录需要是 JSON 对象。';
  if (typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.id)) return '记录编号无效。';
  if (!Number.isFinite(value.createdAt)) return '记录缺少有效的创建时间。';
  if (store === 'conversations') {
    if (typeof value.title !== 'string' || value.title.length > 100) return '会话标题无效或超过 100 个字符。';
    if (!Number.isFinite(value.updatedAt)) return '会话缺少有效的更新时间。';
    if (!Array.isArray(value.messages)) return '会话消息需要是数组。';
    const invalid = value.messages.findIndex((m: any) => !m || typeof m.id !== 'string' || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string');
    if (invalid >= 0) return `会话第 ${invalid + 1} 条消息的编号、角色或内容格式无效。`;
    return null;
  }
  if (!['image', 'music', 'video'].includes(value.kind)) return '作品类型无效。';
  if (!['pending', 'completed', 'failed'].includes(value.status)) return '作品状态无效。';
  if (typeof value.prompt !== 'string') return '作品描述需要是文本。';
  if (!value.options || typeof value.options !== 'object' || Array.isArray(value.options)) return '作品参数需要是 JSON 对象。';
  return null;
}
export const ALL: APIRoute = async context => {
  const { request, params, url } = context;
  const store = params.store;
  if (!['conversations', 'assets'].includes(store || '') || !['GET', 'PUT', 'DELETE'].includes(request.method)) return fail('接口不存在。', 404);
  if (request.method !== 'GET' && !sameOrigin(request)) return fail('不允许跨站调用。', 403);
  try {
    const user = await currentUser(context);
    if (!user) return fail('登录已过期，请重新登录后保存。', 401);
    if (request.headers.get('x-olai-user') !== user.id) return fail('账号已切换，请刷新页面后继续。', 409);
    const owned = and(eq(StudioRecord.userId, user.id), eq(StudioRecord.store, store!));
    if (request.method === 'GET') {
      const records = await db.select().from(StudioRecord).where(owned);
      const chunks = await db.select({ recordKey: RecordChunk.recordKey, data: RecordChunk.data }).from(RecordChunk)
        .innerJoin(StudioRecord, eq(RecordChunk.recordKey, StudioRecord.key)).where(owned).orderBy(asc(RecordChunk.position));
      const bodies = new Map<string, string[]>();
      for (const chunk of chunks) { const parts = bodies.get(chunk.recordKey) || []; parts.push(chunk.data); bodies.set(chunk.recordKey, parts); }
      return Response.json({ records: records.map(record => JSON.parse(record.data || bodies.get(record.key)?.join('') || '{}')) }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (request.method === 'DELETE') {
      const id = url.searchParams.get('id');
      if (!id || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return fail('记录编号无效。', 400);
      const key = hash(`${user.id}:${store}:${id}`);
      await db.batch([
        db.delete(RecordChunk).where(eq(RecordChunk.recordKey, key)),
        db.delete(StudioRecord).where(and(owned, eq(StudioRecord.key, key))),
      ]);
      return Response.json({ ok: true });
    }
    const raw = await readBody(request);
    if (raw === null) return fail('单条云端记录不能超过 64 MB，请下载较大的作品备份。', 413);
    let value;
    try { value = JSON.parse(raw); } catch { return fail('记录格式无效。', 400); }
    const validationError = recordError(value, store!);
    if (validationError) {
      console.warn('Record validation failed:', { store, reason: validationError });
      return fail(validationError, 400);
    }
    const key = hash(`${user.id}:${store}:${value.id}`);
    const data = raw.length <= CHUNK_SIZE ? raw : '';
    const record = { key, userId: user.id, store: store!, recordId: value.id, data, updatedAt: Date.now() };
    const chunks: { id: string; recordKey: string; position: number; data: string }[] = [];
    if (!data) for (let start = 0; start < raw.length;) {
      let end = Math.min(start + CHUNK_SIZE, raw.length);
      // Preserve UTF-16 surrogate pairs when a boundary crosses an emoji.
      if (end < raw.length && /[\uD800-\uDBFF]/.test(raw[end - 1])) end--;
      const position = chunks.length;
      chunks.push({ id: `${key}:${position}`, recordKey: key, position, data: raw.slice(start, end) });
      start = end;
    }
    if (url.searchParams.get('import') === 'guest') {
      const guestOwner = store === 'assets' && value.kind === 'video' && value.remoteId
        ? `ip:${hash(clientIP(request, context.clientAddress))}` : undefined;
      // A retry may arrive after the first import committed. Preserve cloud
      // records and their newer edits; never replace their media chunks.
      await db.transaction(async transaction => {
        const inserted = await transaction.insert(StudioRecord).values(record)
          .onConflictDoNothing({ target: StudioRecord.key }).returning({ key: StudioRecord.key });
        if (inserted.length) for (let start = 0; start < chunks.length; start += 50) {
          await transaction.insert(RecordChunk).values(chunks.slice(start, start + 50));
        }
        if (guestOwner) await transaction.update(VideoJob).set({ owner: `user:${user.id}` })
          .where(and(eq(VideoJob.id, value.remoteId), eq(VideoJob.owner, guestOwner)));
      });
      return Response.json({ ok: true });
    }
    // Updating metadata and replacing media chunks is atomic.
    const writes = [
      db.insert(StudioRecord).values(record).onConflictDoUpdate({ target: StudioRecord.key, set: { data, updatedAt: record.updatedAt } }),
      db.delete(RecordChunk).where(eq(RecordChunk.recordKey, key)),
      ...chunks.map(chunk => db.insert(RecordChunk).values(chunk)),
    ] as const;
    await db.batch(writes);
    return Response.json({ ok: true });
  } catch (error) {
    console.error('Record request failed:', error);
    return fail('云端记录暂时无法读取或保存，请稍后重试。', 503);
  }
};
