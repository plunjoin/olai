import type { ReactNode } from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('./ui/Dialog', () => ({ default: ({ children }: { children: ReactNode }) => children }));
import AccountDialog from './AccountDialog';
function render(syncing: boolean, failures: string[] = []) {
  return renderToStaticMarkup(createElement(AccountDialog, { account: { user: { id: 'user', email: 'test@example.test' }, generationLimit: 15, mediaStorage: 'oss' }, syncing, syncFailures: failures, onClose: () => {}, onRetrySync: () => {} }));
}
describe('account local media sync control', () => {
  it('offers manual sync even when there is no failure', () => {
    expect(render(false)).toMatch(/type="button" class="secondary-button" aria-busy="false"[^>]*>同步本地数据到云端<\/button>/);
  });
  it('disables repeated requests and announces active background uploads', () => {
    expect(render(true)).toMatch(/disabled="" aria-busy="true"[^>]*>正在同步…/);
    expect(render(true)).toContain('role="status"');
  });
  it('shows recoverable errors without concealing the manual retry control', () => {
    expect(render(false, ['原始数据已保留'])).toContain('原始数据已保留');
    expect(render(false, ['原始数据已保留'])).toContain('同步本地数据到云端');
  });
});
