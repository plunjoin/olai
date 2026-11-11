const STORAGE_KEY = 'olai.gallery.favorites';
const MAX_FAVORITES = 500;

/** Pure toggle so callers and tests can reason about the list without storage. */
export function toggleFavoriteId(ids: readonly string[], id: string): string[] {
  if (!id) return [...ids];
  return ids.includes(id) ? ids.filter(value => value !== id) : [id, ...ids.filter(value => value !== id)].slice(0, MAX_FAVORITES);
}

function validIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const id of value) {
    if (typeof id !== 'string' || !id || seen.has(id)) continue;
    seen.add(id);
    if (seen.size >= MAX_FAVORITES) break;
  }
  return [...seen];
}

/** Favorites are a browser-local bookmark for public works; no account is required. */
export function readGalleryFavorites(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? validIds(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function writeGalleryFavorites(ids: readonly string[]): string[] {
  const next = validIds(ids);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* Browsing still works while storage is unavailable. */ }
  return next;
}
