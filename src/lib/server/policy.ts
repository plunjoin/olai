import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import type { MediaKind } from '../types';

export function env(name: string, fallback = ''): string {
  return process.env[name] ?? import.meta.env[name] ?? fallback;
}
function limitFromEnv(name: string, fallback: string): number {
  const raw = env(name, fallback);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error('每日额度环境变量必须是非负整数。');
  return Number(raw);
}
export function dailyLimit(loggedIn: boolean): number {
  return limitFromEnv(loggedIn ? 'USER_DAILY_GENERATION_LIMIT' : 'GUEST_DAILY_GENERATION_LIMIT', loggedIn ? '15' : '1');
}
/** 对话每日额度：游客按 IP、登录用户按账号；0 表示停用对话。 */
export function chatDailyLimit(loggedIn: boolean): number {
  return limitFromEnv(loggedIn ? 'USER_DAILY_CHAT_LIMIT' : 'GUEST_DAILY_CHAT_LIMIT', '100');
}
/** 同一 IP 每分钟允许的对话请求数；0 表示不限速。 */
export function chatRateLimit(): number {
  return limitFromEnv('CHAT_RATE_LIMIT', '30');
}
/** 同一 IP 同时进行的对话请求上限；0 表示不限制并发。 */
export function chatConcurrencyLimit(): number {
  return limitFromEnv('CHAT_CONCURRENT_LIMIT', '20');
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

/** Public operations determine quota buckets; provider identifiers are never client input. */
export function generationKind(path: string, payload: Record<string, unknown>): MediaKind | null {
  if ('model' in payload) throw new Error('请求的创作参数不受支持。');
  if (path === 'generate/image') return 'image';
  if (path === 'generate/music') return 'music';
  if (path === 'generate/video') return 'video';
  if (path === 'chat/completions' && ['chat', 'compose-song', 'align-lyrics', 'workflow-script', 'workflow-shots'].includes(String(payload.action || 'chat'))) return null;
  throw new Error('接口路径或方法不受支持。');
}
