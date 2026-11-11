import { afterEach, describe, expect, it, vi } from 'vitest';
import * as clientModels from '../models';
import { DEFAULT_SETTINGS } from '../types';
import { SERVER_MODELS, serverModel, videoMode } from '../server/aiConfig';

afterEach(() => vi.unstubAllEnvs());

describe('server-only model configuration', () => {
  it('does not expose model discovery or selection utilities to clients', () => {
    expect(Object.keys(clientModels)).toEqual([]);
    for (const field of ['chatModel', 'imageModel', 'musicModel', 'videoModel']) expect(DEFAULT_SETTINGS).not.toHaveProperty(field);
  });

  it('uses the configured server defaults for each creative capability', () => {
    expect(SERVER_MODELS).toEqual({ chat: 'gemini-3.5-flash', image: 'gemini-3.1-flash-image', music: 'lyria-3.5', video: 'gemini-omni-1.1-flash' });
    for (const kind of ['chat', 'image', 'music', 'video'] as const) {
      vi.stubEnv(`AI_${kind.toUpperCase()}_MODEL`, '');
      expect(serverModel(kind)).toBe(SERVER_MODELS[kind]);
    }
  });

  it.each(['chat', 'image', 'music', 'video'] as const)('resolves %s overrides only from server configuration', kind => {
    vi.stubEnv(`AI_${kind.toUpperCase()}_MODEL`, `private-${kind}-engine`);
    expect(serverModel(kind)).toBe(`private-${kind}-engine`);
    expect(JSON.stringify(DEFAULT_SETTINGS)).not.toContain(`private-${kind}-engine`);
  });

  it('selects task video mode for Veo and explicitly enabled async engines', () => {
    vi.stubEnv('AI_VIDEO_MODEL', SERVER_MODELS.video); vi.stubEnv('AI_VIDEO_OMNI_ASYNC', 'false');
    expect(videoMode()).toBe('chat');
    vi.stubEnv('AI_VIDEO_OMNI_ASYNC', 'true'); expect(videoMode()).toBe('task');
    vi.stubEnv('AI_VIDEO_OMNI_ASYNC', 'false'); vi.stubEnv('AI_VIDEO_MODEL', 'veo-3.1-fast-generate-preview');
    expect(videoMode()).toBe('task');
  });
});
