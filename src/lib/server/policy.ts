import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { DEFAULT_SETTINGS, type MediaKind } from '../types';

export function env(name: string, fallback = ''): string {
  return process.env[name] ?? import.meta.env[name] ?? fallback;
}
export function dailyLimit(loggedIn: boolean): number {
  const raw = env(loggedIn ? 'USER_DAILY_GENERATION_LIMIT' : 'GUEST_DAILY_GENERATION_LIMIT', loggedIn ? '15' : '1');
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error('每日额度环境变量必须是非负整数。');
  return Number(raw);
}
export function dayKey(now = Date.now()): string {
  return new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
}
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export class ClientIPError extends Error {}
export function clientIP(request: Request, address: string): string {
  // Only enable behind a proxy which replaces this header and blocks direct access.
  const trustProxy = env('TRUST_PROXY') === 'true';
  // The Node adapter itself reads X-Forwarded-For into clientAddress. Reject
  // that header when untrusted so it cannot change the guest quota identity.
  if (!trustProxy && request.headers.has('x-forwarded-for')) throw new ClientIPError('请配置可信代理后再使用转发 IP 标头。');
  const forwarded = trustProxy ? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() : undefined;
  const ip = forwarded || address;
  if (!isIP(ip)) throw new ClientIPError('无法确定客户端 IP，请检查代理配置。');
  return ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip.toLowerCase();
}
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin || origin === 'null') return false;
  try {
    const source = new URL(origin);
    if (!['http:', 'https:'].includes(source.protocol) || origin !== source.origin) return false;
    const configured = env('SITE_ORIGIN').trim();
    if (configured) return source.origin === new URL(configured).origin;
    const url = new URL(request.url);
    // The Node adapter can normalize an unlisted host to localhost and drop
    // its port. Host still carries the browser's actual destination authority.
    // Forwarded headers are deliberately excluded; proxies use SITE_ORIGIN.
    const host = request.headers.get('host');
    if (!host) return source.origin === url.origin;
    const destination = new URL(`${url.protocol}//${host}`);
    if (host !== destination.host || destination.username || destination.password) return false;
    return source.origin === destination.origin;
  } catch { return false; }
}
export function generationKind(path: string, payload: Record<string, unknown>): MediaKind | null {
  if (path === 'videos') return 'video';
  if (path.startsWith('images/')) return 'image';
  if (path.startsWith('audio/')) return 'music';
  if (path !== 'chat/completions' && path !== 'interactions') throw new Error('接口路径或方法不受支持。');
  // Official media interactions share their respective generation quotas.
  if (path === 'interactions') {
    if (payload.model === DEFAULT_SETTINGS.imageModel || payload.model === env('AI_IMAGE_MODEL', DEFAULT_SETTINGS.imageModel)) return 'image';
    if (payload.model === DEFAULT_SETTINGS.videoModel || payload.model === env('AI_VIDEO_MODEL', DEFAULT_SETTINGS.videoModel)) return 'video';
    throw new Error('请求的创作引擎不受支持。');
  }
  for (const [kind, key, variable] of [
    ['image', 'imageModel', 'AI_IMAGE_MODEL'], ['music', 'musicModel', 'AI_MUSIC_MODEL'],
    ['video', 'videoModel', 'AI_VIDEO_MODEL'],
  ] as const) {
    if (payload.model === DEFAULT_SETTINGS[key] || payload.model === env(variable, DEFAULT_SETTINGS[key])) return kind;
  }
  if (payload.model === DEFAULT_SETTINGS.chatModel || payload.model === env('AI_CHAT_MODEL', DEFAULT_SETTINGS.chatModel)) return null;
  throw new Error('请求的创作引擎不受支持。');
}
