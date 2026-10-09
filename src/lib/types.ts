export type View = 'home' | 'chat' | 'image' | 'video' | 'music' | 'library';
export type MediaKind = 'image' | 'video' | 'music';
export interface Message { id: string; role: 'user' | 'assistant'; content: string; error?: string; interrupted?: boolean }
export interface Conversation { id: string; title: string; messages: Message[]; createdAt: number; updatedAt: number; model: string }
export interface Asset {
  id: string; kind: MediaKind; prompt: string; model: string; createdAt: number;
  status: 'pending' | 'completed' | 'failed'; remoteId?: string; url?: string; blob?: Blob;
  error?: string; options: Record<string, string | number>;
  imageWidth?: number;
  imageHeight?: number;
  lrc?: string;
  lrcSource?: 'estimated' | 'audio';
  lrcError?: string;
  audioDuration?: number;
  coverUrl?: string;
  coverStatus?: 'pending' | 'completed' | 'failed';
  coverError?: string;
  song?: SongDraft;
  lyrics?: string;
}
export type SongSectionType = 'intro' | 'verse' | 'chorus' | 'bridge' | 'outro';
export interface SongSection { id: string; type: SongSectionType; direction: string; lyrics: string }
export interface SongDraft { title: string; style: string; instrumental: boolean; sections: SongSection[] }
export interface Model { id: string; display_name?: string; available?: boolean }
export type ImageEngineMode = 'auto' | 'native' | 'upstream' | 'interactions';
export type AudioEngineMode = 'auto' | 'native' | 'upstream';
export interface Settings {
  key: string; rememberKey: boolean; chatModel: string; imageModel: string; videoModel: string; musicModel: string;
  systemPrompt: string; temperature: number; musicPath: string; musicExtra: string;
  imageEngineMode: ImageEngineMode;
  audioEngineMode: AudioEngineMode;
}
export const DEFAULT_SETTINGS: Settings = {
  key: '', rememberKey: false, chatModel: 'gemini-3.5-flash', imageModel: 'gemini-3.1-flash-image',
  videoModel: 'gemini-omni-1.1-flash', musicModel: 'lyria-3.5',
  systemPrompt: '你是小o，Olai（Online AI Chat Companion）的星球伙伴，一个温暖、善解人意且知识渊博的在线 AI 伴侣与创意助手。用“小o”介绍自己，默认用中文回答。陪伴用户畅聊日常、倾听心声、激发灵感并协助创作。', temperature: 0.7,
  musicPath: 'speech', musicExtra: '{}',
  imageEngineMode: 'auto',
  audioEngineMode: 'auto',
};

