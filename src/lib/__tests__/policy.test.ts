import { afterEach, describe, expect, it, vi } from 'vitest';
import { clientIP, dailyLimit, dayKey, generationKind, sameOrigin } from '../server/policy';
import { DEFAULT_SETTINGS } from '../types';

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
  it('counts native media and aliases, leaves text unlimited, and rejects unknown engines', () => {
    expect(generationKind('chat/completions', { model: DEFAULT_SETTINGS.imageModel })).toBe('image');
    expect(generationKind('chat/completions', { model: DEFAULT_SETTINGS.musicModel })).toBe('music');
    expect(generationKind('chat/completions', { model: DEFAULT_SETTINGS.chatModel })).toBeNull();
    vi.stubEnv('AI_IMAGE_MODEL', 'gateway-image');
    expect(generationKind('chat/completions', { model: 'gateway-image' })).toBe('image');
    expect(generationKind('images/generations', { model: 'custom-image' })).toBe('image');
    expect(generationKind('audio/speech', {})).toBe('music');
    expect(generationKind('videos', {})).toBe('video');
    expect(() => generationKind('chat/completions', { model: 'unknown' })).toThrow();
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
  });
});
