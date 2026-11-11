// Server-only configuration. Never import this module from a hydrated component.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export const SERVER_MODELS = {
  chat: 'gemini-3.5-flash', image: 'gemini-3.1-flash-image',
  video: 'gemini-omni-1.1-flash', music: 'lyria-3.5',
} as const;
export const DEFAULT_SYSTEM_PROMPT = '你是小o，Olai（Online AI Chat Companion）的星球伙伴，一个温暖、善解人意且知识渊博的在线 AI 伴侣与创意助手。用“小o”介绍自己，默认用中文回答。陪伴用户畅聊日常、倾听心声、激发灵感并协助创作。';
export const SONG_SYSTEM_PROMPT = '你是专业作词和编曲助手。将灵感整理为可编辑的完整歌曲。只返回 JSON: {"title":"歌曲名","style":"流派、节奏、乐器、人声和氛围","instrumental":false,"sections":[{"type":"intro|verse|chorus|bridge|outro","direction":"该段编曲说明","lyrics":"该段实际歌词，换行分句"}]}。按音乐逻辑安排段落，可重复 verse/chorus。保留用户已给出的歌词，不要把编曲说明混入歌词。用户明确要求无人声时 instrumental=true 且所有 lyrics 为空。否则根据主题写歌词，语言跟随用户。至少包含 intro, verse, chorus, bridge, outro。';
export const ALIGNMENT_SYSTEM_PROMPT = '你是音频歌词对齐助手。必须聆听提供的实际音频，标出每句歌词人声开始与结束的秒数，包含前奏、间奏、尾奏留白。禁止按总时长平均分配或猜测。按编号返回每一句（包括重复句），只返回 JSON: {"lines":[{"index":0,"start":12.34,"end":15.67}]}。index 从 0 开始，start/end 必须是实际秒数、递增且不重叠。未听到的句子或无法访问音频时返回 {"lines":[]}。';
export function aiEnv(name: string, fallback = ''): string {
  return process.env[name] ?? import.meta.env[name] ?? fallback;
}
export function serverModel(kind: keyof typeof SERVER_MODELS): string {
  return aiEnv(`AI_${kind.toUpperCase()}_MODEL`) || SERVER_MODELS[kind];
}
export function serviceReady(): boolean { return Boolean(aiEnv('AI_API_KEY') && aiEnv('AI_API_BASE_URL')); }
export function videoMode(): 'chat' | 'task' {
  return /^veo[-.]/i.test(serverModel('video')) || aiEnv('AI_VIDEO_OMNI_ASYNC') === 'true' ? 'task' : 'chat';
}
const taskKey = () => createHash('sha256').update(aiEnv('AI_API_KEY')).digest();
export function encodeTaskId(id: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', taskKey(), iv);
  const data = Buffer.concat([cipher.update(id, 'utf8'), cipher.final()]);
  return `job_${Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url')}`;
}
export function decodeTaskId(id: string): string {
  if (!id.startsWith('job_')) throw new Error('Invalid task');
  const bytes = Buffer.from(id.slice(4), 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', taskKey(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
}
