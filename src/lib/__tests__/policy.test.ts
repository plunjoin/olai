import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatConcurrencyLimit, chatDailyLimit, chatRateLimit, clientIP, dailyLimit, dayKey, generationKind, sameOrigin } from '../server/policy';

afterEach(() => vi.unstubAllEnvs());
describe('daily generation policy', () => {
  it('uses separate guest and account limits and accepts zero', () => {
    vi.stubEnv('GUEST_DAILY_GENERATION_LIMIT', '1'); vi.stubEnv('USER_DAILY_GENERATION_LIMIT', '15');
    expect(dailyLimit(false)).toBe(1); expect(dailyLimit(true)).toBe(15);
    vi.stubEnv('GUEST_DAILY_GENERATION_LIMIT', '0'); expect(dailyLimit(false)).toBe(0);
    vi.stubEnv('USER_DAILY_GENERATION_LIMIT', '3'); expect(dailyLimit(true)).toBe(3);
    vi.stubEnv('USER_DAILY_GENERATION_LIMIT', '-1'); expect(() => dailyLimit(true)).toThrow();
    vi.stubEnv('USER_DAILY_GENERATION_LIMIT', 'abc'); expect(() => dailyLimit(true)).toThrow();
  });
  it('resets on Beijing midnight', () => {
    expect(dayKey(Date.parse('2026-10-07T15:59:59Z'))).toBe('2026-10-07');
    expect(dayKey(Date.parse('2026-10-07T16:00:00Z'))).toBe('2026-10-08');
  });
  it('applies chat daily, rate and concurrency limits with defaults and validation', () => {
    expect(chatDailyLimit(false)).toBe(100); expect(chatDailyLimit(true)).toBe(100);
    vi.stubEnv('USER_DAILY_CHAT_LIMIT', '5'); expect(chatDailyLimit(true)).toBe(5);
    vi.stubEnv('GUEST_DAILY_CHAT_LIMIT', '0'); expect(chatDailyLimit(false)).toBe(0);
    vi.stubEnv('CHAT_RATE_LIMIT', '60'); expect(chatRateLimit()).toBe(60);
    vi.stubEnv('CHAT_RATE_LIMIT', '0'); expect(chatRateLimit()).toBe(0);
    vi.stubEnv('CHAT_CONCURRENT_LIMIT', '3'); expect(chatConcurrencyLimit()).toBe(3);
    vi.stubEnv('CHAT_CONCURRENT_LIMIT', '-2'); expect(() => chatConcurrencyLimit()).toThrow();
    vi.stubEnv('CHAT_CONCURRENT_LIMIT', 'abc'); expect(() => chatConcurrencyLimit()).toThrow();
  });
  it('counts media only by exact public generation routes', () => {
    expect(generationKind('generate/image', { prompt: 'flowers' })).toBe('image');
    expect(generationKind('generate/music', { prompt: 'a song' })).toBe('music');
    expect(generationKind('generate/video', { prompt: 'a film' })).toBe('video');
  });
  it.each(['chat', 'compose-song', 'align-lyrics', 'workflow-script', 'workflow-shots'])('classifies text action %s without inferring a model', action => {
    expect(generationKind('chat/completions', { action })).toBeNull();
  });
  it.each(['images/generations', 'audio/speech', 'videos', 'interactions', 'generate/image/extra', 'generate/unknown'])('rejects private or unsupported path %s', path => {
    expect(() => generationKind(path, { model: 'gemini-3.1-flash-image', response_format: { type: 'image' } })).toThrow();
  });
  it.each(['generate-image', 'workflow-keyframe', 'unknown', 42])('rejects unsupported text action %s', action => {
    expect(() => generationKind('chat/completions', { action })).toThrow();
  });
  it('does not accept a model identifier in place of a public text action', () => {
    expect(() => generationKind('chat/completions', { model: 'lyria-3.5' })).toThrow();
  });
  it('uses the peer IP unless the trusted proxy setting is enabled', () => {
    vi.stubEnv('TRUST_PROXY', 'false');
    const request = new Request('http://localhost/', { headers: { 'x-forwarded-for': '203.0.113.10, 127.0.0.1' } });
    expect(() => clientIP(request, '203.0.113.10')).toThrow();
    expect(clientIP(new Request('http://localhost/'), '::ffff:127.0.0.1')).toBe('127.0.0.1');
    vi.stubEnv('TRUST_PROXY', 'true'); expect(clientIP(request, '127.0.0.1')).toBe('203.0.113.10');
    expect(() => clientIP(new Request('http://localhost/'), 'unknown')).toThrow();
  });
  it('validates mutations against the configured public origin', () => {
    vi.stubEnv('SITE_ORIGIN', 'https://olai.example.com');
    expect(sameOrigin(new Request('http://localhost/api/auth/login', { headers: { origin: 'https://olai.example.com' } }))).toBe(true);
    expect(sameOrigin(new Request('http://localhost/api/auth/login', { headers: { origin: 'https://another.example.com' } }))).toBe(false);
    expect(sameOrigin(new Request('http://localhost/api/auth/login'))).toBe(false);
    vi.stubEnv('SITE_ORIGIN', 'https://olai.example.com/');
    expect(sameOrigin(new Request('http://localhost/api/auth/login', { headers: { origin: 'https://olai.example.com' } }))).toBe(true);
  });
  it('uses actual Host and port when the Node adapter normalizes the request URL', () => {
    vi.stubEnv('SITE_ORIGIN', '');
    for (const host of ['localhost:4321', '127.0.0.1:4321', '[::1]:4321', '192.168.31.27:4321']) {
      expect(sameOrigin(new Request('http://localhost/api/auth/login', { headers: { host, origin: `http://${host}` } }))).toBe(true);
    }
    expect(sameOrigin(new Request('http://localhost:4321/api/auth/login', { headers: { origin: 'http://localhost:4321' } }))).toBe(true);
  });
  it('rejects mismatched hosts, ports, schemes and spoofed forwarded hosts', () => {
    vi.stubEnv('SITE_ORIGIN', '');
    for (const origin of ['http://localhost', 'http://localhost:4322', 'https://localhost:4321', 'http://evil.example', 'null', 'http://localhost:4321/path', 'invalid']) {
      expect(sameOrigin(new Request('http://localhost/api/auth/login', { headers: { host: 'localhost:4321', origin, 'x-forwarded-host': 'evil.example' } }))).toBe(false);
    }
    expect(sameOrigin(new Request('http://localhost/api/auth/login', { headers: { host: 'localhost:4321' } }))).toBe(false);
    expect(sameOrigin(new Request('http://localhost/api/auth/login', { headers: { host: 'localhost:4321/extra', origin: 'http://localhost:4321' } }))).toBe(false);
    vi.stubEnv('SITE_ORIGIN', 'invalid');
    expect(sameOrigin(new Request('http://localhost:4321/api/auth/login', { headers: { origin: 'http://localhost:4321' } }))).toBe(false);
  });
});
