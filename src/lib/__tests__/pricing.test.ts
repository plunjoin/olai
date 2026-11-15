import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatCost, imageCost, inviteDailyLimit, musicCost, publicPrices, signupBonus, videoCost } from '../server/pricing';

afterEach(() => vi.unstubAllEnvs());

describe('point pricing', () => {
  it('prices each media tier by the public quality options', () => {
    expect(imageCost('1K')).toBe(1);
    expect(imageCost('2K')).toBe(2);
    expect(imageCost('4K')).toBe(4);
    expect(videoCost('720p', 4)).toBe(8);
    expect(videoCost('4k', 8)).toBe(64);
    expect(musicCost(30)).toBe(2);
    expect(musicCost(120)).toBe(4);
    expect(chatCost()).toBe(0);
    expect(signupBonus()).toBe(100);
    expect(inviteDailyLimit()).toBe(5);
  });
  it('reads server-side overrides and rejects invalid values', () => {
    vi.stubEnv('POINT_IMAGE_4K', '9');
    expect(imageCost('4K')).toBe(9);
    vi.stubEnv('POINT_VIDEO_1080P', '6');
    expect(videoCost('1080p', 3)).toBe(18);
    vi.stubEnv('POINT_MUSIC_PER_MINUTE', 'abc');
    expect(() => musicCost(60)).toThrow();
    vi.stubEnv('POINT_CHAT', '-1');
    expect(() => chatCost()).toThrow();
  });
  it('publishes only public tiers and prices', () => {
    const prices = publicPrices();
    expect(Object.keys(prices.image)).toEqual(['1K', '2K', '4K']);
    expect(Object.keys(prices.video)).toEqual(['360p', '720p', '1080p', '4k']);
    expect(JSON.stringify(prices)).not.toMatch(/gemini|lyria|veo|model/i);
  });
});
