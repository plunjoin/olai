import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Asset } from '../lib/types';
vi.mock('../lib/playerContext', () => ({
  getAssetMediaURL: () => '/media.png',
  usePlayer: () => ({ activeMedia: null, isPlaying: false, play: vi.fn(), pause: vi.fn() }),
}));
import GalleryCard from './GalleryCard';

const asset: Asset = {
  id: 'gallery_card', kind: 'image', status: 'completed', createdAt: Date.UTC(2026, 7, 12),
  prompt: '雨后的城市夜晚\n霓虹倒影', options: { aspect_ratio: '16:9', image_size: '2K' },
};

function render(patch: Partial<Asset> = {}, favorite = false) {
  return renderToStaticMarkup(createElement(GalleryCard, {
    asset: { ...asset, ...patch }, favorite,
    onToggleFavorite: vi.fn(), onOpen: vi.fn(), onDownload: vi.fn(),
  }));
}

describe('public gallery card', () => {
  it('offers the bookmark, parameters and download actions over the media', () => {
    const html = render();
    expect(html).toContain('雨后的城市夜晚');
    expect(html).toContain('收藏作品：雨后的城市夜晚');
    expect(html).toContain('查看作品参数');
    expect(html).toContain('下载作品');
    expect(html).toContain('查看作品：雨后的城市夜晚');
    expect(html).not.toContain('更多作品操作');
  });

  it('explains unfinished personal works and disables their download', () => {
    const pending = render({ status: 'pending' });
    expect(pending).toContain('正在生成…');
    const failed = render({ status: 'failed' });
    expect(failed).toContain('生成未完成');
  });

  it('marks a saved work and keeps the bookmark visible through its pressed state', () => {
    const html = render({}, true);
    expect(html).toContain('取消收藏：雨后的城市夜晚');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('is-favorite');
  });

  it('shows the captured frame as a video cover', () => {
    const html = render({ kind: 'video', coverUrl: '/api/media/cover-frame' });
    expect(html).toContain('gallery-video-poster has-cover');
    expect(html).toContain('src="/api/media/cover-frame"');
  });

  it('keeps the gradient poster when a video has no cover yet', () => {
    const html = render({ kind: 'video' });
    expect(html).toContain('gallery-video-poster');
    expect(html).not.toContain('has-cover');
  });

  it('uses the song title for music cards', () => {
    const html = render({
      kind: 'music', prompt: '夏夜晚风',
      song: { title: '晚风来信', style: '独立流行', instrumental: false, sections: [] },
    });
    expect(html).toContain('晚风来信');
    expect(html).toContain('收藏作品：晚风来信');
  });
});
