import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { ossEnabled } from '../../lib/server/oss';
import { db, VideoJob, eq } from '../../lib/server/database';
import { currentUser } from '../../lib/server/auth';
import { ClientIPError, chatConcurrencyLimit, chatDailyLimit, chatRateLimit, clientIP, dailyLimit, hash, sameOrigin } from '../../lib/server/policy';
import { reserveGeneration, refundGeneration, reserve } from '../../lib/server/quota';
import { acquireChatSlot, releaseOnStreamEnd } from '../../lib/server/chatGate';
import { aiEnv, decodeTaskId, encodeTaskId, serviceReady } from '../../lib/server/aiConfig';
import { buildGeneration, InputError, type GenerationRequest } from '../../lib/server/generation';
import { privateValues, publicJSON, publicSSE, publicUpstreamError, redactText } from '../../lib/server/publicResponse';

export const prerender = false;
const fail = (message: string, status: number) => Response.json({ error: { message } }, { status, headers: { 'Cache-Control': 'no-store' } });
const allowed = /^(status|chat\/completions|generate\/(image|music|video)|videos\/job_[a-zA-Z0-9_-]+(?:\/content)?)$/;
const MAX_BYTES = 64 * 1024 * 1024;
async function readInput(request: Request) {
  if (!request.body) throw new InputError('请求内容不能为空。');
  const reader = request.body.getReader(); const decoder = new TextDecoder();
  let length = 0, raw = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) throw new InputError('请求内容过长。');
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
    const input = JSON.parse(raw);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error();
    return input as Record<string, any>;
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError('请求内容需要是有效的 JSON 对象。');
  } finally { reader.releaseLock(); }
}
export const ALL: APIRoute = async context => {
  const { request, params } = context;
  const path = params.path ?? '';
  if (!allowed.test(path) || !['GET', 'POST'].includes(request.method)) return fail('接口路径或方法不受支持。', 404);
  if ((request.method === 'GET') !== (path === 'status' || path.startsWith('videos/'))) return fail('接口路径或方法不受支持。', 405);
  if ((request.method === 'POST' || request.headers.has('origin')) && !sameOrigin(request)) return fail('不允许跨站调用。', 403);
  if (path === 'status') return Response.json({ ready: serviceReady() }, { headers: { 'Cache-Control': 'no-store' } });
  if (!serviceReady()) return fail('创作服务尚未就绪，请联系服务提供方。', 503);
  const timeout = AbortSignal.timeout(180_000);
  let reservedKind: string | undefined, reservedOwner: string | undefined;
  let chatSlot: (() => void) | undefined;
  let upstreamStarted = false;
  const refund = async () => {
    if (!reservedKind || !reservedOwner) return;
    const kind = reservedKind, owner = reservedOwner;
    reservedKind = undefined; reservedOwner = undefined;
    await refundGeneration(owner, kind);
  };
  try {
    const user = await currentUser(context);
    const peerIP = clientIP(request, context.clientAddress);
    const owner = user ? `user:${user.id}` : `ip:${hash(peerIP)}`;
    const ownsTask = async (id: string): Promise<string> => {
      if (!/^job_[a-zA-Z0-9_-]+$/.test(id)) throw new InputError('视频任务不存在。');
      const [job] = await db.select().from(VideoJob).where(eq(VideoJob.id, id)).limit(1);
      if (!job || job.owner !== owner) throw new InputError('视频任务不存在。');
      return decodeTaskId(id);
    };
    let generation: GenerationRequest | undefined;
    let usesPreset = false;
    let upstreamPath = path;
    let publicTaskId: string | undefined;
    if (path.startsWith('videos/')) {
      publicTaskId = path.split('/')[1];
      const internalId = await ownsTask(publicTaskId);
      upstreamPath = `videos/${encodeURIComponent(internalId)}${path.endsWith('/content') ? '/content' : ''}`;
    } else {
      const input = await readInput(request);
      generation = buildGeneration(path, input);
      usesPreset = Boolean(generation.kind || (input.action && input.action !== 'chat'));
      if (input.extendFrom !== undefined) {
        if (generation.path !== 'videos' || typeof input.extendFrom !== 'string') throw new InputError('视频延续参数无效。');
        generation.payload.extend_from = await ownsTask(input.extendFrom);
      }
      upstreamPath = generation.path;
      const kind = generation.kind;
      if (kind) {
        const limit = dailyLimit(!!user);
        if (!await reserveGeneration(owner, kind, limit)) {
          const label = { image: '图片', music: '音乐', video: '视频' }[kind];
          return fail(`今日${label}生成额度已用完（每天 ${limit} 次）。${user ? '请北京时间零点后再试。' : '登录后可使用账号额度。'}`, 429);
        }
        reservedKind = kind; reservedOwner = owner;
      } else {
        const limit = chatDailyLimit(!!user);
        if (!limit) return fail('对话功能已停用。', 429);
        const now = Date.now(), rate = chatRateLimit();
        if (rate > 0 && !await reserve(hash(`chat-rate:${peerIP}:${Math.floor(now / 60_000)}`), rate, now + 120_000)) return Response.json({ error: { message: `对话请求过于频繁（每分钟最多 ${rate} 条），请稍后再试。` } }, { status: 429, headers: { 'Retry-After': '60' } });
        const concurrency = chatConcurrencyLimit();
        const slot = acquireChatSlot(peerIP, concurrency);
        if (!slot) return Response.json({ error: { message: `同一 IP 同时进行的对话请求过多（最多 ${concurrency} 个），请等待已有请求完成后再试。` } }, { status: 429, headers: { 'Retry-After': '10' } });
        chatSlot = slot;
        if (!await reserveGeneration(owner, 'chat', limit)) { chatSlot(); return fail(`今日对话额度已用完（每天 ${limit} 条），请北京时间零点后再试。`, 429); }
        reservedKind = 'chat'; reservedOwner = owner;
      }
    }
    const base = aiEnv('AI_API_BASE_URL').replace(/\/$/, '');
    const send = (target: string, payload?: Record<string, any>) => fetch(`${base}/${target}`, {
      method: request.method,
      headers: { Authorization: `Bearer ${aiEnv('AI_API_KEY')}`, Accept: '*/*', ...(payload ? { 'Content-Type': 'application/json' } : {}) },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.any([request.signal, timeout]),
      redirect: 'error',
    });
    upstreamStarted = true;
    let upstream = await send(upstreamPath, generation?.payload);
    if (!upstream.ok && generation?.fallback && (upstream.status === 404 || (upstreamPath === 'images/generations' && upstream.status === 502))) {
      await upstream.body?.cancel().catch(() => {});
      upstream = await send(generation.fallback.path, generation.fallback.payload);
    }
    if (!upstream.ok) { await refund(); chatSlot?.(); await upstream.body?.cancel().catch(() => {}); return publicUpstreamError(upstream.status); }
    const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' });
    const contentType = upstream.headers.get('content-type') || '';
    const privatePrompts: string[] = [];
    for (const payload of [generation?.payload, generation?.fallback?.payload]) {
      if (typeof payload?.prompt === 'string') privatePrompts.push(payload.prompt);
      if (typeof payload?.input === 'string') privatePrompts.push(payload.input);
      for (const message of payload?.messages || []) {
        if (message.role !== 'system' && !usesPreset) continue;
        if (typeof message.content === 'string') privatePrompts.push(message.content);
        else if (Array.isArray(message.content)) for (const part of message.content) if (part.type === 'text' && typeof part.text === 'string') privatePrompts.push(part.text);
      }
    }
    const secrets = privateValues(privatePrompts);
    if (contentType.includes('text/event-stream')) {
      if (!generation || generation.kind || generation.payload.stream !== true || !upstream.body) throw new Error('Invalid stream response');
      headers.set('Content-Type', 'text/event-stream; charset=utf-8');
      const sanitized = publicSSE(upstream.body, secrets);
      return new Response(chatSlot ? releaseOnStreamEnd(sanitized, chatSlot) : sanitized, { status: upstream.status, headers });
    }
    if (contentType.includes('json')) {
      const json = await upstream.json();
      if (json?.error) { await refund(); chatSlot?.(); return publicUpstreamError(502); }
      if (generation?.path === 'videos') {
        if (typeof json.id !== 'string' || !json.id || json.id.length > 2000) throw new Error('Invalid video response');
        publicTaskId = encodeTaskId(json.id);
        await db.insert(VideoJob).values({ id: publicTaskId, owner, createdAt: Date.now() });
      }
      let result: Record<string, unknown>;
      if (generation?.kind && !publicTaskId && ossEnabled()) {
        const { mediaIdentity } = await import('../../lib/server/media');
        const { persistGeneratedJSON } = await import('../../lib/server/generatedMedia');
        result = await persistGeneratedJSON(json, generation.kind, await mediaIdentity(context));
      } else result = publicJSON(json, generation?.kind || null, secrets, publicTaskId);
      chatSlot?.();
      return Response.json(result, { status: upstream.status, headers });
    }
    const expected = path.endsWith('/content') || generation?.kind === 'video' ? 'video/' : generation?.kind === 'image' ? 'image/' : generation?.kind === 'music' ? 'audio/' : undefined;
    if (!expected || (!contentType.startsWith(expected) && !contentType.startsWith('application/octet-stream'))) throw new Error('Invalid media response');
    if (redactText(contentType, secrets) !== contentType) throw new Error('Invalid media type');
    if (ossEnabled()) {
      const { mediaIdentity, reserveMediaBytes, storeMedia } = await import('../../lib/server/media');
      const { readMediaBody } = await import('../../lib/server/mediaImport');
      const identity = await mediaIdentity(context);
      let bytes = await readMediaBody(upstream);
      let mime = contentType.startsWith('application/octet-stream') ? `${expected}${expected === 'video/' ? 'mp4' : expected === 'image/' ? 'png' : 'mpeg'}` : contentType;
      if (expected === 'audio/') {
        // Normalize raw PCM to WAV and preserve actual RIFF/MP3 audio types,
        // just as the existing browser decoder does for Base64 generation.
        const { base64Blob } = await import('../../lib/api');
        const audio = base64Blob(Buffer.from(bytes).toString('base64'), contentType);
        bytes = new Uint8Array(await audio.arrayBuffer()); mime = audio.type;
      }
      await reserveMediaBytes(identity, bytes.byteLength);
      const stored = await storeMedia(bytes, mime, publicTaskId ? `video-${hash(publicTaskId)}` : randomUUID(), identity);
      chatSlot?.();
      if (path.endsWith('/content')) {
        headers.set('Content-Type', stored.mime);
        headers.set('X-Olai-Media-Url', stored.url);
        return new Response(Buffer.from(bytes), { status: upstream.status, headers });
      }
      return Response.json({ data: [{ url: stored.url, mime_type: stored.mime }] }, { status: upstream.status, headers });
    }
    headers.set('Content-Type', contentType);
    chatSlot?.();
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    chatSlot?.();
    try { await refund(); } catch { /* Never expose database or provider details. */ }
    if (error instanceof InputError) return fail(error.message, error.message === '视频任务不存在。' ? 404 : 400);
    if (error instanceof ClientIPError) return fail(error.message, 400);
    if (!upstreamStarted) return fail('账号或额度服务暂不可用，请稍后重试。', 503);
    return fail(timeout.aborted ? '创作请求超时，请稍后重试。' : request.signal.aborted ? '请求已停止。' : '创作服务暂时无法完成请求，请稍后重试。', 502);
  }
};
