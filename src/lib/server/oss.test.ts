import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const sdk = vi.hoisted(() => ({
  construct: vi.fn(), put: vi.fn(), delete: vi.fn(), getStream: vi.fn(),
}));
vi.mock('node:module', async importOriginal => {
  const original = await importOriginal<typeof import('node:module')>();
  return { ...original, createRequire: () => () => class {
    constructor(options: unknown) { sdk.construct(options); }
    put = sdk.put;
    delete = sdk.delete;
    getStream = sdk.getStream;
  } };
});
import { deleteOSS, mediaMaxBytes, ossEnabled, ossSettings, putOSS, readOSS } from './oss';
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('OSS_ENABLED', 'true');
  vi.stubEnv('OSS_REGION', 'oss-cn-test');
  vi.stubEnv('OSS_BUCKET', 'magicfang-linux-dev');
  vi.stubEnv('OSS_PREFIX', 'opt/olai');
  vi.stubEnv('OSS_ACCESS_KEY_ID', 'FAKE_TEST_ID_NOT_REAL');
  vi.stubEnv('OSS_ACCESS_KEY_SECRET', 'FAKE_TEST_SECRET_NOT_REAL');
  vi.stubEnv('OSS_MAX_FILE_BYTES', String(256 * 1024 * 1024));
  vi.stubEnv('OSS_MEDIA_RATE_LIMIT', '60');
  vi.stubEnv('OSS_MEDIA_DAILY_BYTES', String(1024 * 1024 * 1024));
  sdk.put.mockResolvedValue({ url: 'https://private.oss.invalid/secret' });
  sdk.delete.mockResolvedValue({});
});
afterEach(() => vi.unstubAllEnvs());

describe('OSS private minimal adapter (no network)', () => {
  it('is disabled without constructing an SDK client', () => {
    vi.stubEnv('OSS_ENABLED', 'false');
    vi.stubEnv('OSS_ACCESS_KEY_SECRET', '');
    expect(ossEnabled()).toBe(false);
    expect(sdk.construct).not.toHaveBeenCalled();
  });
  it('exposes only safe upload settings and the shared byte limit', () => {
    expect(ossEnabled()).toBe(true);
    expect(ossSettings()).toEqual({ prefix: 'opt/olai', maxFileBytes: 256 * 1024 * 1024 });
    expect(mediaMaxBytes()).toBe(256 * 1024 * 1024);
    expect(sdk.construct).not.toHaveBeenCalled();
  });
  it.each(['OSS_REGION', 'OSS_BUCKET', 'OSS_PREFIX', 'OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET'])('fails closed for missing %s', name => {
    vi.stubEnv(name, '');
    expect(() => ossEnabled()).toThrow('私有媒体服务暂不可用。');
  });
  it.each([
    ['OSS_REGION', 'https://evil.test'], ['OSS_PREFIX', '../private'],
    ['OSS_PREFIX', 'safe//unsafe'], ['OSS_BUCKET', 'invalid/host'],
    ['OSS_MAX_FILE_BYTES', '0'], ['OSS_MAX_FILE_BYTES', '-1'],
    ['OSS_MAX_FILE_BYTES', String(2 ** 32)], ['OSS_MEDIA_RATE_LIMIT', 'oops'],
    ['OSS_MEDIA_DAILY_BYTES', 'Infinity'],
    ['OSS_MEDIA_READ_RATE_LIMIT', '-1'], ['OSS_MEDIA_READ_DAILY_BYTES', 'Infinity'],
  ])('rejects invalid setting %s=%s', (name, value) => {
    vi.stubEnv(name, value);
    expect(() => ossEnabled()).toThrow('私有媒体服务暂不可用。');
  });
  it('puts over TLS with explicit private object ACL and never returns SDK metadata', async () => {
    const result = await putOSS('opt/olai/test/file.png', new Uint8Array([1, 2]), 'image/png');
    expect(result).toBeUndefined();
    expect(sdk.construct).toHaveBeenCalledWith(expect.objectContaining({ secure: true, timeout: 60_000 }));
    expect(sdk.put).toHaveBeenCalledWith('opt/olai/test/file.png', Buffer.from([1, 2]), { mime: 'image/png', headers: { 'x-oss-object-acl': 'private' } });
  });
  it('forwards only a normalized Range request and returns only the stream', async () => {
    const stream = Readable.from(['test']);
    sdk.getStream.mockResolvedValue({ stream, res: { headers: { Location: 'https://secret.invalid', 'x-oss-request-id': 'SECRET' } } });
    expect(await readOSS('object-key', 'bytes=0-3')).toBe(stream);
    expect(sdk.getStream).toHaveBeenCalledWith('object-key', { headers: { Range: 'bytes=0-3' } });
    await readOSS('object-key');
    expect(sdk.getStream).toHaveBeenLastCalledWith('object-key', { headers: {} });
  });
  it('retries delete on transient failures', async () => {
    sdk.delete.mockRejectedValueOnce(new Error('secret')).mockRejectedValueOnce(new Error('secret'));
    await deleteOSS('object-key');
    expect(sdk.delete).toHaveBeenCalledTimes(3);
  });
  it('masks all SDK errors and never logs credentials, hosts or object keys', async () => {
    const log = vi.spyOn(console, 'error');
    sdk.put.mockRejectedValue(new Error('SECRET_HOST_AND_KEY'));
    sdk.getStream.mockRejectedValue(new Error('SECRET_HOST_AND_KEY'));
    sdk.delete.mockRejectedValue(new Error('SECRET_HOST_AND_KEY'));
    await expect(putOSS('private-key', new Uint8Array([1]), 'image/png')).rejects.toThrow('私有媒体服务暂不可用。');
    await expect(readOSS('private-key')).rejects.toThrow('私有媒体服务暂不可用。');
    await expect(deleteOSS('private-key')).rejects.toThrow('私有媒体服务暂不可用。');
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
