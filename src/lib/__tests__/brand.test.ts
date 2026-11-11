import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../types';
import { DEFAULT_SYSTEM_PROMPT, SERVER_MODELS } from '../server/aiConfig';

describe('Olai configuration and brand boundary', () => {
  it('keeps the Olai companion preset on the server', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain('Olai');
    expect(DEFAULT_SYSTEM_PROMPT).toContain('Online AI Chat Companion');
    expect(DEFAULT_SYSTEM_PROMPT).toContain('小o');
    expect(DEFAULT_SETTINGS).not.toHaveProperty('systemPrompt');
    expect(JSON.stringify(DEFAULT_SETTINGS)).not.toContain(DEFAULT_SYSTEM_PROMPT);
  });

  it('keeps default engine identifiers on the server', () => {
    expect(SERVER_MODELS.chat).toBe('gemini-3.5-flash');
    for (const field of ['chatModel', 'imageModel', 'videoModel', 'musicModel', 'key', 'apiKey']) expect(DEFAULT_SETTINGS).not.toHaveProperty(field);
  });
});
