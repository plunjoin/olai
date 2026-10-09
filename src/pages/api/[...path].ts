import type { APIRoute } from 'astro';
import { DEFAULT_SETTINGS } from '../../lib/types';
import { db, VideoJob, eq } from '../../lib/server/database';
import { currentUser } from '../../lib/server/auth';
import { ClientIPError, clientIP, dailyLimit, generationKind, hash, sameOrigin } from '../../lib/server/policy';
import { reserveGeneration, refundGeneration } from '../../lib/server/quota';
import { upstreamErrorResponse } from '../../lib/server/upstream';

export const prerender = false;
const allowed = /^(models|chat\/completions|interactions|images\/[a-zA-Z0-9_-]+|audio\/[a-zA-Z0-9_-]+|videos(?:\/[a-zA-Z0-9_-]+(?:\/content)?)?)$/;

export const ALL: APIRoute = async context => {
  const { request, params } = context;
  const path = params.path ?? '';
  if (!allowed.test(path) || !['GET', 'POST'].includes(request.method)) {
    return Response.json({ error: { message: '接口路径或方法不受支持。' } }, { status: 404 });
  }
  if ((request.method === 'GET') !== (path === 'models' || path.startsWith('videos/'))) {
    return Response.json({ error: { message: '接口路径或方法不受支持。' } }, { status: 405 });
  }
  if (request.method === 'POST' && !sameOrigin(request)) return Response.json({ error: { message: '不允许跨站调用。' } }, { status: 403 });

  const origin = request.headers.get('origin');
  if (origin) {
    try {
      if (!sameOrigin(request)) {
        return Response.json({ error: { message: '不允许跨站调用。' } }, { status: 403 });
      }
    } catch {
      return Response.json({ error: { message: '无效的 Origin 标头。' } }, { status: 403 });
    }
  }

  const apiKey = process.env.AI_API_KEY || (import.meta.env.AI_API_KEY as string | undefined);
  const key = request.headers.get('authorization') || (apiKey ? `Bearer ${apiKey}` : '');
  if (!key) return Response.json({ error: { message: '请先在设置中填写 API Key，或由部署者配置服务端密钥。' } }, { status: 401 });
  const base = (process.env.AI_API_BASE_URL || import.meta.env.AI_API_BASE_URL).replace(/\/$/, '');
  const timeout = AbortSignal.timeout(180_000);
  let upstreamStarted = false;
  let useBetaInteractions = false;
  let reservedKind: string | undefined;
  let reservedOwner: string | undefined;

  try {
    let owner = '';
    if (request.method === 'POST' || path.startsWith('videos/')) {
      const user = await currentUser(context);
      owner = user ? `user:${user.id}` : `ip:${hash(clientIP(request, context.clientAddress))}`;
      if (path.startsWith('videos/')) {
        const [job] = await db.select().from(VideoJob).where(eq(VideoJob.id, path.split('/')[1])).limit(1);
        if (!job || job.owner !== owner) return Response.json({ error: { message: '视频任务不存在。' } }, { status: 404 });
      }
    }
    const upstreamHeaders: Record<string, string> = {
      Authorization: key,
      Accept: request.headers.get('accept') || '*/*',
    };
    let body: string | undefined = undefined;
    if (request.method === 'POST') {
      const raw = await request.text();
      if (raw.length > 0) {
        // Deployments can map studio engines to the exact aliases used by their gateway.
        let payload;
        try {
          payload = JSON.parse(raw);
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error();
        } catch {
          return Response.json({ error: { message: '请求内容需要是有效的 JSON 对象。' } }, { status: 400 });
        }
        let kind;
        const actualVideoModel = payload.model === DEFAULT_SETTINGS.videoModel ? (process.env.AI_VIDEO_MODEL || import.meta.env.AI_VIDEO_MODEL || payload.model) : payload.model;
        if (path === 'videos' && /^gemini-omni-/i.test(String(actualVideoModel))) {
          return Response.json({ error: { message: '当前视频引擎使用聊天生成接口，请刷新页面后重新生成。' } }, { status: 400 });
        }
        try { kind = generationKind(path, payload); }
        catch { return Response.json({ error: { message: '请求的创作引擎不受支持。' } }, { status: 400 }); }
        if (path === 'interactions') {
          // Validate before reserving quota; only forward synchronous media generation.
          const format = payload.response_format;
          if (typeof payload.input !== 'string' || !payload.input.trim() || !format || format.type !== kind) {
            return Response.json({ error: { message: '请提供有效的媒体描述与生成参数。' } }, { status: 400 });
          }
          if (kind === 'video') {
            if (!['16:9', '9:16'].includes(format.aspect_ratio) || !['360p', '720p', '1080p', '4k'].includes(format.resolution) || !/^(?:[3-9]|10)s$/.test(format.duration)) {
              return Response.json({ error: { message: '请提供有效的视频比例、分辨率和 3–10 秒时长。' } }, { status: 400 });
            }
            payload = { model: payload.model, input: payload.input, response_format: { type: 'video', aspect_ratio: format.aspect_ratio, resolution: format.resolution, duration: format.duration, delivery: 'inline' }, stream: false, store: false };
            useBetaInteractions = true;
          } else {
            if (!['1K', '2K', '4K'].includes(format.image_size)) return Response.json({ error: { message: '请提供有效的图片分辨率参数。' } }, { status: 400 });
            payload = { model: payload.model, input: payload.input, response_format: { type: 'image', image_size: format.image_size, delivery: 'inline', ...(format.aspect_ratio ? { aspect_ratio: format.aspect_ratio } : {}) }, stream: false, store: false };
          }
        }
        if (kind) {
          const limit = dailyLimit(owner.startsWith('user:'));
          if (!await reserveGeneration(owner, kind, limit)) {
            const label = { image: '图片', music: '音乐', video: '视频' }[kind];
            return Response.json({ error: { message: `今日${label}生成额度已用完（每天 ${limit} 次）。${owner.startsWith('ip:') ? '登录后可使用账号额度。' : '请北京时间零点后再试。'}` } }, { status: 429 });
          }
          reservedKind = kind;
          reservedOwner = owner;
          // Each submitted request creates one output, regardless of client input.
          if ('n' in payload) payload.n = 1;
        }
        const aliases: Record<string, string | undefined> = {
          [DEFAULT_SETTINGS.chatModel]: process.env.AI_CHAT_MODEL || import.meta.env.AI_CHAT_MODEL,
          [DEFAULT_SETTINGS.imageModel]: process.env.AI_IMAGE_MODEL || import.meta.env.AI_IMAGE_MODEL,
          [DEFAULT_SETTINGS.videoModel]: process.env.AI_VIDEO_MODEL || import.meta.env.AI_VIDEO_MODEL,
          [DEFAULT_SETTINGS.musicModel]: process.env.AI_MUSIC_MODEL || import.meta.env.AI_MUSIC_MODEL,
        };
        if (aliases[payload.model]) payload.model = aliases[payload.model];
        body = JSON.stringify(payload);
        upstreamHeaders['Content-Type'] = request.headers.get('content-type') || 'application/json';
      }
      if (!body) return Response.json({ error: { message: '请求内容不能为空。' } }, { status: 400 });
    }

    upstreamStarted = true;
    const upstreamURL = useBetaInteractions ? `${base.replace(/\/v1(?:beta)?$/, '')}/v1beta/interactions` : `${base}/${path}`;
    const upstream = await fetch(upstreamURL, {
      method: request.method,
      headers: upstreamHeaders,
      body,
      signal: AbortSignal.any([request.signal, timeout]),
    });
    if (!upstream.ok && reservedKind && reservedOwner) {
      await refundGeneration(reservedOwner, reservedKind);
    }
    const upstreamError = await upstreamErrorResponse(upstream, useBetaInteractions ? 'videos' : path);
    if (upstreamError) return upstreamError;

    const headers = new Headers({
      'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    });
    if (path === 'videos' && upstream.ok) {
      const video = await upstream.json();
      if (typeof video.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(video.id)) return Response.json({ error: { message: '服务未返回有效视频任务。' } }, { status: 502 });
      await db.insert(VideoJob).values({ id: video.id, owner, createdAt: Date.now() });
      return Response.json(video, { status: upstream.status, headers });
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    if (error instanceof ClientIPError) return Response.json({ error: { message: error.message } }, { status: 400 });
    if (!upstreamStarted) {
      console.error('Generation policy failed:', error);
      return Response.json({ error: { message: '账号或额度服务暂不可用，请稍后重试。' } }, { status: 503 });
    }
    if (reservedKind && reservedOwner) await refundGeneration(reservedOwner, reservedKind);
    const message = timeout.aborted ? '上游请求超时，请稍后重试。' : error instanceof Error && error.name === 'AbortError' ? '请求已停止。' : '暂时无法连接 AI 服务，请检查网络或服务配置。';
    return Response.json({ error: { message } }, { status: 502 });
  }
};
