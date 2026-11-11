import { afterEach, describe, expect, it, vi } from 'vitest';
import { readGalleryFavorites, toggleFavoriteId, writeGalleryFavorites } from '../galleryFavorites';

afterEach(() => vi.unstubAllGlobals());

describe('gallery favorites', () => {
  it('adds, removes and de-duplicates ids', () => {
    expect(toggleFavoriteId([], 'a')).toEqual(['a']);
    expect(toggleFavoriteId(['a', 'b'], 'b')).toEqual(['a']);
    expect(toggleFavoriteId(['a'], 'b')).toEqual(['b', 'a']);
  });

  it('round-trips through local storage', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
    });
    expect(writeGalleryFavorites(['a', 'a', 'b'])).toEqual(['a', 'b']);
    expect(readGalleryFavorites()).toEqual(['a', 'b']);
  });

  it('ignores malformed storage and keeps working without it', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => '{not json',
      setItem: () => { throw new Error('blocked'); },
    });
    expect(readGalleryFavorites()).toEqual([]);
    expect(writeGalleryFavorites(['a'])).toEqual(['a']);
  });
});
