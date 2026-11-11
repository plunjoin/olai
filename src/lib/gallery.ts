import type { Asset } from './types';

export interface GalleryPage { records: Asset[]; nextOffset: number | null }

/** Public browsing is deliberately separate from personal persistence. */
export async function getGallery(offset = 0, signal?: AbortSignal): Promise<GalleryPage> {
  const response = await fetch(`/api/gallery?offset=${offset}&limit=30`, {
    credentials: 'same-origin', signal: signal || AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error('作品广场暂时无法读取，请稍后重试。');
  const page = await response.json();
  if (!Array.isArray(page.records) || !(page.nextOffset === null || (Number.isInteger(page.nextOffset) && page.nextOffset > offset))) {
    throw new Error('作品列表格式无效，请稍后重试。');
  }
  return page;
}
