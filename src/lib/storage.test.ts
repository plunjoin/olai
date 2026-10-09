import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const local = vi.hoisted(() => ({ conversations: [] as any[], assets: [] as any[], workflows: [] as any[] }));
vi.mock('idb', () => ({ openDB: vi.fn(async () => ({
  getAll: async (store: 'conversations' | 'assets' | 'workflows') => local[store],
  transaction: (store: 'conversations' | 'assets' | 'workflows') => ({
    store: {
      get: async (id: string) => local[store].find(row => row.id === id),
      put: async (row: any) => { local[store] = local[store].map(current => current.id === row.id ? row : current); },
    }, done: Promise.resolve(),
  }),
})) }));

beforeEach(() => {
  vi.resetModules(); local.conversations = []; local.assets = []; local.workflows = [];
  vi.stubGlobal('window', {}); vi.stubGlobal('indexedDB', {}); vi.stubGlobal('navigator', {});
});
afterEach(() => vi.unstubAllGlobals());
const asset = (id: string) => ({ id, kind: 'video', prompt: id, status: 'completed', createdAt: 1, options: {} });

it('initializes account storage without attempting a guest upload', async () => {
  local.assets = [asset('broken')];
  const fetch = vi.fn().mockResolvedValue(Response.json({ user: { id: 'user', email: 'u@example.com' }, generationLimit: 15 }));
  vi.stubGlobal('fetch', fetch);
  const storage = await import('./storage');
  await expect(storage.initializeStorage()).resolves.toMatchObject({ user: { id: 'user' } });
  expect(fetch).toHaveBeenCalledTimes(1); expect(storage.storageMode).toBe('cloud');
});

it('keeps failed guest files, continues subsequent imports and retries without duplicating successful ones', async () => {
  local.assets = [asset('broken'), asset('good')];
  const fetch = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockImplementation(async () => Response.json({ ok: true }));
  vi.stubGlobal('fetch', fetch);
  const storage = await import('./storage');
  const report = await storage.syncGuestRecords('user');
  expect(report.synced.assets).toEqual(['good']); expect(report.failures).toHaveLength(1);
  expect(report.failures[0]).toContain('仍保留在本地');
  expect(local.assets[0].linkedAccountId).toBeUndefined(); expect(local.assets[1].linkedAccountId).toBe('user');
  const retry = await storage.syncGuestRecords('user');
  expect(retry.synced.assets).toEqual(['broken']); expect(retry.failures).toEqual([]);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('rejects oversized media before encoding or uploading and explains timeouts while continuing', async () => {
  local.assets = [{ ...asset('large'), blob: { size: 49 * 1024 * 1024 } }, asset('timeout'), asset('good')];
  const fetch = vi.fn().mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError')).mockResolvedValue(Response.json({ ok: true }));
  vi.stubGlobal('fetch', fetch);
  const storage = await import('./storage');
  const report = await storage.syncGuestRecords('user');
  expect(report.failures[0]).toContain('64 MB'); expect(report.failures[1]).toContain('上传超时');
  expect(report.synced.assets).toEqual(['good']); expect(fetch).toHaveBeenCalledTimes(2);
  expect(local.assets[0].linkedAccountId).toBeUndefined();
});
