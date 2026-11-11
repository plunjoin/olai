import { base64Blob } from '../api';
import { claimMediaURLs, mediaURLPath, reserveMediaBytes, storeMedia, type MediaIdentity } from './media';
import { importRemoteMedia, mediaByteLimit } from './mediaImport';

// During background migration, never expose legacy bucket/provider domains in
// record responses. The untouched original stays in the database for migration.
export function publicRecordMedia<T>(value: T, identity: MediaIdentity): T {
  const fields = new Set(['url', 'coverUrl', 'keyframeUrl', 'videoUrl', 'musicUrl', 'finalVideoUrl', 'lyricsUrl', 'lrcUrl']);
  const scrub = (input: any): any => {
    if (Array.isArray(input)) return input.map(scrub);
    if (!input || typeof input !== 'object') return input;
    const result: Record<string, unknown> = {};
    for (const [field, entry] of Object.entries(input)) {
      if (fields.has(field) && typeof entry === 'string') {
        const local = mediaURLPath(entry, identity);
        if (local) result[field] = local;
        else if (entry.startsWith('data:')) result[field] = entry;
      } else result[field] = scrub(entry);
    }
    return result;
  };
  return scrub(value);
}
async function sourceMedia(source: string, attachmentId: string, identity: MediaIdentity): Promise<string> {
  const local = mediaURLPath(source, identity);
  if (local) return local; // Validate/claim the complete record atomically below.
  if (source.startsWith('data:')) {
    const match = source.match(/^data:((?:image|audio|video)\/[\w.+-]+(?:;[\w=.-]+)*);base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!match || match[2].replace(/\s/g, '').length * .75 > mediaByteLimit() + 2) throw new Error('媒体编码无效或超过大小限制。');
    const blob = base64Blob(match[2], match[1]);
    await reserveMediaBytes(identity, blob.size);
    return (await storeMedia(new Uint8Array(await blob.arrayBuffer()), blob.type, attachmentId, identity)).url;
  }
  if (/^blob:/i.test(source)) throw new Error('浏览器临时媒体需要从原设备重新同步。');
  const downloaded = await importRemoteMedia(source);
  await reserveMediaBytes(identity, downloaded.bytes.byteLength);
  return (await storeMedia(downloaded.bytes, downloaded.mime, attachmentId, identity)).url;
}
/** Convert old database Base64/remote media into private OSS references. Called
 * before committing record metadata so an unsuccessful upload is never marked
 * synced. Plain user text is not traversed or rewritten as a media URL. */
export async function persistServerRecordMedia<T>(value: T, identity: MediaIdentity): Promise<T> {
  const row: any = { ...value };
  async function slot(target: any, data: string, url: string, id: string) {
    const source = target[data] || target[url];
    if (typeof source === 'string' && source) target[url] = await sourceMedia(source, id, identity);
    delete target[data];
  }
  await slot(row, 'blobData', 'url', `${row.id}-media`);
  if (row.coverUrl) row.coverUrl = await sourceMedia(row.coverUrl, `${row.id}-cover`, identity);
  if (Array.isArray(row.shots)) {
    row.shots = [];
    for (const original of (value as any).shots) {
      const shot = { ...original };
      await slot(shot, 'keyframeBlobData', 'keyframeUrl', `${row.id}-${shot.id}-keyframe`);
      await slot(shot, 'videoBlobData', 'videoUrl', `${row.id}-${shot.id}-video`);
      row.shots.push(shot);
    }
  }
  await slot(row, 'musicBlobData', 'musicUrl', `${row.id}-music`);
  await slot(row, 'finalVideoBlobData', 'finalVideoUrl', `${row.id}-final`);
  for (const [field, extension] of [['lyrics', 'txt'], ['lrc', 'lrc']] as const) {
    if (typeof row[field] === 'string' && row[field]) {
      // Reusing a field URL after editing its text would leave a stale file.
      const bytes = Buffer.from(row[field]);
      await reserveMediaBytes(identity, bytes.byteLength);
      row[`${field}Url`] = (await storeMedia(bytes, extension === 'lrc' ? 'text/lrc' : 'text/plain', `${row.id}-${extension}`, identity)).url;
    }
  }
  await claimMediaURLs(row, identity);
  return row;
}
