import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import ChatWorkspace from './ChatWorkspace';
import type { MediaKind } from '../lib/types';

function render(kind: MediaKind | null = null) {
  return renderToStaticMarkup(createElement(ChatWorkspace, {
    kind, busy: false, onSend: vi.fn(), onStop: vi.fn(), onRetry: vi.fn(),
    onExport: vi.fn(), notify: vi.fn(), onModeChange: vi.fn(),
    media: { assets: [], busy: false, onGenerate: vi.fn(), onCompose: vi.fn(), onDelete: vi.fn(), onRetry: vi.fn(), onDownload: vi.fn() },
  }));
}

describe('creative workspace hierarchy', () => {
  it('keeps one contextual page heading and a usable chat composer', () => {
    const html = render();
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('从一个想法开始');
    expect(html).toContain('aria-label="对话内容"');
    expect(html).toContain('更多对话操作');
    expect(html).not.toContain('A LITTLE COMPANY');
  });

  it.each(['image', 'video', 'music'] as const)('names the %s page instead of calling it chat', kind => {
    const html = render(kind);
    const name = { image: '图像', video: '视频', music: '音乐' }[kind];
    expect(html).toContain(`class="workspace-label">${name}</h1>`);
    expect(html).toContain(`aria-label="${name}描述"`);
    expect(html).toContain(`aria-label="生成${name}"`);
    expect(html).not.toContain('更多对话操作');
  });
});
