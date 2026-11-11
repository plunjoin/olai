import { afterEach, expect, it, vi } from 'vitest';
import { getGallery } from './gallery';
afterEach(() => vi.unstubAllGlobals());
it('loads public pages without attaching personal account headers', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ records: [], nextOffset: 30 }));
  vi.stubGlobal('fetch', fetch);
  await expect(getGallery()).resolves.toEqual({ records: [], nextOffset: 30 });
  expect(fetch).toHaveBeenCalledWith('/api/gallery?offset=0&limit=30', expect.objectContaining({ credentials: 'same-origin' }));
  expect(fetch.mock.calls[0][1].headers).toBeUndefined();
});
it('loads subsequent pages and accepts the end marker', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ records: [], nextOffset: null })));
  await expect(getGallery(30)).resolves.toEqual({ records: [], nextOffset: null });
});
it('reports recoverable errors without echoing server details', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private details', { status: 503 })));
  await expect(getGallery()).rejects.toThrow('作品广场暂时无法读取');
});
it('rejects invalid or non-advancing pagination', async () => {
  for (const page of [{ records: {} }, { records: [], nextOffset: 0 }, { records: [], nextOffset: -1 }]) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(page)));
    await expect(getGallery()).rejects.toThrow('作品列表格式无效');
  }
});
