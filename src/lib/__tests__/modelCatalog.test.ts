import { describe, expect, it } from 'vitest';
import { defaultPrices, guessKind, modelPoints, normalizePrices, publicIdFor } from '../server/models';

describe('model catalog', () => {
  it('guesses kinds from common gateway model names', () => {
    expect(guessKind('gemini-3.1-flash-image')).toBe('image');
    expect(guessKind('gpt-image-1')).toBe('image');
    expect(guessKind('nano-banana')).toBe('image');
    expect(guessKind('veo-3.1-fast-generate-preview')).toBe('video');
    expect(guessKind('gemini-omni-1.1-flash')).toBe('video');
    expect(guessKind('seedance-1.0-pro')).toBe('video');
    expect(guessKind('lyria-3.5')).toBe('music');
    expect(guessKind('tts-1-hd')).toBe('music');
    expect(guessKind('gemini-3.5-flash')).toBe('chat');
    expect(guessKind('text-embedding-3-large')).toBe('chat');
  });

  it('gives every upstream model a stable, opaque public id', () => {
    const id = publicIdFor('gemini-3.5-flash');
    expect(id).toMatch(/^mdl_[a-f0-9]{24}$/);
    expect(id).not.toContain('gemini');
    expect(publicIdFor('gemini-3.5-flash')).toBe(id);
    expect(publicIdFor('gemini-3.5-pro')).not.toBe(id);
  });

  it('charges the configured tier for images and per second for videos', () => {
    const image = {
      publicId: 'mdl_x', upstreamId: 'private-image', kind: 'image' as const,
      prices: normalizePrices('image', { image: { '1K': 3, '2K': 5, '4K': 9 } }),
    };
    expect(modelPoints(image, { quality: '1K' })).toBe(3);
    expect(modelPoints(image, { quality: '2K' })).toBe(5);
    expect(modelPoints(image, { quality: '4K' })).toBe(9);

    const video = {
      publicId: 'mdl_y', upstreamId: 'private-video', kind: 'video' as const,
      prices: normalizePrices('video', { video: { '360p': 1, '720p': 2, '1080p': 4, '4k': 8 } }),
    };
    expect(modelPoints(video, { resolution: '1080p', seconds: 5 })).toBe(20);
    expect(modelPoints(video, { resolution: '720p', seconds: 4.2 })).toBe(10);
  });

  it('charges music per started minute and chat per message', () => {
    const music = {
      publicId: 'mdl_m', upstreamId: 'private-music', kind: 'music' as const,
      prices: normalizePrices('music', { music: { perMinute: 6 } }),
    };
    expect(modelPoints(music, { seconds: 30 })).toBe(6);
    expect(modelPoints(music, { seconds: 90 })).toBe(12);

    const chat = {
      publicId: 'mdl_c', upstreamId: 'private-chat', kind: 'chat' as const,
      prices: normalizePrices('chat', { chat: { perMessage: 2 } }),
    };
    expect(modelPoints(chat, {})).toBe(2);
  });

  it('rejects malformed or negative prices', () => {
    expect(() => normalizePrices('image', { image: { '1K': 1, '2K': -1, '4K': 4 } })).toThrow();
    expect(() => normalizePrices('image', { image: { '1K': 'free' } })).toThrow();
    expect(() => normalizePrices('chat', { chat: { perMessage: 1.5 } })).toThrow();
    expect(() => normalizePrices('video', {})).toThrow();
  });

  it('provides a complete default price table for every kind', () => {
    expect(Object.keys(defaultPrices('image').image ?? {})).toEqual(['1K', '2K', '4K']);
    expect(Object.keys(defaultPrices('video').video ?? {})).toEqual(['360p', '720p', '1080p', '4k']);
    expect(defaultPrices('music').music?.perMinute).toBeGreaterThan(0);
    expect(defaultPrices('chat').chat?.perMessage).toBeGreaterThanOrEqual(0);
  });
});
