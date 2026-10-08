export interface Account { id: string; email: string }
export interface AccountState { user: Account | null; generationLimit: number }
export async function accountRequest(action: 'me' | 'login' | 'register' | 'logout', input?: { email: string; password: string }): Promise<AccountState> {
  const response = await fetch(`/api/auth/${action}`, { credentials: 'same-origin',
    ...(action === 'me' ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input || {}) }),
  });
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('账号接口未返回 JSON，请检查 Node 服务是否启动以及 /api 路由的部署配置。');
  }
  let data;
  try { data = await response.json(); } catch { throw new Error('账号接口返回的数据格式无效，请检查服务配置。'); }
  if (!response.ok) throw new Error(data?.error?.message || '账号服务暂不可用。');
  if (!data || !Object.hasOwn(data, 'user') || (data.user !== null && (!data.user || typeof data.user.id !== 'string' || typeof data.user.email !== 'string')) || (action !== 'logout' && !Number.isSafeInteger(data.generationLimit))) {
    throw new Error('账号接口返回的数据格式无效，请检查服务配置。');
  }
  return data;
}
