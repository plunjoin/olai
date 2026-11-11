import { aiEnv, ALIGNMENT_SYSTEM_PROMPT, DEFAULT_SYSTEM_PROMPT, serverModel, SONG_SYSTEM_PROMPT, videoMode } from './aiConfig';
import { parseSong } from '../music';
import { songPrompt } from './songPrompt';
import { imageDimensions, normalizeRatio } from '../generation';
import { buildKeyframePrompt, buildMusicPrompt, buildScriptPrompt, buildShotListPrompt, buildVideoPrompt } from './workflowPrompts';
import type { MediaKind } from '../types';

export class InputError extends Error {}
const invalid = (): never => { throw new InputError('请提供有效的创作内容和参数。'); };
const text = (value: unknown, max = 10000): string => typeof value === 'string' && value.length <= max ? value : invalid();
const number = (value: unknown, fallback: number, min: number, max: number): number => value === undefined ? fallback : typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : invalid();
const pick = (value: unknown, values: string[], fallback: string): string => value === undefined ? fallback : typeof value === 'string' && values.includes(value) ? value : invalid();
const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : invalid();
export interface GenerationRequest { path: string; payload: Record<string, any>; kind: MediaKind | null; fallback?: { path: string; payload: Record<string, any> } }

function workflowInput(input: Record<string, any>) {
  if (aiEnv('AI_SHORT_FILM') !== 'true') throw new InputError('此创作功能尚未开放。');
  const elements = input.elements === undefined ? [] : input.elements;
  if (!Array.isArray(elements) || elements.length > 100) invalid();
  for (const e of elements) { object(e); text(e.id, 100); text(e.name, 200); text(e.description, 5000); pick(e.kind, ['character', 'scene', 'prop'], 'character'); }
  return elements;
}
function styleBible(value: unknown) {
  const style = object(value);
  return { appearance: text(style.appearance, 5000), wardrobe: text(style.wardrobe, 5000), artStyle: text(style.artStyle, 5000), palette: text(style.palette, 5000) };
}
function shotInput(value: unknown) {
  const s = object(value);
  return { id: text(s.id, 100), number: number(s.number, 1, 1, 1000), duration: number(s.duration, 4, 1, 30), sceneDescription: text(s.sceneDescription), framing: text(s.framing, 1000), cameraMovement: text(s.cameraMovement, 1000), elementIds: Array.isArray(s.elementIds) ? s.elementIds.filter((x: unknown) => typeof x === 'string').slice(0, 100) : [] };
}

// Build provider requests from a small application contract, never from arbitrary
// client provider payloads. Quota classification comes from this server decision.
export function buildGeneration(path: string, input: Record<string, any>): GenerationRequest {
  if ('model' in input || 'key' in input || 'apiKey' in input || 'systemPrompt' in input || 'system' in input) invalid();
  if (path === 'chat/completions') {
    const action = input.action || 'chat';
    let messages: any[] = [];
    let system = '';
    if (action === 'chat') {
      if (!Array.isArray(input.messages) || !input.messages.length || input.messages.length > 500) invalid();
      messages = input.messages.map((m: any) => ({ role: pick(m?.role, ['user', 'assistant'], 'user'), content: text(m?.content, 100000) }));
      system = aiEnv('AI_SYSTEM_PROMPT') || DEFAULT_SYSTEM_PROMPT;
    } else if (action === 'compose-song') {
      system = SONG_SYSTEM_PROMPT;
      messages = [{ role: 'user', content: `${text(input.inspiration)}\n风格偏好：${text(input.style || '', 2000) || '根据灵感选择'}\n${input.instrumental === true ? '必须为纯音乐，不要歌词。' : '遵循灵感中的人声偏好。'}` }];
    } else if (action === 'align-lyrics') {
      if (!Array.isArray(input.lines) || !input.lines.length || input.lines.length > 1000) invalid();
      const lines = input.lines.map((line: unknown) => text(line, 6000));
      const audio = text(input.audio, 48 * 1024 * 1024);
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) invalid();
      const duration = number(input.duration, 0, 0.01, 3600);
      system = ALIGNMENT_SYSTEM_PROMPT;
      messages = [{ role: 'user', content: [{ type: 'text', text: `音频实际时长：${duration.toFixed(3)} 秒。逐句校准以下歌词：\n${lines.map((line: string, i: number) => `${i}: ${line}`).join('\n')}` }, { type: 'input_audio', input_audio: { data: audio, format: 'wav' } }] }];
    } else if (action === 'workflow-script' || action === 'workflow-shots') {
      const elements = workflowInput(input);
      const duration = number(input.targetLength, 30, 5, 180);
      system = action === 'workflow-script' ? '你是一位专业的短视频编剧。输出格式严格为 JSON，不要添加任何其他说明文字。' : '你是一位专业的短片导演。输出格式严格为 JSON 数组，不要添加任何其他说明文字。';
      messages = [{ role: 'user', content: action === 'workflow-script' ? buildScriptPrompt(text(input.idea), duration, elements) : buildShotListPrompt(text(input.script, 50000), styleBible(input.styleBible), duration, elements) }];
    } else invalid();
    return { path: 'chat/completions', kind: null, payload: { model: serverModel('chat'), stream: action === 'chat' && input.stream === true, temperature: action === 'align-lyrics' ? 0 : number(input.temperature, .7, 0, 2), messages: [{ role: 'system', content: system }, ...messages] } };
  }
  const kind = path === 'generate/image' ? 'image' : path === 'generate/music' ? 'music' : path === 'generate/video' ? 'video' : invalid();
  let prompt = text(input.prompt || '', 100000);
  if (input.action?.startsWith('workflow-')) {
    const elements = workflowInput(input);
    const style = styleBible(input.styleBible);
    if (input.action === 'workflow-keyframe' && kind === 'image') prompt = buildKeyframePrompt(shotInput(input.shot), style, elements);
    else if (input.action === 'workflow-video' && kind === 'video') prompt = buildVideoPrompt(shotInput(input.shot), style, input.hasKeyframe === true, elements);
    else if (input.action === 'workflow-music' && kind === 'music') prompt = buildMusicPrompt(text(input.script, 50000), style, number(input.duration, 30, 1, 600));
    else invalid();
  } else if (input.action === 'cover' && kind === 'image') {
    const song = input.song ? parseSong(JSON.stringify(input.song)) : undefined;
    prompt = `为原创歌曲设计一张精美的方形专辑封面，以视觉画面表达歌曲主题与情绪，构图完整，适合音乐作品展示。只生成一张封面图片。\n歌曲：${song?.title || prompt.slice(0, 100)}\n音乐风格：${song?.style || '根据主题设计'}\n主题灵感：${text(input.inspiration || prompt, 100000).slice(0, 3000)}\n歌词意象：${(song ? song.sections.map(s => s.lyrics).join('\n') : text(input.lyrics || '', 100000)).slice(0, 3000)}\n无需文字，不要水印。`;
  } else if (input.action !== undefined) invalid();
  if (!prompt.trim() && !input.song) invalid();
  if (kind === 'image') {
    const ratio = input.action === 'cover' ? '1:1' : normalizeRatio(text(input.aspectRatio || 'auto', 40));
    const quality = pick(input.imageSize, ['1K', '2K', '4K'], '1K');
    const effort = pick(input.reasoningEffort, ['minimal', 'medium', 'high'], 'medium');
    const model = serverModel('image');
    const native = { path: 'chat/completions', payload: { model, messages: [{ role: 'user', content: `${prompt}\n画面比例：${ratio === 'auto' ? '自动，根据描述构图' : ratio}。联想等级：${effort}。只生成图片，不输出文字说明。` }], stream: false, image_size: quality, max_tokens: quality === '4K' ? 8192 : quality === '2K' ? 4096 : 2048 } };
    const upstream = { path: 'images/generations', payload: { model, prompt: `${prompt}\n画面比例：${ratio}。画质：${quality}。联想等级：${effort}。`, n: 1, size: imageDimensions(ratio, quality), response_format: 'b64_json' } };
    const mode = aiEnv('AI_IMAGE_API_MODE', 'auto');
    if (mode === 'interactions') {
      const ratios = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9', '1:8', '8:1', '1:4', '4:1'];
      return { kind, path: 'interactions', payload: { model, input: native.payload.messages[0].content, response_format: { type: 'image', image_size: quality, delivery: 'inline', ...(ratios.includes(ratio) ? { aspect_ratio: ratio } : {}) }, stream: false, store: false } };
    }
    if (mode === 'upstream' || (mode === 'auto' && /^(dall-e|flux|sd|stable-diffusion)/i.test(model))) return { kind, ...upstream, ...(mode === 'auto' ? { fallback: native } : {}) };
    return { kind, ...native, ...(mode === 'auto' ? { fallback: upstream } : {}) };
  }
  if (kind === 'music') {
    if (input.song) prompt = songPrompt(parseSong(JSON.stringify(input.song)));
    const duration = input.duration === undefined ? '' : `\nTarget duration: ${number(input.duration, 120, 1, 600)} seconds.`;
    if (aiEnv('AI_AUDIO_API_MODE') === 'upstream') return { kind, path: 'audio/speech', payload: { model: serverModel(kind), input: prompt, voice: text(input.voice || 'alloy', 100), speed: number(input.speed, 1, .25, 4), response_format: pick(input.responseFormat, ['mp3', 'wav', 'opus', 'aac', 'flac', 'pcm'], 'mp3') } };
    return { kind, path: 'chat/completions', payload: { model: serverModel(kind), messages: [{ role: 'user', content: `${prompt}${duration}\nReturn the generated audio.` }], stream: false } };
  }
  const options = object(input.options || {});
  const resolution = pick(typeof options.resolution === 'string' ? options.resolution.toLowerCase() : undefined, ['360p', '720p', '1080p', '4k'], '720p');
  const ratio = pick(options.aspect_ratio, ['16:9', '9:16'], '16:9');
  const effort = pick(options.reasoning_effort, ['minimal', 'medium', 'high'], 'medium');
  const model = serverModel('video');
  if (videoMode() === 'chat') {
    const seconds = number(options.seconds, 4, 3, 10);
    if (!Number.isInteger(seconds) || input.extendFrom || input.inputReference) invalid();
    return { kind, path: 'chat/completions', payload: { model, messages: [{ role: 'user', content: `请根据以下描述生成视频，返回生成的视频文件或视频链接。\n${prompt}\n目标时长：${seconds} 秒。\n画面比例：${ratio}。\n目标画质：${resolution.toUpperCase()}。\n创意丰富程度：${effort}。` }], stream: false, resolution } };
  }
  const size = { '360p': [640, 360], '720p': [1280, 720], '1080p': [1920, 1080], '4k': [3840, 2160] }[resolution]!;
  const payload: Record<string, any> = { model, prompt: `${input.extendFrom ? 'Extend this video. ' : ''}${prompt}\n创意丰富程度：${effort}。`, size: (ratio === '9:16' ? [...size].reverse() : size).join('x') };
  if (/^veo[-.]/i.test(model)) {
    payload.seconds = resolution === '4k' ? 8 : number(options.seconds, 4, 4, 8);
    if (!Number.isInteger(payload.seconds)) invalid();
  }
  if (input.inputReference !== undefined) { const image = text(input.inputReference, 20 * 1024 * 1024); if (!/^[A-Za-z0-9+/]+={0,2}$/.test(image)) invalid(); payload.input_reference = image; }
  // extend_from must be decoded and ownership-checked by the route, never trusted.
  return { kind, path: 'videos', payload };
}
