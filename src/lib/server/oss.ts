import { createRequire } from 'node:module';
import type { Readable } from 'node:stream';
import { env } from './policy';

// ali-oss is CommonJS and ships no TS declarations. Keep its boundary small;
// never return SDK responses, endpoints or errors to a browser.
interface OSSClient {
  put(key: string, body: Buffer, options: { mime: string; headers: Record<string, string> }): Promise<unknown>;
  delete(key: string): Promise<unknown>;
  getStream(key: string, options: { headers: Record<string, string>; process?: string }): Promise<{ stream: Readable }>;
}
type OSSConstructor = new (options: {
  region: string; bucket: string; accessKeyId: string; accessKeySecret: string;
  secure: boolean; timeout: number;
}) => OSSClient;
const require = createRequire(import.meta.url);

export class OSSUnavailableError extends Error {
  constructor() { super('私有媒体服务暂不可用。'); }
}
export function ossInteger(name: string, fallback: number): number {
  const value = env(name, String(fallback)).trim();
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new OSSUnavailableError();
  return Number(value);
}
function configuration() {
  const region = env('OSS_REGION').trim();
  const bucket = env('OSS_BUCKET', 'magicfang-linux-dev').trim();
  const prefix = env('OSS_PREFIX', 'opt/olai').trim().replace(/^\/+|\/+$/g, '');
  const accessKeyId = env('OSS_ACCESS_KEY_ID').trim();
  const accessKeySecret = env('OSS_ACCESS_KEY_SECRET').trim();
  if (!/^oss-[a-z0-9-]+$/.test(region) || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)
    || !prefix || prefix.length > 200 || !prefix.split('/').every(part => /^[a-zA-Z0-9_-]+$/.test(part))
    || !accessKeyId || !accessKeySecret) throw new OSSUnavailableError();
  const maxFileBytes = ossInteger('OSS_MAX_FILE_BYTES', 256 * 1024 * 1024);
  // A deployment cannot accidentally permit unbounded in-memory uploads.
  if (maxFileBytes < 1 || maxFileBytes > 1024 * 1024 * 1024) throw new OSSUnavailableError();
  ossInteger('OSS_MEDIA_RATE_LIMIT', 60);
  ossInteger('OSS_MEDIA_DAILY_BYTES', 1024 * 1024 * 1024);
  ossInteger('OSS_MEDIA_READ_RATE_LIMIT', 60);
  ossInteger('OSS_MEDIA_READ_DAILY_BYTES', 1024 * 1024 * 1024);
  return { region, bucket, prefix, accessKeyId, accessKeySecret, maxFileBytes };
}
export function ossEnabled(): boolean {
  if (env('OSS_ENABLED') !== 'true') return false;
  configuration(); // Explicit enablement fails closed on incomplete configuration.
  return true;
}
export function ossSettings() {
  if (!ossEnabled()) throw new OSSUnavailableError();
  const { prefix, maxFileBytes } = configuration();
  return { prefix, maxFileBytes };
}
export function mediaMaxBytes(): number { return ossSettings().maxFileBytes; }
function client(): OSSClient {
  if (!ossEnabled()) throw new OSSUnavailableError();
  const { region, bucket, accessKeyId, accessKeySecret } = configuration();
  const OSS = require('ali-oss') as OSSConstructor;
  return new OSS({ region, bucket, accessKeyId, accessKeySecret, secure: true, timeout: 60_000 });
}
export async function putOSS(key: string, bytes: Uint8Array, mime: string): Promise<void> {
  try {
    await client().put(key, Buffer.from(bytes), { mime, headers: { 'x-oss-object-acl': 'private' } });
  } catch { throw new OSSUnavailableError(); }
}
export async function deleteOSS(key: string): Promise<void> {
  // Retrying an idempotent delete also handles an ambiguous upload timeout.
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await client().delete(key); return; } catch { /* No SDK errors/keys in logs. */ }
  }
  throw new OSSUnavailableError();
}
/** `process` asks OSS to transform the object (e.g. `image/resize,w_800`) so a
 * gallery thumbnail never leaves the bucket at full resolution. */
export async function readOSS(key: string, range?: string, process?: string): Promise<Readable> {
  try {
    const options: { headers: Record<string, string>; process?: string } = { headers: range ? { Range: range } : {} };
    if (process) options.process = process;
    const result = await client().getStream(key, options);
    return result.stream;
  } catch { throw new OSSUnavailableError(); }
}
