import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../types';

describe('Olai Configuration & Brand', () => {
  it('default system prompt contains Olai companion branding', () => {
    expect(DEFAULT_SETTINGS.systemPrompt).toContain('Olai');
    expect(DEFAULT_SETTINGS.systemPrompt).toContain('Online AI Chat Companion');
    expect(DEFAULT_SETTINGS.systemPrompt).toContain('小o');
  });

  it('default chat model is set', () => {
    expect(DEFAULT_SETTINGS.chatModel).toBe('gemini-3.8-flash');
  });
});
