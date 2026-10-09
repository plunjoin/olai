export type VideoEngineMode = 'chat' | 'task';

export function videoEngineForModel(model: string, asyncMode?: boolean): VideoEngineMode {
  if (/^veo[-.]/i.test(model)) return 'task';
  // Omni 可以是 chat (sync) 或 task (async)
  if (/omni/i.test(model) && asyncMode) return 'task';
  return 'chat';
}

export const VIDEO_SECONDS_RANGE = { min: 4, max: 8 };
export const VIDEO_4K_MIN_SECONDS = 8;
export const OMNI_SEGMENT_DURATION = 10; // Omni 每段固定 10 秒
export const OMNI_MAX_EXTEND_DURATION = 30; // Omni 连续长镜头最大 30 秒（可配置到 40 秒）
