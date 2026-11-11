// Browser-side persistence transport. Only same-origin media handles are stored;
// OSS credentials, object keys and signed bucket URLs never enter this module.
export const MEDIA_PATH = /^\/api\/media\/[a-f0-9-]{36}$/i;
export function isStoredMedia(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (MEDIA_PATH.test(value)) return true;
  try { const url = new URL(value); return url.origin === window.location.origin && !url.search && !url.hash && MEDIA_PATH.test(url.pathname); } catch { return false; }
}
const uploads = new WeakMap<Blob, Map<string, Promise<string>>>();
const generatedBlobs = new WeakMap<Blob, string>();
export function registerStoredBlob(blob: Blob, url: string | null) { if (url && isStoredMedia(url)) generatedBlobs.set(blob, url); }
async function resultURL(response: Response): Promise<string> {
  let body: any;
  try { body = await response.json(); } catch { throw new Error('媒体存储接口返回的数据无效。'); }
  if (!response.ok) throw new Error(body?.error?.message || `媒体上传失败（HTTP ${response.status}）。`);
  if (!isStoredMedia(body.url)) throw new Error('媒体存储接口没有返回本站预览地址。');
  return body.url;
}
export async function uploadMedia(blob: Blob, attachmentId: string, userId: string | null): Promise<string> {
  const stored = generatedBlobs.get(blob);
  if (stored) return stored;
  const key = `${userId || 'guest'}:${attachmentId}`;
  let cache = uploads.get(blob);
  if (!cache) { cache = new Map(); uploads.set(blob, cache); }
  let upload = cache.get(key);
  if (!upload) {
    upload = (async () => {
      const headers: Record<string, string> = { 'Content-Type': blob.type || 'application/octet-stream', 'X-Olai-Attachment-Id': attachmentId };
      if (userId) headers['X-Olai-User'] = userId;
      else headers['X-Olai-User'] = 'guest';
      return resultURL(await fetch('/api/media', { method: 'POST', body: blob, headers, credentials: 'same-origin', signal: AbortSignal.timeout(180_000) }));
    })();
    cache.set(key, upload);
    void upload.catch(() => cache!.delete(key));
  }
  return upload;
}
async function persistSource(source: string, id: string, userId: string | null): Promise<string> {
  if (isStoredMedia(source)) return source;
  if (/^(?:data:|blob:)/.test(source)) {
    const response = await fetch(source);
    if (!response.ok) throw new Error('本地媒体读取失败，原始数据仍保留在浏览器。');
    return uploadMedia(await response.blob(), id, userId);
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Olai-User': userId || 'guest' };
  return resultURL(await fetch('/api/media/import', { method: 'POST', headers, credentials: 'same-origin', signal: AbortSignal.timeout(180_000), body: JSON.stringify({ url: source, attachmentId: id }) }));
}
/** Handles every persisted media slot, including old Base64 snapshots and final
 * videos assembled in the browser. Does not mutate the local backup. */
export async function persistRecordMedia<T>(value: T, userId: string | null): Promise<T> {
  const row: any = { ...value };
  async function slot(target: any, blobKey: string, dataKey: string, urlKey: string, id: string) {
    const blob = target[blobKey];
    const url = target[urlKey];
    // A stored URL may accompany a downloaded Blob. Prefer its existing handle
    // rather than uploading the same generated object again.
    if (!isStoredMedia(url)) {
      if (blob instanceof Blob) target[urlKey] = await uploadMedia(blob, id, userId);
      else if (target[dataKey]) target[urlKey] = await persistSource(target[dataKey], id, userId);
      else if (typeof url === 'string' && url) target[urlKey] = await persistSource(url, id, userId);
    }
    delete target[blobKey]; delete target[dataKey];
  }
  await slot(row, 'blob', 'blobData', 'url', `${row.id}-media`);
  if (row.coverUrl) row.coverUrl = await persistSource(row.coverUrl, `${row.id}-cover`, userId);
  if (Array.isArray(row.shots)) {
    row.shots = [];
    for (const original of (value as any).shots) {
      const shot = { ...original };
      await slot(shot, 'keyframeBlob', 'keyframeBlobData', 'keyframeUrl', `${row.id}-${shot.id}-keyframe`);
      await slot(shot, 'videoBlob', 'videoBlobData', 'videoUrl', `${row.id}-${shot.id}-video`);
      row.shots.push(shot);
    }
  }
  await slot(row, 'musicBlob', 'musicBlobData', 'musicUrl', `${row.id}-music`);
  await slot(row, 'finalVideoBlob', 'finalVideoBlobData', 'finalVideoUrl', `${row.id}-final`);
  // Text attachments are versioned by content and linked in the record too.
  for (const [field, extension] of [['lyrics', 'txt'], ['lrc', 'lrc']] as const) {
    if (typeof row[field] === 'string' && row[field]) row[`${field}Url`] = await uploadMedia(new Blob([row[field]], { type: extension === 'lrc' ? 'text/lrc' : 'text/plain;charset=utf-8' }), `${row.id}-${extension}`, userId);
  }
  return row;
}
/** Workflow editing/assembly needs Blobs, unlike lazy-loaded asset previews. */
export async function hydrateWorkflowMedia<T>(project: T): Promise<T> {
  const row: any = { ...project };
  const hydrate = async (target: any, blobKey: string, urlKey: string) => {
    if (target[blobKey] || !isStoredMedia(target[urlKey])) return;
    const response = await fetch(target[urlKey], { credentials: 'same-origin', signal: AbortSignal.timeout(180_000) });
    if (!response.ok) throw new Error('短片媒体读取失败，请重新同步后重试。');
    target[blobKey] = await response.blob();
  };
  if (Array.isArray(row.shots)) row.shots = await Promise.all(row.shots.map(async (source: any) => {
    const shot = { ...source }; await hydrate(shot, 'keyframeBlob', 'keyframeUrl'); await hydrate(shot, 'videoBlob', 'videoUrl'); return shot;
  }));
  await hydrate(row, 'musicBlob', 'musicUrl'); await hydrate(row, 'finalVideoBlob', 'finalVideoUrl');
  return row;
}
