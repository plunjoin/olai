import { aiEnv, ALIGNMENT_SYSTEM_PROMPT, DEFAULT_SYSTEM_PROMPT, SERVER_MODELS, serverModel, SONG_SYSTEM_PROMPT } from './aiConfig';
import { mediaOutputs } from '../api';
import type { MediaKind } from '../types';

export const SERVICE_ERROR = '创作服务暂时无法完成请求，请稍后重试。';
export function publicUpstreamError(status: number): Response {
  const message = status === 429 ? '创作服务请求受限，请稍后重试。' : SERVICE_ERROR;
  return Response.json({ error: { message } }, { status: status >= 400 && status <= 599 ? status : 502, headers: { 'Cache-Control': 'no-store' } });
}
export function privateValues(extra: string[] = []): string[] {
  const prompts = [DEFAULT_SYSTEM_PROMPT, SONG_SYSTEM_PROMPT, ALIGNMENT_SYSTEM_PROMPT, aiEnv('AI_SYSTEM_PROMPT'), ...extra];
  return [...new Set([
    ...Object.values(SERVER_MODELS), ...(['chat', 'image', 'video', 'music'] as const).map(serverModel),
    ...Object.entries({ ...import.meta.env, ...process.env }).filter(([name]) => /(?:^|_)(?:API_?KEY|KEY|TOKEN|SECRET|PASSWORD)(?:$|_)/i.test(name)).map(([, value]) => String(value || '')),
    ...prompts, ...prompts.flatMap(value => value.split(/[\n。]/).filter(part => part.length >= 15)),
  ].filter(value => value.length >= 4))].sort((a, b) => b.length - a.length);
}
function redactLiterals(text: string, secrets: string[]): string {
  let output = text;
  for (const value of secrets) output = output.replace(new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[已隐藏]');
  return output;
}
export function redactText(text: string, secrets = privateValues()): string {
  return redactLiterals(text, secrets).replace(/\b(?:gemini|gemma|lyria|veo|claude|gpt|nano[-\s]?banana)[\w.\s-]*\b/gi, '[已隐藏]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[已隐藏]');
}
function safeMedia(value: string, secrets: string[]): string | undefined {
  if (/^data:(?:image|audio|video)\/[\w.+-]+(?:;[\w=.-]+)*;base64,[A-Za-z0-9+/=\s]+$/i.test(value)) return value;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return;
    if ([...url.searchParams.keys()].some(key => /key|token|secret|authorization|prompt|model/i.test(key))) return;
    if (redactText(decodeURIComponent(value), secrets) !== decodeURIComponent(value)) return;
    return value;
  } catch { return; }
}
export function publicJSON(json: any, kind: MediaKind | null, secrets: string[], taskId?: string): Record<string, unknown> {
  if (taskId) {
    const status = ['queued', 'pending', 'in_progress', 'processing', 'completed', 'failed'].includes(json?.status) ? json.status : 'pending';
    return { id: taskId, status, ...(status === 'failed' ? { error: { message: SERVICE_ERROR } } : {}) };
  }
  if (kind) {
    const outputs = mediaOutputs(json, kind).flatMap<{ b64_json?: string; url?: string; mime_type: string }>(output => {
      const mime = typeof output.mime === 'string' && /^(?:image|audio|video)\/[\w.+-]+(?:;[\w=.-]+)*$/.test(output.mime) && redactText(output.mime, secrets) === output.mime ? output.mime : kind === 'image' ? 'image/png' : kind === 'video' ? 'video/mp4' : 'audio/mpeg';
      if (output.base64 && /^[A-Za-z0-9+/=\s]+$/.test(output.base64)) return [{ b64_json: output.base64, mime_type: mime }];
      const url = output.url && safeMedia(output.url, secrets);
      return url ? [{ url, mime_type: mime }] : [];
    });
    if (!outputs.length) throw new Error('Invalid media response');
    return { data: outputs };
  }
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('Invalid response');
  return { choices: [{ message: { role: 'assistant', content: redactText(content, secrets) } }] };
}

// Parse SSE events instead of forwarding bytes: provider metadata, usage, tool
// data and error bodies must never reach the browser. Keep matching suffixes
// across events so splitting a secret over chunks cannot bypass literal filters.
export function publicSSE(body: ReadableStream<Uint8Array>, secrets: string[]): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const decoder = new TextDecoder(); const encoder = new TextEncoder();
  let buffer = '', pending = '', finished = false, emitted = 0;
  const protectedStrings = [...secrets, '[Error]', 'sk-', 'gemini', 'gemma', 'lyria', 'veo', 'claude', 'gpt', 'nano-banana', 'nano banana', 'nanobanana'];
  const emit = (controller: ReadableStreamDefaultController<Uint8Array>, text: string) => {
    if (text) { emitted++; controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`)); }
  };
  const flush = (controller: ReadableStreamDefaultController<Uint8Array>, final = false) => {
    if (pending.includes('[Error]')) throw new Error('Upstream stream error');
    // Replace complete literal secrets first; defer generic pattern redaction
    // until a trailing identifier is complete, otherwise its suffix could leak.
    pending = redactLiterals(pending, secrets);
    let keep = 0;
    if (!final) for (const value of protectedStrings) {
      const lower = value.toLowerCase();
      for (let length = Math.min(lower.length - 1, pending.length); length > keep; length--) {
        if (pending.toLowerCase().endsWith(lower.slice(0, length))) { keep = length; break; }
      }
    }
    if (!final) {
      const identifier = pending.match(/\b(?:gemini|gemma|lyria|veo|claude|gpt|nano[-\s]?banana|sk-)[\w.-]*$/i);
      if (identifier) keep = Math.max(keep, identifier[0].length);
    }
    emit(controller, redactText(pending.slice(0, pending.length - keep), secrets));
    pending = keep ? pending.slice(-keep) : '';
  };
  const finish = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    flush(controller, true); controller.enqueue(encoder.encode('data: [DONE]\n\n')); finished = true;
  };
  const event = (raw: string, controller: ReadableStreamDefaultController<Uint8Array>) => {
    const data = raw.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || finished) return;
    if (data.trim() === '[DONE]') { finish(controller); return; }
    const json = JSON.parse(data);
    if (json.error) throw new Error('Upstream stream error');
    const content = json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.message?.content;
    if (typeof content === 'string') pending += content;
    else if (Array.isArray(content)) pending += content.filter(part => typeof part?.text === 'string').map(part => part.text).join('');
    flush(controller);
  };
  return new ReadableStream({
    async pull(controller) {
      const before = emitted;
      try {
        while (!finished) {
          const { value, done } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          buffer = buffer.replace(/\r\n/g, '\n');
          if (buffer.length > 1024 * 1024) throw new Error('Oversized stream event');
          let boundary: number;
          while ((boundary = buffer.indexOf('\n\n')) >= 0 && !finished) { event(buffer.slice(0, boundary), controller); buffer = buffer.slice(boundary + 2); }
          if (done) { if (buffer.trim() && !finished) event(buffer, controller); if (!finished) finish(controller); }
          if (finished) { await reader.cancel().catch(() => {}); controller.close(); return; }
          // Keep reading metadata/partial events until there is public output.
          // Returning without enqueuing would leave a pending read stalled.
          if (emitted > before) return;
        }
      } catch {
        finished = true; pending = '';
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: { message: SERVICE_ERROR } })}\n\ndata: [DONE]\n\n`));
        controller.close(); await reader.cancel().catch(() => {});
      }
    },
    async cancel(reason) { finished = true; await reader.cancel(reason).catch(() => {}); },
  });
}
