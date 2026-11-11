import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const local = vi.hoisted(() => ({ conversations: [] as any[], assets: [] as any[], workflows: [] as any[] }));
vi.mock('idb', () => ({ openDB: vi.fn(async () => ({
  getAll: async (store: 'conversations' | 'assets' | 'workflows') => local[store],
  put: async (store: 'conversations' | 'assets' | 'workflows', row: any) => {
    const index = local[store].findIndex(current => current.id === row.id);
    if (index < 0) local[store].push(row); else local[store][index] = row;
  },
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

it('reads only account records for my library without mixing guest records or the public gallery', async () => {
  local.assets = [asset('guest-local')];
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ user: { id: 'current-user', email: 'u@example.com' }, generationLimit: 15 }))
    .mockResolvedValueOnce(Response.json({ records: [asset('owned-cloud')] }));
  vi.stubGlobal('fetch', fetch);
  const storage = await import('./storage');
  await storage.initializeStorage();
  expect(await storage.getAll('assets')).toEqual([asset('owned-cloud')]);
  expect(fetch.mock.calls[1][0]).toBe('/api/records/assets');
  expect(fetch.mock.calls[1][1].headers.get('X-Olai-User')).toBe('current-user');
  expect(local.assets).toEqual([asset('guest-local')]);
});

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

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

it('allowlists legacy settings, clears both key stores and rewrites sanitized preferences', async () => {
  const localStorage = memoryStorage(), sessionStorage = memoryStorage();
  vi.stubGlobal('localStorage', localStorage); vi.stubGlobal('sessionStorage', sessionStorage);
  for (const storage of [localStorage, sessionStorage]) {
    storage.setItem('olai.key', 'secret'); storage.setItem('studio.key', 'secret');
    storage.setItem('studio.settings', JSON.stringify({ key: 'secret', rememberKey: true, chatModel: 'private-model', systemPrompt: 'private-preset', temperature: 1.2, imageEngineMode: 'native' }));
  }
  const storage = await import('./storage');
  const settings = storage.loadSettings();
  expect(settings).toEqual({ temperature: 1.2, musicPath: 'speech', musicExtra: '{}', imageEngineMode: 'native', audioEngineMode: 'auto' });
  expect(JSON.parse(localStorage.getItem('olai.settings')!)).toEqual(settings);
  for (const store of [localStorage, sessionStorage]) for (const key of ['olai.key', 'studio.key', 'studio.settings']) expect(store.getItem(key)).toBeNull();
  storage.saveSettings({ ...settings, key: 'secret', imageModel: 'secret-model', musicExtra: JSON.stringify({ api_key: 'secret', model: 'private-model', bpm: 90 }) } as any);
  expect(JSON.parse(localStorage.getItem('olai.settings')!)).toEqual({ ...settings, musicExtra: '{"bpm":90}' });
});

it('recovers from corrupt settings and rejects invalid safe-field types', async () => {
  const localStorage = memoryStorage(); vi.stubGlobal('localStorage', localStorage);
  const storage = await import('./storage');
  const { DEFAULT_SETTINGS } = await import('./types');
  localStorage.setItem('olai.settings', '{bad json');
  expect(storage.loadSettings()).toEqual(DEFAULT_SETTINGS);
  localStorage.setItem('olai.settings', JSON.stringify({ temperature: 'secret', imageEngineMode: 'unknown', audioEngineMode: {}, musicExtra: 'private prompt', musicPath: {} }));
  expect(storage.loadSettings()).toEqual(DEFAULT_SETTINGS);
});

it('scrubs legacy IndexedDB records on read and new writes while retaining Blob and content', async () => {
  const blob = new Blob(['original media'], { type: 'video/mp4' });
  local.assets = [{ ...asset('legacy'), blob, model: 'private-model', options: { modelName: 'private-model', ratio: '16:9' } }];
  const storage = await import('./storage');
  const rows = await storage.getAll<any>('assets');
  expect(rows[0]).toEqual({ ...asset('legacy'), blob, options: { ratio: '16:9' } });
  expect(rows[0].blob).toBe(blob); expect(local.assets[0]).toEqual(rows[0]);
  await storage.put('assets', { ...asset('new'), blob, apiKey: 'secret', options: { model_id: 'private-model', seconds: 4 } } as any);
  expect(local.assets[1]).toEqual({ ...asset('new'), blob, options: { seconds: 4 } });
});

it('scrubs localStorage legacy backups before reading and saving', async () => {
  const localStorage = memoryStorage(); vi.stubGlobal('localStorage', localStorage); vi.stubGlobal('indexedDB', undefined);
  localStorage.setItem('studio.assets', JSON.stringify([{ ...asset('legacy'), key: 'secret', options: { model: 'private-model', ratio: '16:9' } }]));
  const storage = await import('./storage');
  expect(await storage.getAll('assets')).toEqual([{ ...asset('legacy'), options: { ratio: '16:9' } }]);
  expect(localStorage.getItem('studio.assets')).toBeNull();
  await storage.put('assets', { ...asset('new'), systemPrompt: 'private-preset' } as any);
  expect(JSON.parse(localStorage.getItem('olai.assets')!)).toEqual([{ ...asset('legacy'), options: { ratio: '16:9' } }, asset('new')]);
});

it('scrubs guest cloud imports and keeps the original content and local claim', async () => {
  local.assets = [{ ...asset('legacy'), lyrics: 'My original lyric', model: 'private-model', options: { api_key: 'secret', ratio: '16:9' } }];
  const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true })); vi.stubGlobal('fetch', fetch);
  const storage = await import('./storage');
  expect((await storage.syncGuestRecords('user')).synced.assets).toEqual(['legacy']);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ ...asset('legacy'), lyrics: 'My original lyric', options: { ratio: '16:9' } });
  expect(local.assets[0].linkedAccountId).toBe('user'); expect(local.assets[0].model).toBeUndefined();
});

it('uploads cached Blobs before importing metadata and skips disabled workflow migration', async () => {
  const blob = new Blob(['cached video'], { type: 'video/mp4' }); local.assets = [{ ...asset('cached'), blob }];
  const mediaURL = '/api/media/11111111-1111-4111-8111-111111111111';
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/auth/me') return Response.json({ user: { id: 'user', email: 'u@example.com' }, generationLimit: 15, mediaStorage: 'oss', shortFilm: false });
    if (url === '/api/media') return Response.json({ url: mediaURL });
    if (init?.method === 'POST') return Response.json({ migratedIds: [], failures: [] });
    return Response.json({ ok: true });
  }); vi.stubGlobal('fetch', fetch);
  const storage = await import('./storage'); await storage.initializeStorage();
  expect((await storage.syncGuestRecords('user')).synced.assets).toEqual(['cached']);
  const upload = fetch.mock.calls.findIndex(([url]) => url === '/api/media');
  const record = fetch.mock.calls.findIndex(([url]) => url.includes('/records/assets?import'));
  expect(upload).toBeLessThan(record); expect(fetch.mock.calls[upload][1]?.body).toBe(blob);
  expect(JSON.parse(String(fetch.mock.calls[record][1]?.body))).toEqual({ ...asset('cached'), url: mediaURL });
  expect(local.assets[0].blob).toBe(blob); expect(local.assets[0].linkedAccountId).toBe('user');
  expect(fetch.mock.calls.some(([url]) => url.includes('workflows'))).toBe(false);
});

it('does not mark a cached record synced when its OSS upload fails', async () => {
  const blob = new Blob(['cached video'], { type: 'video/mp4' }); local.assets = [{ ...asset('cached'), blob }];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/auth/me' ? Response.json({ user: { id: 'user', email: 'u@example.com' }, generationLimit: 15, mediaStorage: 'oss', shortFilm: false }) : url === '/api/media' ? Response.json({ error: { message: '上传失败' } }, { status: 503 }) : Response.json({ migratedIds: [], failures: [] })));
  const storage = await import('./storage'); await storage.initializeStorage();
  expect((await storage.syncGuestRecords('user')).failures).toHaveLength(1);
  expect(local.assets[0].blob).toBe(blob); expect(local.assets[0].linkedAccountId).toBeUndefined();
});

it('defensively scrubs cloud records returned by older servers', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ user: { id: 'user', email: 'u@example.com' }, generationLimit: 15 })).mockResolvedValueOnce(Response.json({ records: [{ ...asset('cloud'), model: 'private-model', options: { system_prompt: 'preset', ratio: '16:9' } }] }));
  vi.stubGlobal('fetch', fetch);
  const storage = await import('./storage'); await storage.initializeStorage();
  expect(await storage.getAll('assets')).toEqual([{ ...asset('cloud'), options: { ratio: '16:9' } }]);
});
