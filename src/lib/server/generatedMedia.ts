import { randomUUID } from 'node:crypto';
import { base64Blob, mediaOutputs } from '../api';
import type { MediaKind } from '../types';
import { reserveMediaBytes, storeMedia, type MediaIdentity } from './media';
import { importRemoteMedia, mediaByteLimit } from './mediaImport';
export async function persistGeneratedJSON(json: unknown, kind: MediaKind, identity: MediaIdentity) {
  const outputs = mediaOutputs(json, kind);
  if (!outputs.length || outputs.length > 8) throw new Error('Invalid generated media');
  const group = randomUUID();
  const data: { url: string; mime_type: string }[] = [];
  for (const [index, output] of outputs.entries()) {
    let bytes: Uint8Array, mime: string;
    let base64 = output.base64;
    mime = output.mime;
    if (!base64 && output.url?.startsWith('data:')) {
      const match = output.url.match(/^data:((?:image|audio|video)\/[\w.+-]+(?:;[\w=.-]+)*);base64,([A-Za-z0-9+/=\s]+)$/i);
      if (!match) throw new Error('Invalid generated media');
      mime = match[1]; base64 = match[2];
    }
    if (base64) {
      if (!/^[A-Za-z0-9+/=\s]+$/.test(base64) || base64.replace(/\s/g, '').length * .75 > mediaByteLimit() + 2) throw new Error('Generated file too large');
      const blob = base64Blob(base64, mime);
      bytes = new Uint8Array(await blob.arrayBuffer()); mime = blob.type;
    } else if (output.url) {
      const remote = await importRemoteMedia(output.url); bytes = remote.bytes; mime = remote.mime;
    } else throw new Error('Invalid generated media');
    const expected = kind === 'image' ? 'image/' : kind === 'video' ? 'video/' : 'audio/';
    if (!mime.startsWith(expected)) throw new Error('Invalid generated media type');
    await reserveMediaBytes(identity, bytes.byteLength);
    const stored = await storeMedia(bytes, mime, `${group}-${index}`, identity);
    data.push({ url: stored.url, mime_type: stored.mime });
  }
  return { data };
}
