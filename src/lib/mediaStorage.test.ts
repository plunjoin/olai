import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hydrateWorkflowMedia, isStoredMedia, persistRecordMedia, registerStoredBlob, uploadMedia } from './mediaStorage';
const url = '/api/media/11111111-1111-4111-8111-111111111111';
beforeEach(() => vi.stubGlobal('window', { location: { origin: 'https://olai.test' } }));
afterEach(() => vi.unstubAllGlobals());
describe('browser private media transport', () => {
  it('accepts only same-origin opaque handles', () => {
    expect(isStoredMedia(url)).toBe(true); expect(isStoredMedia(`https://olai.test${url}`)).toBe(true);
    for (const source of [`https://evil.test${url}`, 'https://bucket.oss.test/file', 'data:image/png;base64,AQID', 'blob:temp', '/api/media/not-a-uuid']) expect(isStoredMedia(source)).toBe(false);
  });
  it('deduplicates concurrent Blob uploads and rejects unexpected public URLs', async () => {
    const fetch = vi.fn(async () => Response.json({ url })); vi.stubGlobal('fetch', fetch);
    const blob = new Blob(['media'], { type: 'video/mp4' });
    expect(await Promise.all([uploadMedia(blob, 'asset-video', 'user'), uploadMedia(blob, 'asset-video', 'user')])).toEqual([url, url]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]).toMatchObject(['/api/media', { method: 'POST', body: blob, credentials: 'same-origin', headers: { 'Content-Type': 'video/mp4', 'X-Olai-User': 'user' } }]);
    fetch.mockImplementation(async () => Response.json({ url: 'https://bucket.oss.test/file' }));
    await expect(uploadMedia(new Blob(['other']), 'other', 'user')).rejects.toThrow('本站预览地址');
  });
  it('retries failures instead of caching rejection', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ error: { message: '上传失败' } }, { status: 503 })).mockResolvedValue(Response.json({ url })); vi.stubGlobal('fetch', fetch);
    const blob = new Blob(['retry']);
    await expect(uploadMedia(blob, 'retry', null)).rejects.toThrow('上传失败');
    await expect(uploadMedia(blob, 'retry', null)).resolves.toBe(url);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('strips every Blob slot from serialized record while keeping its local backup untouched', async () => {
    const fetch = vi.fn(async () => Response.json({ url })); vi.stubGlobal('fetch', fetch);
    const blob = new Blob(['media'], { type: 'video/mp4' });
    const value = { id: 'project', blob, shots: [{ id: 'shot', videoBlob: blob, keyframeBlob: blob }], musicBlob: blob, finalVideoBlob: blob, lyrics: '歌词', lrc: '[00:01]歌词' };
    const result = await persistRecordMedia(value, 'user') as any;
    expect(result).toMatchObject({ id: 'project', url, shots: [{ id: 'shot', videoUrl: url, keyframeUrl: url }], musicUrl: url, finalVideoUrl: url, lyricsUrl: url, lrcUrl: url });
    expect(JSON.stringify(result)).not.toMatch(/Blob|blob/); expect(value.blob).toBe(blob); expect(value.shots[0].videoBlob).toBe(blob);
    expect(fetch).toHaveBeenCalledTimes(7);
  });
  it('retains stored links and task Blob handles without another upload', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const blob = new Blob(['task'], { type: 'video/mp4' }); registerStoredBlob(blob, url);
    expect(await persistRecordMedia({ id: 'task', blob }, null)).toEqual({ id: 'task', url });
    expect(await persistRecordMedia({ id: 'asset', url, blob }, 'user')).toEqual({ id: 'asset', url });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('imports remote legacy URLs through the server, not through cross-origin browser fetch', async () => {
    const fetch = vi.fn(async () => Response.json({ url })); vi.stubGlobal('fetch', fetch);
    expect(await persistRecordMedia({ id: 'legacy', url: 'https://cdn.example.com/file.mp4' }, 'user')).toEqual({ id: 'legacy', url });
    expect(fetch).toHaveBeenCalledWith('/api/media/import', expect.objectContaining({ method: 'POST' }));
  });
  it('hydrates protected workflow handles for video assembly', async () => {
    const blob = new Blob(['video'], { type: 'video/mp4' }); const fetch = vi.fn(async () => new Response(blob)); vi.stubGlobal('fetch', fetch);
    const result = await hydrateWorkflowMedia({ id: 'project', shots: [{ videoUrl: url }], finalVideoUrl: url }) as any;
    expect(await result.shots[0].videoBlob.text()).toBe('video'); expect(await result.finalVideoBlob.text()).toBe('video');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
