// GitHub OAuth 仅在服务端使用。浏览器只会被重定向到 GitHub 授权页，
// 永远接触不到 client secret 或 access token。
import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { Agent, ProxyAgent, fetch as undiciFetch } from 'undici';
import { setting } from './settings';

export const GITHUB_AUTHORIZE = 'https://github.com/login/oauth/authorize';
export const GITHUB_TOKEN = 'https://github.com/login/oauth/access_token';
export const GITHUB_USER = 'https://api.github.com/user';
export const GITHUB_EMAILS = 'https://api.github.com/user/emails';
export const STATE_COOKIE = 'olai_oauth_state';
export const STATE_PATH = '/api/auth/github';

export type GithubErrorCode = 'config' | 'network' | 'token' | 'profile' | 'email';
export class GithubAuthError extends Error {
  constructor(readonly code: GithubErrorCode, options?: { cause?: unknown }) { super(code, options); }
}

export function githubEnabled(): boolean {
  return Boolean(setting('GITHUB_CLIENT_ID') && setting('GITHUB_CLIENT_SECRET'));
}

/** 公开站点地址；反向代理部署时必须配置 SITE_ORIGIN，否则回调地址会对不上。 */
export function siteOrigin(requestOrigin: string): string {
  return (setting('SITE_ORIGIN').trim() || requestOrigin).replace(/\/$/, '');
}

export function callbackURL(requestOrigin: string): string {
  return `${siteOrigin(requestOrigin)}/api/auth/github/callback`;
}

export function authorizeURL(requestOrigin: string, state: string): string {
  const url = new URL(GITHUB_AUTHORIZE);
  url.searchParams.set('client_id', setting('GITHUB_CLIENT_ID'));
  url.searchParams.set('redirect_uri', callbackURL(requestOrigin));
  url.searchParams.set('scope', 'read:user user:email');
  url.searchParams.set('state', state);
  url.searchParams.set('allow_signup', 'true');
  return url.toString();
}

/** 状态值同时携带可选的邀请码，回调时用于建立邀请关系。 */
export function encodeState(inviteCode = ''): string {
  const code = inviteCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  return `${randomBytes(16).toString('hex')}${code ? `:${code}` : ''}`;
}
export function decodeState(value: string | undefined): { state: string; inviteCode: string } {
  const [state = '', inviteCode = ''] = (value || '').split(':');
  return { state, inviteCode };
}

/**
 * 服务器直连 github.com 可能被网络阻断，而浏览器常用的系统代理 Node 默认不会使用。
 * GITHUB_PROXY（或 HTTPS_PROXY / https_proxy）可指定代理，所有 GitHub 请求都走它；
 * 没有代理时可用 GITHUB_RESOLVE_IP 指定一个可访问的 github.com 地址（仅服务端，
 * 不改系统 hosts，TLS 仍按 github.com 证书校验）。地址会缓存复用连接池。
 */
const dispatchers = new Map<string, Agent | ProxyAgent>();

function dispatcherFor(url: string): Agent | ProxyAgent | undefined {
  const proxy = (setting('GITHUB_PROXY') || setting('HTTPS_PROXY') || setting('https_proxy')).trim();
  const resolveIp = setting('GITHUB_RESOLVE_IP').trim();
  const useIp = !proxy && resolveIp && new URL(url).hostname === 'github.com';
  const key = proxy ? `proxy:${proxy}` : useIp ? `ip:${resolveIp}` : '';
  if (!key) return undefined;
  let dispatcher = dispatchers.get(key);
  if (!dispatcher) {
    if (proxy) {
      dispatcher = new ProxyAgent(proxy);
    } else {
      const address = resolveIp;
      const family = isIP(address) === 6 ? 6 : 4;
      dispatcher = new Agent({
        connect: {
          // Node 的 Happy Eyeballs 会以 all: true 调用 lookup，此时必须返回地址数组。
          lookup: (_hostname, options, callback) => {
            if ((options as { all?: boolean }).all) return callback(null, [{ address, family }] as any);
            return callback(null, address, family);
          },
        },
      });
    }
    dispatchers.set(key, dispatcher);
  }
  return dispatcher;
}

async function githubJSON(url: string, init: { method?: string; headers: Record<string, string>; body?: string }, signal: AbortSignal): Promise<{ status: number; data: any }> {
  const dispatcher = dispatcherFor(url);
  const request = { method: init.method, headers: init.headers, body: init.body, signal } as const;
  const response = await (async () => {
    try {
      // 没有配置代理/固定 IP 时使用全局 fetch，便于测试替换和复用运行时能力。
      return dispatcher
        ? await undiciFetch(url, { ...request, dispatcher })
        : await fetch(url, request);
    } catch (error) {
      // 服务器无法直连 github.com（代理不可用、DNS 或超时）时统一归为 network，
      // 保留原始 cause 便于从日志区分是代理连不上还是解析失败。
      throw new GithubAuthError('network', { cause: error });
    }
  })();
  let data: any = null;
  try { data = await response.json(); } catch { /* Keep null for non-JSON responses. */ }
  return { status: response.status, data };
}

export async function githubAccessToken(code: string, requestOrigin: string, signal: AbortSignal): Promise<string> {
  if (!githubEnabled()) throw new GithubAuthError('config');
  const result = await githubJSON(GITHUB_TOKEN, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: setting('GITHUB_CLIENT_ID'), client_secret: setting('GITHUB_CLIENT_SECRET'),
      code, redirect_uri: callbackURL(requestOrigin),
    }).toString(),
  }, signal);
  if (result.status !== 200 || typeof result.data?.access_token !== 'string' || !result.data.access_token) throw new GithubAuthError('token');
  return result.data.access_token;
}

export interface GithubProfile { id: string; login: string; email: string }

/** 只接受 GitHub 标记为已验证的邮箱，优先主邮箱。 */
export async function githubProfile(token: string, signal: AbortSignal): Promise<GithubProfile> {
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' };
  const [userResult, emailsResult] = await Promise.all([
    githubJSON(GITHUB_USER, { headers }, signal),
    githubJSON(GITHUB_EMAILS, { headers }, signal),
  ]);
  if (userResult.status !== 200 || emailsResult.status !== 200) throw new GithubAuthError('profile');
  const user = userResult.data, emails = emailsResult.data;
  const list = Array.isArray(emails) ? emails : [];
  const verified = list.filter((item: { email?: unknown; verified?: unknown }) => typeof item?.email === 'string' && item.verified === true);
  const primary = verified.find((item: { primary?: unknown }) => item.primary === true) ?? verified[0];
  if (!user?.id || typeof user.login !== 'string' || !primary) throw new GithubAuthError('email');
  return { id: String(user.id), login: user.login, email: String(primary.email).trim().toLowerCase() };
}
