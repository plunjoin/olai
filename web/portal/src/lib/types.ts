export type View = 'home' | 'chat' | 'image' | 'video' | 'music' | 'library' | 'gallery' | 'workflow';
export type MediaKind = 'image' | 'video' | 'music';
export type ConversationKind = 'chat' | MediaKind;
export interface Message {
  id: string; role: 'user' | 'assistant'; content: string; error?: string; interrupted?: boolean;
  /** Epoch ms; new messages are ordered and grouped by this value. */
  createdAt?: number;
  /** Media creation requests carry the kind and a request ID shared with their assets. */
  kind?: MediaKind;
  requestId?: string;
  images?: { url: string; name: string }[];
  files?: string[];
}
export interface Conversation { id: string; title: string; messages: Message[]; createdAt: number; updatedAt: number; kind?: ConversationKind }
export interface CreationMeta { requestId?: string; conversationId?: string; revisionOf?: string; version?: number }
export interface Asset {
  id: string; kind: MediaKind; prompt: string; createdAt: number;
  status: 'pending' | 'completed' | 'failed'; remoteId?: string; url?: string; blob?: Blob;
  /** Links the asset to the conversation request that produced it. */
  requestId?: string;
  conversationId?: string;
  /** Video revisions point at the version they were generated from. */
  revisionOf?: string;
  version?: number;
  /** Public gallery only: resized copy of `url`/`coverUrl` for grid cards. */
  thumbnail?: string; coverThumbnail?: string;
  /** Public gallery only: account-backed engagement metrics. */
  favorite?: boolean; favoriteCount?: number; views?: number; downloads?: number; heat?: number;
  /** Public gallery only: the creator's display name and preset avatar theme. */
  author?: GalleryAuthor;
  error?: string; options: Record<string, string | number>;
  /** Public display name of the model that produced the work. Never an upstream model ID. */
  modelLabel?: string;
  imageWidth?: number;
  imageHeight?: number;
  lrc?: string;
  lyricsUrl?: string;
  lrcUrl?: string;
  lrcSource?: 'estimated' | 'audio' | 'manual';
  lrcError?: string;
  audioDuration?: number;
  coverUrl?: string;
  coverStatus?: 'pending' | 'completed' | 'failed';
  coverError?: string;
  song?: SongDraft;
  lyrics?: string;
}
export interface GalleryAuthor { name: string; avatar?: string }
export interface GalleryComment { id: string; body: string; createdAt: number; author: GalleryAuthor }
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
/** 按模型计价的档位；客户端只看到积分，不接触上游模型 ID。 */
export interface ModelPrices {
  image?: Record<string, number>;
  video?: Record<string, number>;
  music?: { perMinute?: number };
  chat?: { perMessage?: number };
}
export interface PublicModel {
  id: string;
  name: string;
  kind: ModelKind;
  prices: ModelPrices;
  /** 图片/视频模型支持的档位；缺省表示全部支持。 */
  tiers?: string[];
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

