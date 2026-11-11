import type { AudioEngineMode, ImageEngineMode, Message } from './types';
import { base64ToBytes, isRiffWav, parseAudioDataUri } from './audio';
import type { VideoEngineMode } from './video';
import { registerStoredBlob } from './mediaStorage';

export function publicServiceError(message: string, status?: number): string {
  if (status === 429 || /rate[_\s-]?limit|quota|额度|请求.*(?:受限|过多|频繁)/i.test(message)) {
    return '上游创作服务额度已用完或请求受限，请稍后重试。';
  }
  return /[A-Za-z]{3}|模型|密钥/i.test(message)
    ? '创作服务暂时无法完成请求，请重试或检查服务连接。'
    : message;
}

export async function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.delete('Authorization');
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api/${path}`, { ...init, headers, credentials: 'same-origin' });
  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    try { const body = await response.json(); message = body.error?.message || body.message || message; } catch { /* Keep HTTP error. */ }
    const err = new Error(publicServiceError(message, response.status)) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }
  return response;
}

// Decode complete SSE events only; chunks may split UTF-8 bytes, lines, or JSON.
export async function consumeSSE(body: ReadableStream<Uint8Array>, onText: (text: string) => void) {
  const reader = body.getReader(); const decoder = new TextDecoder();
  let buffer = ''; let doneEvent = false; let content = '';
  const emit = (text: string) => {
    content += text;
    const error = content.match(/(?:^|\n)\[Error\]\s*(.*)/s);
    if (error) throw new Error(publicServiceError(error[1] || '生成失败，请重试。'));
    onText(text);
  };
  const consume = (event: string) => {
    const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data) return;
    if (data.trim() === '[DONE]') { doneEvent = true; return; }
    let parsed;
    try { parsed = JSON.parse(data); } catch { throw new Error('服务返回了无法解析的流式数据，请重试。'); }
    if (parsed.error) throw new Error(publicServiceError(parsed.error.message || '生成失败'));
    const delta = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content;
    if (typeof delta === 'string') emit(delta);
    else if (Array.isArray(delta)) for (const part of delta) if (part.text) emit(part.text);
  };
  try {
    while (!doneEvent) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replace(/\r\n/g, '\n');
      let split;
      while ((split = buffer.indexOf('\n\n')) >= 0) {
        consume(buffer.slice(0, split)); buffer = buffer.slice(split + 2);
        if (doneEvent) break;
      }
      if (done) { if (buffer.trim() && !doneEvent) consume(buffer); break; }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function chat(messages: Message[], temperature: number, signal: AbortSignal, onText: (text: string) => void) {
  const response = await request('chat/completions', { method: 'POST', signal,
    body: JSON.stringify({ action: 'chat', stream: true, temperature, messages: messages.filter(m => m.content && !m.error).map(({role,content}) => ({role,content})) }),
  });
  if (response.headers.get('content-type')?.includes('application/json')) {
    const json = await response.json();
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content) throw new Error('服务未返回对话内容。');
    onText(content); return;
  }
  if (!response.body) throw new Error('服务未返回响应流。');
  await consumeSSE(response.body, onText);
}

export interface ExtractedMedia {
  url?: string;
  base64?: string;
  mime: string;
  alt?: string;
}

/**
 * 从聊天响应文本或 Markdown 中提取图片链接（支持 data: URI 与 HTTP/HTTPS 链接）
 */
export function extractImagesFromContent(content: string): ExtractedMedia[] {
  if (!content || typeof content !== 'string') return [];
  const results: ExtractedMedia[] = [];
  const matchedLinks = new Set<string>();

  // 1. 标准 Markdown 图片格式：![alt](url 或 data:...)
  const mdRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = mdRegex.exec(content)) !== null) {
    const alt = match[1] || '';
    const link = match[2].trim();
    matchedLinks.add(link);

    if (link.startsWith('data:')) {
      const comma = link.indexOf(',');
      if (comma !== -1) {
        const meta = link.slice(5, comma);
        const base64 = link.slice(comma + 1).replace(/\s+/g, '');
        const mimeMatch = meta.match(/^(image\/[a-zA-Z0-9.+_-]+)/);
        const mime = mimeMatch ? mimeMatch[1] : 'image/png';
        results.push({ base64, mime, alt });
      }
    } else if (/^https?:\/\//i.test(link)) {
      results.push({ url: link, mime: 'image/png', alt });
    }
  }

  // 2. 独立 data:image/... Base64 链接提取
  if (results.length === 0) {
    const dataUriRegex = /data:(image\/[a-zA-Z0-9.+_-]+);base64,([A-Za-z0-9+/=]+)/g;
    while ((match = dataUriRegex.exec(content)) !== null) {
      results.push({
        mime: match[1],
        base64: match[2].replace(/\s+/g, ''),
      });
    }
  }

  // 3. 独立 HTTP/HTTPS 图片地址提取
  if (results.length === 0) {
    const plainUrlRegex = /https?:\/\/[^\s<>"')]+?\.(?:png|jpe?g|webp|gif|svg)(?:\?[^\s<>"')]*)?/gi;
    while ((match = plainUrlRegex.exec(content)) !== null) {
      if (!matchedLinks.has(match[0])) {
        results.push({
          url: match[0],
          mime: 'image/png',
        });
      }
    }
  }

  return results;
}

/**
 * 从聊天响应文本或 Markdown 中提取音频链接（支持 data:audio/... 与 HTTP/HTTPS 音频链接）
 * 保留 data:audio/pcm 的 MIME 与采样率，交给 base64Blob 封装为 WAV。
 */
export function extractAudiosFromContent(content: string): ExtractedMedia[] {
  if (!content || typeof content !== 'string') return [];
  const results: ExtractedMedia[] = [];
  const matchedLinks = new Set<string>();

  // 1. 标准 Markdown 图片/媒体格式：![alt](url 或 data:...)
  const mdRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = mdRegex.exec(content)) !== null) {
    const alt = match[1] || '';
    const link = match[2].trim();
    matchedLinks.add(link);

    if (link.startsWith('data:')) {
      if (link.startsWith('data:audio/')) {
        try {
          const comma = link.indexOf(',');
          if (comma === -1) throw new Error('无效的音频数据');
          const base64 = link.slice(comma + 1).replace(/\s+/g, '');
          results.push({
            base64,
            mime: link.slice(5, comma).replace(/;base64$/i, ''),
            alt: alt || 'audio',
          });
        } catch {
          results.push({ mime: 'audio/wav', alt });
        }
      }
    } else if (/^https?:\/\/[^\s<>"')]+?\.(?:mp3|wav|ogg|aac|m4a|flac)(?:\?[^\s<>"')]*)?/i.test(link)) {
      results.push({ url: link, mime: 'audio/mpeg', alt });
    }
  }

  // 2. 独立 data:audio/... Base64 链接提取
  if (results.length === 0) {
    const dataUriRegex = /data:(audio\/[a-zA-Z0-9.+;=_-]+);base64,([A-Za-z0-9+/=]+)/g;
    while ((match = dataUriRegex.exec(content)) !== null) {
      try {
        results.push({
          mime: match[1],
          base64: match[2].replace(/\s+/g, ''),
        });
      } catch {
        results.push({
          mime: 'audio/wav',
          base64: match[2].replace(/\s+/g, ''),
        });
      }
    }
  }

  // 3. 独立 HTTP/HTTPS 音频地址提取
  if (results.length === 0) {
    const plainUrlRegex = /https?:\/\/[^\s<>"')]+?\.(?:mp3|wav|ogg|aac|m4a|flac)(?:\?[^\s<>"')]*)?/gi;
    while ((match = plainUrlRegex.exec(content)) !== null) {
      if (!matchedLinks.has(match[0])) {
        results.push({
          url: match[0],
          mime: 'audio/mpeg',
        });
      }
    }
  }

  return results;
}

export function extractVideosFromContent(content: string): ExtractedMedia[] {
  const links = [...content.matchAll(/!\[[^\]]*\]\(([^)]+)\)|(?:https?:\/\/[^\s<>"')]+\.(?:mp4|webm|mov)(?:\?[^\s<>"')]*)?)|(?:data:video\/[\w.+-]+;base64,[A-Za-z0-9+/=]+)/gi)];
  return links.map(match => match[1] || match[0]).filter(url => /^https?:\/\//.test(url) || url.startsWith('data:video/')).map(url => {
    const data = url.match(/^data:(video\/[\w.+-]+);base64,(.+)$/);
    return data ? { base64: data[2], mime: data[1] } : { url, mime: /\.webm(?:\?|$)/i.test(url) ? 'video/webm' : 'video/mp4' };
  });
}

export function mediaOutputs(json: any, kind: 'image' | 'music' | 'video'): { url?: string; base64?: string; mime: string }[] {
  if (!json) return [];

  // Gemini Interactions returns generated media in model_output steps.
  if ((kind === 'image' || kind === 'video') && Array.isArray(json.steps)) {
    return json.steps.filter((step: any) => step?.type === 'model_output')
      .flatMap((step: any) => Array.isArray(step.content) ? step.content : [])
      .filter((part: any) => part?.type === kind && (part.data || part.uri))
      .map((part: any) => ({ base64: part.data, url: part.uri, mime: part.mime_type || (kind === 'video' ? 'video/mp4' : 'image/jpeg') }));
  }

  // 原生聊天模式 (POST /v1/chat/completions) 输出提取
  if (json.choices && Array.isArray(json.choices)) {
    const chatOutputs: { url?: string; base64?: string; mime: string }[] = [];
    for (const choice of json.choices) {
      const message = choice?.message ?? choice?.delta;
      if (kind === 'image' && Array.isArray(message?.images)) {
        for (const image of message.images) {
          const url = image?.image_url?.url || image?.url;
          if (typeof url === 'string') chatOutputs.push({ url, mime: image.mime_type || 'image/png' });
        }
      }
      if (kind === 'music' && message?.audio?.data) {
        const format = message.audio.format || 'wav';
        chatOutputs.push({ base64: message.audio.data, mime: message.audio.mime_type || (format === 'mp3' ? 'audio/mpeg' : `audio/${format}`) });
      }
      if (kind === 'video' && Array.isArray(message?.videos)) {
        for (const video of message.videos) {
          const url = video?.video_url?.url || video?.url;
          if (typeof url === 'string') chatOutputs.push({ url, mime: video.mime_type || 'video/mp4' });
        }
      }
      const content = choice?.message?.content ?? choice?.delta?.content;
      if (typeof content === 'string') {
        if (kind === 'image') {
          chatOutputs.push(...extractImagesFromContent(content));
        } else if (kind === 'video') {
          chatOutputs.push(...extractVideosFromContent(content));
        } else {
          chatOutputs.push(...extractAudiosFromContent(content));
        }
      } else if (Array.isArray(content)) {
        for (const part of content) {
          if (part?.text) {
            if (kind === 'image') chatOutputs.push(...extractImagesFromContent(part.text));
            else if (kind === 'video') chatOutputs.push(...extractVideosFromContent(part.text));
            else chatOutputs.push(...extractAudiosFromContent(part.text));
          } else if (kind === 'image' && part?.image_url?.url) {
            chatOutputs.push({ url: part.image_url.url, mime: 'image/png' });
          } else if (kind === 'video' && part?.video_url?.url) {
            chatOutputs.push({ url: part.video_url.url, mime: 'video/mp4' });
          }
        }
      }
    }
    if (chatOutputs.length > 0) return chatOutputs;
  }

  // upstream 模式 (POST /v1/images/generations 或 /v1/audio/speech) 输出提取
  const rows = Array.isArray(json.data) ? json.data : Array.isArray(json.output) ? json.output : [json.output || json];
  return rows.map((row: any) => ({
    url: typeof row === 'string' ? row : row.url || row.video_url || row.audio_url || row.image_url || row.audio?.url,
    base64: row.b64_json || row.video_base64 || row.audio_base64 || row.audio?.data,
    mime: row.mime_type || (kind === 'image' ? 'image/png' : kind === 'video' ? 'video/mp4' : 'audio/mpeg'),
  })).filter((row: { url?: string; base64?: string }) => row.url || row.base64);
}

export interface GenerateImageOptions {
  prompt: string; mode?: ImageEngineMode; size?: string; aspectRatio?: string; imageSize?: string;
  reasoningEffort?: string; n?: number; signal?: AbortSignal; context?: Record<string, unknown>;
}
export function generateImage({ prompt, mode, size, aspectRatio = 'auto', imageSize = '1K', reasoningEffort = 'medium', signal, context }: GenerateImageOptions): Promise<Response> {
  return request('generate/image', { method: 'POST', signal, body: JSON.stringify({ prompt, mode, size, aspectRatio, imageSize, reasoningEffort, ...context }) });
}
export interface GenerateAudioOptions {
  prompt: string; mode?: AudioEngineMode; musicPath?: string; voice?: string; speed?: number;
  responseFormat?: string; extra?: Record<string, unknown>; duration?: number; song?: import('./types').SongDraft;
  signal?: AbortSignal; context?: Record<string, unknown>;
}
export function generateAudio({ prompt, duration, song, voice, speed, responseFormat, signal, context }: GenerateAudioOptions): Promise<Response> {
  return request('generate/music', { method: 'POST', signal, body: JSON.stringify({ prompt, duration, song, voice, speed, responseFormat, ...context }) });
}
export async function generateVideo({ prompt, options, signal, inputImage, extendFrom, context }: {
  prompt: string; options: Record<string, string | number>; signal?: AbortSignal; mode?: VideoEngineMode;
  inputImage?: Blob; extendFrom?: string; context?: Record<string, unknown>;
}): Promise<Response> {
  let inputReference: string | undefined;
  if (inputImage) {
    const bytes = new Uint8Array(await inputImage.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    inputReference = btoa(binary);
  }
  return request('generate/video', { method: 'POST', signal, body: JSON.stringify({ prompt, options, inputReference, extendFrom, ...context }) });
}
export async function videoContent(id: string, signal?: AbortSignal): Promise<Blob> {
  const response = await request(`videos/${encodeURIComponent(id)}/content`, { signal });
  const mime = response.headers.get('content-type') || '';
  if (!mime.startsWith('video/') && !mime.startsWith('application/octet-stream')) throw new Error('服务未返回可播放的视频文件。');
  const blob = await response.blob();
  if (!blob.size) throw new Error('视频内容为空。');
  const result = mime.startsWith('video/') ? blob : new Blob([blob], { type: 'video/mp4' });
  registerStoredBlob(result, response.headers.get('x-olai-media-url'));
  return result;
}

export function safeMediaURL(url: string) {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  const parsed = new URL(url, origin);
  if (['https:', 'http:', 'blob:'].includes(parsed.protocol) || /^data:(image|audio|video)\//.test(url)) return parsed.href;
  throw new Error('服务返回了不支持的媒体链接。');
}

export function base64Blob(data: string, mime: string) {
  const bytes = base64ToBytes(data);
  if (isRiffWav(bytes)) {
    return new Blob([bytes as unknown as BlobPart], { type: 'audio/wav' });
  }
  if (mime.includes('pcm')) {
    return parseAudioDataUri(`data:${mime};base64,${data}`).blob;
  }
  const isMp3 = bytes.length >= 3 && (
    (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) ||
    (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  );
  const resolvedMime = isMp3 ? 'audio/mpeg' : (mime && !mime.includes('octet-stream') ? mime : (mime.startsWith('image/') ? mime : mime.startsWith('video/') ? mime : 'audio/wav'));
  return new Blob([bytes as unknown as BlobPart], { type: resolvedMime });
}
