export interface Account { id: string; email: string }
export interface AccountState { user: Account | null; generationLimit: number }
export async function accountRequest(action: 'me' | 'login' | 'register' | 'logout', input?: { email: string; password: string }): Promise<AccountState> {
  const response = await fetch(`/api/auth/${action}`, { credentials: 'same-origin',
    ...(action === 'me' ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input || {}) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || '账号服务暂不可用。');
  return data;
}
