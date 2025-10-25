import type { APIRoute } from 'astro';
import { DEFAULT_SETTINGS } from '../../lib/types';

export const prerender = false;
const allowed = /^(models|chat\/completions|images\/[a-zA-Z0-9_-]+|audio\/[a-zA-Z0-9_-]+|videos(?:\/[a-zA-Z0-9_-]+(?:\/content)?)?)$/;

export const ALL: APIRoute = async ({ request, params }) => {
  const path = params.path ?? '';
  if (!allowed.test(path) || !['GET', 'POST'].includes(request.method)) {
    return Response.json({ error: { message: '接口路径或方法不受支持。' } }, { status: 404 });
  }

  const origin = request.headers.get('origin');
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || new URL(request.url).host;
      if (originHost !== host && origin !== new URL(request.url).origin) {
        return Response.json({ error: { message: '不允许跨站调用。' } }, { status: 403 });
      }
    } catch {
      return Response.json({ error: { message: '无效的 Origin 标头。' } }, { status: 403 });
    }
  }

  const apiKey = process.env.AI_API_KEY || (import.meta.env.AI_API_KEY as string | undefined);
  const key = request.headers.get('authorization') || (apiKey ? `Bearer ${apiKey}` : '');
  if (!key) return Response.json({ error: { message: '请先在设置中填写 API Key，或由部署者配置服务端密钥。' } }, { status: 401 });
  const base = (process.env.AI_API_BASE_URL || import.meta.env.AI_API_BASE_URL || 'https://ai.bllii.com/v1').replace(/\/$/, '');
  const timeout = AbortSignal.timeout(180_000);

  try {
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
    }

    const upstream = await fetch(`${base}/${path}`, {
      method: request.method,
      headers: upstreamHeaders,
      body,
      signal: AbortSignal.any([request.signal, timeout]),
    });

    const headers = new Headers({
      'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    });
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    const message = timeout.aborted ? '上游请求超时，请稍后重试。' : error instanceof Error && error.name === 'AbortError' ? '请求已停止。' : '暂时无法连接 AI 服务，请检查网络或服务配置。';
    return Response.json({ error: { message } }, { status: 502 });
  }
};
