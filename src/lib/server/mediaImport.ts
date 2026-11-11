import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { env } from './policy';
import { mediaMaxBytes } from './oss';

const denied = new BlockList();
for (const [ip, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) denied.addSubnet(ip, prefix, 'ipv4');
for (const [ip, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) denied.addSubnet(ip, prefix, 'ipv6');
const publicV6 = new BlockList(); publicV6.addSubnet('2000::', 3, 'ipv6');
export function publicMediaIP(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return !denied.check(ip, 'ipv4');
  return family === 6 && publicV6.check(ip, 'ipv6') && !denied.check(ip, 'ipv6');
}
export function allowedImportURL(source: string): URL {
  const url = new URL(source);
  const hosts = env('OSS_IMPORT_HOSTS').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  try { hosts.push(new URL(env('AI_API_BASE_URL')).hostname.toLowerCase()); } catch { /* No provider host configured. */ }
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password || url.hash || !hosts.includes(url.hostname.toLowerCase()) || isIP(url.hostname.replace(/^\[|\]$/g, ''))) throw new Error('此媒体来源尚未被服务端允许，请联系管理员配置媒体来源。');
  return url;
}
export const mediaByteLimit = mediaMaxBytes;
export async function readMediaBody(response: Response): Promise<Uint8Array> {
  const max = mediaByteLimit();
  if (Number(response.headers.get('content-length')) > max) throw new Error('媒体文件超过上传大小限制。');
  if (!response.body) throw new Error('媒体内容为空。');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel().catch(() => {}); throw new Error('媒体文件超过上传大小限制。'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!size) throw new Error('媒体内容为空。');
  return Buffer.concat(chunks, size);
}
/** No arbitrary proxy: exact HTTPS host allowlist, validate all DNS answers,
 * pin the checked address to the connection, and revalidate every redirect.
 * Never forward session cookies, provider credentials, or upstream headers. */
export async function importRemoteMedia(source: string, redirects = 0): Promise<{ bytes: Uint8Array; mime: string }> {
  const url = allowedImportURL(source);
  const answers = await lookup(url.hostname, { all: true, verbatim: true });
  if (!answers.length || answers.some(answer => !publicMediaIP(answer.address))) throw new Error('媒体来源地址不允许访问。');
  const address = answers[0]; const max = mediaByteLimit();
  const result = await new Promise<{ redirect: string } | { bytes: Uint8Array; mime: string }>((resolve, reject) => {
    const req = httpsRequest(url, {
      method: 'GET', agent: false, family: address.family, headers: { Accept: 'image/*,audio/*,video/*', 'Accept-Encoding': 'identity' },
      // Keep TLS hostname/SNI validation, but prevent a second DNS lookup.
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode || 0) && res.headers.location) {
        res.destroy(); resolve({ redirect: new URL(res.headers.location, url).href }); return;
      }
      if (res.statusCode !== 200 || (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') || Number(res.headers['content-length']) > max) {
        res.destroy(); reject(new Error('媒体来源无法读取或文件过大。')); return;
      }
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > max) { res.destroy(); reject(new Error('媒体文件超过上传大小限制。')); return; }
        chunks.push(chunk);
      });
      res.on('error', () => reject(new Error('媒体来源读取失败。')));
      res.on('end', () => size ? resolve({ bytes: Buffer.concat(chunks, size), mime: res.headers['content-type'] || 'application/octet-stream' }) : reject(new Error('媒体内容为空。')));
    });
    const timer = setTimeout(() => req.destroy(new Error('timeout')), 90_000); timer.unref();
    req.on('close', () => clearTimeout(timer));
    req.on('error', () => reject(new Error('媒体来源暂时无法读取。')));
    req.end();
  });
  if ('redirect' in result) {
    if (redirects >= 3) throw new Error('媒体来源重定向次数过多。');
    return importRemoteMedia(result.redirect, redirects + 1);
  }
  return result;
}
