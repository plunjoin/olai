import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cachedMedia, captureMedia, clearMediaCache, completeMedia } from './mediaCache';
beforeEach(() => clearMediaCache());
afterEach(() => { vi.useRealTimers(); clearMediaCache(); });
const bytes = (text: string) => new TextEncoder().encode(text);
const text = (value: Uint8Array | null) => value && new TextDecoder().decode(value);
function save(key: string, start: number, value: string) { const c = captureMedia(key, start); c.append(bytes(value)); c.commit(); }
it('reuses full and exact range data without crossing object keys', () => {
  save('one', 0, 'hello');
  expect(text(cachedMedia('one', 0, 4, false))).toBe('hello');
  expect(text(cachedMedia('one', 1, 2, true))).toBe('el');
  expect(cachedMedia('other', 0, 4, false)).toBeNull();
});
it('returns a cached prefix only for Range requests, never a truncated full body', () => {
  save('one', 0, 'he');
  expect(cachedMedia('one', 0, 4, false)).toBeNull();
  expect(text(cachedMedia('one', 0, 4, true))).toBe('he');
  expect(cachedMedia('one', 2, 4, true)).toBeNull();
});
it('merges contiguous and overlapping segments for subsequent full reads', () => {
  save('one', 0, 'he'); save('one', 2, 'llo');
  expect(text(cachedMedia('one', 0, 4, false))).toBe('hello');
  save('one', 1, 'EL');
  expect(text(cachedMedia('one', 0, 4, false))).toBe('hELlo');
});
it('keeps disjoint ranges separate rather than returning fabricated zero bytes', () => {
  save('one', 0, 'he'); save('one', 4, 'o');
  expect(cachedMedia('one', 0, 4, false)).toBeNull();
  expect(text(cachedMedia('one', 4, 4, true))).toBe('o');
});
it('reuses a transformed response only once it was captured completely', () => {
  const partial = captureMedia('thumb', 0); partial.append(bytes('he')); partial.commit();
  expect(completeMedia('thumb')).toBeNull();
  const full = captureMedia('thumb:done', 0); full.append(bytes('hello')); full.commit(true);
  expect(text(completeMedia('thumb:done'))).toBe('hello');
  expect(text(completeMedia('thumb:done'))).toBe('hello');
  const truncated = captureMedia('thumb:cut', 0); truncated.append(bytes('hello')); truncated.commit();
  expect(completeMedia('thumb:cut')).toBeNull();
});
it('expires cached data after fifteen minutes', () => {
  vi.useFakeTimers(); save('one', 0, 'hello');
  vi.advanceTimersByTime(15 * 60_000);
  expect(cachedMedia('one', 0, 4, false)).toBeNull();
});
it('commits once and copies captured chunks so a mutable upstream cannot corrupt the cache', () => {
  const c = captureMedia('one', 0), value = bytes('hello');
  c.append(value); value.fill(0); c.commit(); c.commit(); c.append(bytes('ignored'));
  expect(text(cachedMedia('one', 0, 4, false))).toBe('hello');
});
