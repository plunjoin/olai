import { t } from './i18n';

export interface Account { id: string; email: string; name?: string | null; avatar?: string | null }
export interface PointPrices { image: Record<string, number>; video: Record<string, number>; musicPerMinute: number; chatPerMessage: number }
export interface AccountState {
  user: Account | null;
  generationLimit: number;
  chatLimit?: number;
  mediaStorage?: 'oss' | 'local';
  shortFilm?: boolean;
  points?: number;
  inviteCode?: string;
  prices?: PointPrices;
  githubLogin?: boolean;
  googleLogin?: boolean;
  pendingVerification?: boolean;
  verified?: boolean;
  passwordReset?: boolean;
  message?: string;
}
export type AccountAction = 'me' | 'login' | 'register' | 'logout' | 'forgot' | 'reset' | 'verify' | 'resend' | 'profile';
export async function accountRequest(action: AccountAction, input?: { email?: string; password?: string; inviteCode?: string; token?: string; name?: string; avatar?: string | null }): Promise<AccountState> {
  const response = await fetch(`/api/auth/${action}`, { credentials: 'same-origin',
    ...(action === 'me' ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input || {}) }),
  });
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error(t('账号接口未返回 JSON，请检查 Go 服务是否启动以及 /api 路由的部署配置。'));
  }
  let data;
  try { data = await response.json(); } catch { throw new Error(t('账号接口返回的数据格式无效，请检查服务配置。')); }
  if (!response.ok) throw new Error(t(data?.error?.message || '账号服务暂不可用。'));
  const pending = data?.pendingVerification === true;
  if (!data || !Object.hasOwn(data, 'user') || (data.user !== null && (!data.user || typeof data.user.id !== 'string' || typeof data.user.email !== 'string'
    || (data.user.name !== undefined && data.user.name !== null && typeof data.user.name !== 'string')
    || (data.user.avatar !== undefined && data.user.avatar !== null && typeof data.user.avatar !== 'string'))) || (action !== 'logout' && !Number.isSafeInteger(data.generationLimit)) || (data.chatLimit !== undefined && !Number.isSafeInteger(data.chatLimit))
    || (data.points !== undefined && !Number.isSafeInteger(data.points))
    || (data.inviteCode !== undefined && typeof data.inviteCode !== 'string')
    || (data.prices !== undefined && (typeof data.prices !== 'object' || data.prices === null))
    || (data.githubLogin !== undefined && typeof data.githubLogin !== 'boolean')
    || (data.googleLogin !== undefined && typeof data.googleLogin !== 'boolean')
    || (data.pendingVerification !== undefined && typeof data.pendingVerification !== 'boolean')
    || (data.verified !== undefined && typeof data.verified !== 'boolean')
    || (data.passwordReset !== undefined && typeof data.passwordReset !== 'boolean')
    || (data.message !== undefined && typeof data.message !== 'string')
    || (pending && data.user !== null)) {
    throw new Error(t('账号接口返回的数据格式无效，请检查服务配置。'));
  }
  return data;
}
