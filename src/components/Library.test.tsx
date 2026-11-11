import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Asset } from '../lib/types';
vi.mock('../lib/playerContext', () => ({ getAssetMediaURL: () => '/media.png', usePlayer: () => ({ activeMedia: null, isPlaying: false, play: vi.fn(), pause: vi.fn(), setIsExpanded: vi.fn() }) }));
import Library, { type LibraryProps } from './Library';
const asset: Asset = { id: 'example', kind: 'music', status: 'completed', createdAt: 1, prompt: '测试作品', options: {}, lyrics: '歌词', song: { title: '歌曲', style: '流行', instrumental: false, sections: [] } };
function render(props: Partial<LibraryProps> = {}) {
  return renderToStaticMarkup(createElement(Library, { assets: [asset], onNavigate: vi.fn(), onDelete: vi.fn(), onRetry: vi.fn(), onDownload: vi.fn(), onEdit: vi.fn(), onAlignLyrics: vi.fn(), onRetryCover: vi.fn(), ...props }));
}
describe('personal library', () => {
  it('shows personal works with the same card actions and the owner menu', () => {
    const html = render({ cloudStorage: true });
    expect(html).toContain('我的库');
    expect(html).toContain('测试作品');
    expect(html).toContain('查看作品参数');
    expect(html).toContain('下载作品');
    expect(html).toContain('更多作品操作');
    expect(html).toContain('查看作品：歌曲');
    expect(html).toContain('这里只展示你生成的作品');
    expect(html).toContain('已完成作品也会展示在作品广场');
  });
  it('offers login while preserving guest local works', () => {
    const html = render({ onLogin: vi.fn() });
    expect(html).toContain('登录查看我的作品');
    expect(html).toContain('当前浏览器');
    expect(html).toContain('测试作品');
  });
  it('marks unfinished works in the card and keeps management available', () => {
    const failed = render({ assets: [{ ...asset, status: 'failed', coverStatus: 'failed' }] });
    expect(failed).toContain('生成未完成');
    expect(failed).toContain('更多作品操作');
    const pending = render({ assets: [{ ...asset, status: 'pending' }] });
    expect(pending).toContain('生成中');
  });
  it('invites the first creation when the library is empty', () => {
    const html = render({ assets: [] });
    expect(html).toContain('第一份灵感');
    expect(html).toContain('生成图像');
    expect(html).toContain('生成视频');
    expect(html).toContain('生成音乐');
  });
});
