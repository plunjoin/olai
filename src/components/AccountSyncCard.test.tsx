import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AccountSyncCard from './AccountSyncCard';

function render(syncing: boolean, failures: string[] = [], note = '') {
  return renderToStaticMarkup(createElement(AccountSyncCard, { syncing, failures, note, onSync: () => {} }));
}

describe('account local media sync control', () => {
  it('offers manual sync even when there is no failure', () => {
    expect(render(false)).toMatch(/class="secondary-button" aria-busy="false"[\s\S]*同步本地数据<\/button>/);
  });
  it('disables repeated requests and announces active background uploads', () => {
    expect(render(true)).toMatch(/disabled="" aria-busy="true"[\s\S]*正在同步…/);
    expect(render(true)).toContain('role="status"');
  });
  it('shows recoverable errors without concealing the manual retry control', () => {
    expect(render(false, ['原始数据已保留'])).toContain('原始数据已保留');
    expect(render(false, ['原始数据已保留'])).toContain('同步本地数据');
  });
});
