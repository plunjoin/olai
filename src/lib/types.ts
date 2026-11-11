export type View = 'home' | 'chat' | 'image' | 'video' | 'music' | 'library' | 'gallery' | 'workflow';
export type MediaKind = 'image' | 'video' | 'music';
export interface Message { id: string; role: 'user' | 'assistant'; content: string; error?: string; interrupted?: boolean }
export interface Conversation { id: string; title: string; messages: Message[]; createdAt: number; updatedAt: number }
export interface Asset {
  id: string; kind: MediaKind; prompt: string; createdAt: number;
  status: 'pending' | 'completed' | 'failed'; remoteId?: string; url?: string; blob?: Blob;
  /** Public gallery only: resized copy of `url`/`coverUrl` for grid cards. */
  thumbnail?: string; coverThumbnail?: string;
  error?: string; options: Record<string, string | number>;
  imageWidth?: number;
  imageHeight?: number;
  lrc?: string;
  lyricsUrl?: string;
  lrcUrl?: string;
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
export type ModelKind = 'chat' | 'image' | 'video' | 'music' | 'speech';
export interface Model {
  id: string;
  object?: string;
  display_name?: string;
  available?: boolean;
  engine?: string;
  /** 上游 /models 返回的能力类型；music 与 speech 分开 */
  kind?: ModelKind;
}
export type ImageEngineMode = 'auto' | 'native' | 'upstream' | 'interactions';
export type AudioEngineMode = 'auto' | 'native' | 'upstream';
export interface Settings {
  temperature: number; musicPath: string; musicExtra: string;
  imageEngineMode: ImageEngineMode;
  audioEngineMode: AudioEngineMode;
}
export const DEFAULT_SETTINGS: Settings = {
  temperature: 0.7,
  musicPath: 'speech', musicExtra: '{}',
  imageEngineMode: 'auto',
  audioEngineMode: 'auto',
};

