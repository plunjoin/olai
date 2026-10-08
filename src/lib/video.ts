export type VideoEngineMode = 'chat' | 'task';

export function videoEngineForModel(model: string): VideoEngineMode {
  return /^veo[-.]/i.test(model) ? 'task' : 'chat';
}
