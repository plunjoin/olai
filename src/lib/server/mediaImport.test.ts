import { afterEach, describe, expect, it, vi } from 'vitest';
import { allowedImportURL, importRemoteMedia, publicMediaIP, readMediaBody } from './mediaImport';
vi.mock('./oss', () => ({ mediaMaxBytes: () => 8 }));
vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async () => [{ address: '127.0.0.1', family: 4 }]) }));
afterEach(() => vi.unstubAllEnvs());
describe('remote media SSRF boundaries', () => {
  it.each(['127.0.0.1', '10.1.2.3', '169.254.169.254', '100.100.100.200', '172.16.0.1', '192.168.1.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1', '2002:7f00:1::1', '2001::1'])('blocks non-public address %s', address => expect(publicMediaIP(address)).toBe(false));
  it.each(['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111'])('accepts public address %s', address => expect(publicMediaIP(address)).toBe(true));
  it('requires an exact HTTPS hostname and safe authority', () => {
    vi.stubEnv('OSS_IMPORT_HOSTS', 'cdn.example.com,other.example.com'); vi.stubEnv('AI_API_BASE_URL', 'https://provider.example.com/v1');
    expect(allowedImportURL('https://cdn.example.com/file.mp4?signature=opaque').host).toBe('cdn.example.com');
    expect(allowedImportURL('https://provider.example.com/output')).toBeInstanceOf(URL);
    for (const source of ['http://cdn.example.com/a', 'https://cdn.example.com.evil.test/a', 'https://sub.cdn.example.com/a', 'https://cdn.example.com:8443/a', 'https://user:pass@cdn.example.com/a', 'file:///etc/passwd', 'https://127.0.0.1/a', 'https://[::1]/a']) expect(() => allowedImportURL(source)).toThrow();
  });
  it('rejects private DNS answers before opening a connection', async () => {
    vi.stubEnv('OSS_IMPORT_HOSTS', 'cdn.example.com');
    await expect(importRemoteMedia('https://cdn.example.com/a')).rejects.toThrow('不允许访问');
  });
  it('enforces actual byte limits independent of Content-Length', async () => {
    await expect(readMediaBody(new Response('12345678'))).resolves.toEqual(Buffer.from('12345678'));
    await expect(readMediaBody(new Response('123456789'))).rejects.toThrow('大小限制');
    await expect(readMediaBody(new Response('1', { headers: { 'Content-Length': '9' } }))).rejects.toThrow('大小限制');
    await expect(readMediaBody(new Response(''))).rejects.toThrow('为空');
  });
});
