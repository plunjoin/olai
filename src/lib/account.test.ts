import { afterEach, expect, it, vi } from 'vitest';
import { accountRequest } from './account';

afterEach(() => vi.unstubAllGlobals());
it('explains an HTML response without trying to parse the error page as JSON', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<noscript>请启用 JavaScript 以使用 Olai。</noscript>', { status: 500, headers: { 'Content-Type': 'text/html' } })));
  await expect(accountRequest('me')).rejects.toThrow('账号接口未返回 JSON');
});
it('shows the server error for invalid database configuration', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { message: '请检查数据库配置' } }, { status: 503 })));
  await expect(accountRequest('me')).rejects.toThrow('请检查数据库配置');
});
it('accepts a guest account response and rejects malformed successful JSON', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ user: null, generationLimit: 1 })).mockResolvedValueOnce(Response.json({}));
  vi.stubGlobal('fetch', fetch);
  await expect(accountRequest('me')).resolves.toEqual({ user: null, generationLimit: 1 });
  await expect(accountRequest('me')).rejects.toThrow('数据格式无效');
});
