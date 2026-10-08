import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateImage, mediaOutputs, publicServiceError } from '../api';
import { imageResolutionWarning, readImageResolution } from '../imageResolution';
import { generationKind } from '../server/policy';
import { DEFAULT_SETTINGS } from '../types';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('image resolution', () => {
  it('sends 4K as an official image output parameter', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ steps: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await generateImage({ key: '', model: DEFAULT_SETTINGS.imageModel, prompt: 'Flowers', mode: 'interactions', imageSize: '4K', aspectRatio: '16:9' });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/interactions');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.response_format).toEqual({ type: 'image', image_size: '4K', aspect_ratio: '16:9', delivery: 'inline' });
    expect(body.stream).toBe(false);
    expect(body.store).toBe(false);
    expect(body.generation_config).toBeUndefined();
  });
  it.each(['auto', '2.35:1'])('keeps 4K for %s without sending an unsupported aspect ratio', async aspectRatio => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal('fetch', fetchMock);
    await generateImage({ key: '', model: DEFAULT_SETTINGS.imageModel, prompt: 'Flowers', mode: 'interactions', imageSize: '4K', aspectRatio });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.response_format.image_size).toBe('4K');
    expect(body.response_format.aspect_ratio).toBeUndefined();
    if (aspectRatio !== 'auto') expect(body.input).toContain(aspectRatio);
  });
  it('reports a disabled official backend without silently generating a lower resolution', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ error: { message: '官方 Gemini 后端未启用，请配置 gemini_api 或 WEB2API_GEMINI_API_KEY' } }, { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(generateImage({ key: '', model: DEFAULT_SETTINGS.imageModel, prompt: 'Flowers', mode: 'interactions', imageSize: '4K' })).rejects.toThrow('官方媒体生成接口尚未启用');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(publicServiceError('官方 Gemini 后端未启用')).not.toContain('Gemini');
  });
  it('extracts only generated image steps, retaining their original MIME type', () => {
    expect(mediaOutputs({ steps: [
      { type: 'user_input', content: [{ type: 'image', data: 'reference' }] },
      { type: 'model_output', content: [{ type: 'text', text: 'done' }, { type: 'image', data: 'AQID', mime_type: 'image/png' }, { type: 'image', uri: 'https://example.com/full.jpg', mime_type: 'image/jpeg' }] },
    ] }, 'image')).toEqual([
      { base64: 'AQID', url: undefined, mime: 'image/png' },
      { base64: undefined, url: 'https://example.com/full.jpg', mime: 'image/jpeg' },
    ]);
  });
  it('counts official image requests and rejects other engines on the image route', () => {
    expect(generationKind('interactions', { model: DEFAULT_SETTINGS.imageModel })).toBe('image');
    vi.stubEnv('AI_IMAGE_MODEL', 'gemini-3.1-flash-image');
    expect(generationKind('interactions', { model: 'gemini-3.1-flash-image' })).toBe('image');
    expect(() => generationKind('interactions', { model: DEFAULT_SETTINGS.chatModel })).toThrow();
    expect(() => generationKind('interactions', { model: 'unknown' })).toThrow();
  });
  it('flags 1K output requested at 4K and accepts landscape, portrait and UHD images', () => {
    expect(imageResolutionWarning({ width: 1024, height: 576 }, '4K')).toContain('未达到所选 4K');
    expect(imageResolutionWarning({ width: 1024, height: 1024 }, '2K')).toContain('未达到所选 2K');
    for (const resolution of [{ width: 4096, height: 2304 }, { width: 2304, height: 4096 }, { width: 3840, height: 2160 }]) expect(imageResolutionWarning(resolution, '4K')).toBeUndefined();
    expect(imageResolutionWarning(undefined, '4K')).toBeUndefined();
    expect(imageResolutionWarning({ width: 1024, height: 1024 }, undefined)).toBeUndefined();
  });
  it('reads decoded file dimensions and releases its object URL', async () => {
    let decoder: { onload: (() => void) | null; naturalWidth: number; naturalHeight: number };
    vi.stubGlobal('Image', class {
      naturalWidth = 1024; naturalHeight = 576; onload = null; onerror = null;
      constructor() { decoder = this; }
      set src(_value: string) {}
    });
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const reading = readImageResolution(new Blob(['original'], { type: 'image/png' }));
    decoder!.onload!();
    await expect(reading).resolves.toEqual({ width: 1024, height: 576 });
    expect(revoke).toHaveBeenCalledTimes(1);
  });
  it('releases the object URL when metadata loading times out', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Image', class { onload = null; onerror = null; src = ''; });
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const result = expect(readImageResolution(new Blob(['broken']))).rejects.toThrow('图片尺寸读取超时');
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
    expect(revoke).toHaveBeenCalledTimes(1);
  });
});
