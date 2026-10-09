export type VideoEngineMode = 'chat' | 'task';

export function videoEngineForModel(model: string): VideoEngineMode {
  return /^veo[-.]/i.test(model) ? 'task' : 'chat';
}

export const VIDEO_SECONDS_RANGE = { min: 4, max: 8 };
export const VIDEO_4K_MIN_SECONDS = 8;
