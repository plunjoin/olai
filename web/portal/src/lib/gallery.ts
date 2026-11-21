import { t } from './i18n';
import type { Asset, GalleryComment } from './types';

export type GallerySort = 'new' | 'hot';
export interface GalleryOptions { favorites?: boolean; sort?: GallerySort }
export interface GalleryPage { records: Asset[]; nextOffset: number | null; favoriteTotal: number }
export interface GalleryMetrics { views: number; downloads: number; favoriteCount: number; heat: number }
export interface GalleryFavoriteResult extends GalleryMetrics { favorite: boolean; favoriteTotal: number }
export interface GalleryCommentsPage { comments: GalleryComment[]; total: number; nextOffset: number | null }
export interface GalleryCommentResult { comment: GalleryComment; total: number }

async function galleryRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    signal: init.signal || AbortSignal.timeout(30_000),
    ...init,
  });
  if (!response.ok) {
    let message = t('请求失败（{status}）', { status: response.status });
    try { const body = await response.json(); message = body.error?.message || body.message || message; } catch { /* Keep HTTP error. */ }
    const err = new Error(message) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }
  return response;
}

function metrics(value: any): GalleryMetrics | null {
  if (!value || typeof value !== 'object') return null;
  const views = Number(value.views);
  const downloads = Number(value.downloads);
  const favoriteCount = Number(value.favoriteCount);
  const heat = Number(value.heat);
  if (![views, downloads, favoriteCount, heat].every(Number.isFinite)) return null;
  return { views, downloads, favoriteCount, heat };
}

/** Public browsing is deliberately separate from personal persistence. */
export async function getGallery(offset = 0, signal?: AbortSignal, limit = 30, options: GalleryOptions = {}): Promise<GalleryPage> {
  const params = new URLSearchParams({ offset: String(offset), limit: String(limit) });
  if (options.favorites) params.set('favorites', '1');
  if (options.sort) params.set('sort', options.sort);
  const response = await galleryRequest(`/api/gallery?${params.toString()}`, { signal: signal || AbortSignal.timeout(30_000) });
  const page = await response.json();
  if (!Array.isArray(page.records) || !(page.nextOffset === null || (Number.isInteger(page.nextOffset) && page.nextOffset > offset))) {
    throw new Error(t('作品列表格式无效，请稍后重试。'));
  }
  return {
    records: page.records,
    nextOffset: page.nextOffset,
    favoriteTotal: Number.isSafeInteger(page.favoriteTotal) ? page.favoriteTotal : 0,
  };
}

/** Add or remove one account-backed favorite. */
export async function setGalleryFavorite(id: string, favorite: boolean): Promise<GalleryFavoriteResult> {
  const response = await galleryRequest(`/api/gallery/${encodeURIComponent(id)}/favorite`, { method: favorite ? 'PUT' : 'DELETE' });
  const data = await response.json();
  const stats = metrics(data);
  if (!stats || typeof data.favorite !== 'boolean') throw new Error(t('收藏状态同步失败，请稍后重试。'));
  return {
    favorite: data.favorite,
    favoriteTotal: Number.isSafeInteger(data.favoriteTotal) ? data.favoriteTotal : 0,
    ...stats,
  };
}

/** Count a detail-page view; the server throttles repeats per visitor. */
export async function recordGalleryView(id: string): Promise<GalleryMetrics | null> {
  try {
    const response = await galleryRequest(`/api/gallery/${encodeURIComponent(id)}/view`, { method: 'POST' });
    return metrics(await response.json());
  } catch {
    return null;
  }
}

/** Count a download; failures never block the actual download. */
export async function recordGalleryDownload(id: string): Promise<GalleryMetrics | null> {
  try {
    const response = await galleryRequest(`/api/gallery/${encodeURIComponent(id)}/download`, { method: 'POST' });
    return metrics(await response.json());
  } catch {
    return null;
  }
}

function validComment(value: any): GalleryComment | null {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string'
    || typeof value.body !== 'string' || !Number.isFinite(value.createdAt)) return null;
  const author = value.author;
  if (!author || typeof author !== 'object' || typeof author.name !== 'string') return null;
  return {
    id: value.id, body: value.body, createdAt: Number(value.createdAt),
    author: { name: author.name, avatar: typeof author.avatar === 'string' ? author.avatar : '' },
  };
}

/** Comments are public; posting uses the signed-in portal session. */
export async function getGalleryComments(id: string, offset = 0, limit = 20, signal?: AbortSignal): Promise<GalleryCommentsPage> {
  const params = new URLSearchParams({ id, offset: String(offset), limit: String(limit) });
  const response = await galleryRequest(`/api/gallery/comments?${params.toString()}`, { signal: signal || AbortSignal.timeout(30_000) });
  const page = await response.json();
  const comments = Array.isArray(page.comments) ? page.comments.map(validComment) : [];
  if (!Array.isArray(page.comments) || comments.some(comment => comment === null)
    || !(page.nextOffset === null || (Number.isInteger(page.nextOffset) && page.nextOffset > offset))
    || !Number.isSafeInteger(page.total) || page.total < 0) {
    throw new Error(t('评论列表格式无效，请稍后重试。'));
  }
  return { comments: comments as GalleryComment[], total: page.total, nextOffset: page.nextOffset };
}

export async function postGalleryComment(id: string, body: string): Promise<GalleryCommentResult> {
  const response = await galleryRequest(`/api/gallery/comments?id=${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  const data = await response.json();
  const comment = validComment(data.comment);
  if (!comment || !Number.isSafeInteger(data.total) || data.total < 1) {
    throw new Error(t('评论发布失败，请稍后重试。'));
  }
  return { comment, total: data.total };
}

/** Submit a moderation report for one public work. */
export async function reportGalleryWork(id: string, reason: string, detail: string): Promise<void> {
  await galleryRequest(`/api/gallery/${encodeURIComponent(id)}/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason, detail }),
  });
}

/** Adopt browser-local bookmarks created before account favorites existed. */
export async function importGalleryFavorites(ids: readonly string[]): Promise<number> {
  const response = await galleryRequest('/api/gallery/favorites/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  const data = await response.json();
  return Number.isSafeInteger(data.imported) ? data.imported : 0;
}
