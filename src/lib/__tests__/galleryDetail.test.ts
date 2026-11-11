import { describe, expect, it } from 'vitest';
import type { Asset } from '../types';
import { galleryParameters, galleryReuseOptions, galleryTitle } from '../galleryDetail';

function asset(patch: Partial<Asset> = {}): Asset {
  return {
    id: 'gallery_test', kind: 'image', status: 'completed', prompt: '雨后的城市夜景\n霓虹倒影，安静而有电影感',
    createdAt: Date.UTC(2026, 7, 12), options: {},
    ...patch,
  };
}

describe('gallery detail parameters', () => {
  it('lists the requested image ratio, size and actual pixels without private options', () => {
    const params = Object.fromEntries(galleryParameters(asset({
      options: { aspect_ratio: '16:9', image_size: '2K', reasoning_effort: 'high', n: 1 },
      imageWidth: 1920, imageHeight: 1080,
    })).map(parameter => [parameter.label, parameter.value]));
    expect(params['作品类型']).toBe('图像');
    expect(params['模型']).toBe('Olai Image Engine');
    expect(params['画面比例']).toBe('16:9');
    expect(params['目标分辨率']).toBe('2K');
    expect(params['实际尺寸']).toBe('1920 × 1080 像素');
    expect(JSON.stringify(params)).not.toContain('high');
  });

  it('infers a readable ratio from actual pixels when the request did not record one', () => {
    const params = Object.fromEntries(galleryParameters(asset({ imageWidth: 1024, imageHeight: 1536 })).map(parameter => [parameter.label, parameter.value]));
    expect(params['画面比例']).toBe('2 : 3');
  });

  it('describes music with its own editable fields', () => {
    const params = Object.fromEntries(galleryParameters(asset({
      kind: 'music', prompt: '夏夜晚风', options: { duration: 125 },
      audioDuration: 125.4,
      song: { title: '晚风来信', style: '独立流行', instrumental: false, sections: [] },
    })).map(parameter => [parameter.label, parameter.value]));
    expect(params['作品类型']).toBe('音乐');
    expect(params['音乐风格']).toBe('独立流行');
    expect(params['演唱方式']).toBe('人声歌曲');
    expect(params['音频时长']).toBe('2:05');
  });

  it('reuses only public, supported generation parameters', () => {
    expect(galleryReuseOptions(asset({
      options: { aspect_ratio: '4:5', image_size: '4K', reasoning_effort: 'high', secret: 'x' },
    }))).toEqual({ aspect_ratio: '4:5', image_size: '4K' });
    expect(galleryReuseOptions(asset({ kind: 'video', options: { aspect_ratio: '9:16', duration: 6, resolution: '1080p' } })))
      .toEqual({ aspect_ratio: '9:16', duration: 6 });
    expect(galleryReuseOptions(asset({ options: {}, imageWidth: 1920, imageHeight: 1080 })))
      .toEqual({ aspect_ratio: '16:9' });
  });

  it('uses a song title or the first prompt line as the card title', () => {
    expect(galleryTitle(asset({
      kind: 'music', song: { title: '晚风来信', style: '', instrumental: true, sections: [] },
    }))).toBe('晚风来信');
    expect(galleryTitle(asset())).toBe('雨后的城市夜景');
  });
});
