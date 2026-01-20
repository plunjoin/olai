import { describe, it, expect } from 'vitest';
import { getModelCategory, formatModelDisplayName, pickBestAvailableModel, enrichModel } from '../models';

describe('models utility', () => {
  it('correctly categorizes models based on their identifier', () => {
    expect(getModelCategory('gemini-3.8-flash')).toBe('chat');
    expect(getModelCategory('deep-research-preview-04-2026')).toBe('chat');
    expect(getModelCategory('gemini-3.1-flash-image')).toBe('image');
    expect(getModelCategory('gemini-nano-banana-2.1')).toBe('image');
    expect(getModelCategory('gemini-omni-1.1-flash')).toBe('chat');
    expect(getModelCategory('veo-3.1-fast-generate-preview')).toBe('video');
    expect(getModelCategory('lyria-3.5')).toBe('music');
    expect(getModelCategory('gemini-2.5-flash-preview-tts')).toBe('music');
  });

  it('formats display names beautifully', () => {
    expect(formatModelDisplayName('gemini-3.8-flash')).toBe('Gemini 3.8 Flash');
    expect(formatModelDisplayName('veo-3.1-fast-generate-preview')).toBe('Veo 3.1 Fast (Video)');
    expect(formatModelDisplayName('lyria-3.5')).toBe('Lyria 3.5 (Music)');
  });

  it('dynamically picks the best available model without hardcoding', () => {
    const upstreamModels = [
      { id: 'antigravity-preview-05-2026' },
      { id: 'gemini-3.8-flash' },
      { id: 'gemini-3.1-flash-image' },
      { id: 'veo-3.1-fast-generate-preview' },
      { id: 'lyria-3.5' },
    ];

    expect(pickBestAvailableModel(upstreamModels, 'chat')).toBe('gemini-3.8-flash');
    expect(pickBestAvailableModel(upstreamModels, 'image')).toBe('gemini-3.1-flash-image');
    expect(pickBestAvailableModel(upstreamModels, 'video')).toBe('veo-3.1-fast-generate-preview');
    expect(pickBestAvailableModel(upstreamModels, 'music')).toBe('lyria-3.5');
  });

  it('respects existing user preference if it exists in the available list', () => {
    const upstreamModels = [
      { id: 'gemini-3.8-flash' },
      { id: 'gemini-3.7-flash' },
    ];

    expect(pickBestAvailableModel(upstreamModels, 'chat', 'gemini-3.7-flash')).toBe('gemini-3.7-flash');
  });

  it('enriches model with capabilities and badges', () => {
    const enriched = enrichModel({ id: 'gemini-3.8-flash' });
    expect(enriched.category).toBe('chat');
    expect(enriched.categoryLabel).toBe('对话模型');
    expect(enriched.tags).toContain('Gen-3+');
    expect(enriched.tags).toContain('Ultra-Fast');
  });
});
