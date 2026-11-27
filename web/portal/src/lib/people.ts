import { t } from './i18n';
import type { Asset } from './types';

export interface PrivacySettings {
  handle: string;
  bio: string;
  website: string;
  showWorks: boolean;
  showFavorites: boolean;
  showBio: boolean;
  showJoined: boolean;
  showFollows: boolean;
  allowMessages: boolean;
  /** 主页头像上方的封面：预设色 id 或 upload:<uuid>。 */
  banner: string;
}

export interface PublicProfile {
  id: string;
  name: string;
  avatar: string;
  /** 主页头像上方的封面：预设色 id 或 upload:<uuid>。 */
  banner?: string;
  bio?: string;
  website?: string;
  joinedAt?: number;
  followers?: number;
  following?: number;
  followingUser?: boolean;
  self: boolean;
  blocked: boolean;
  canMessage: boolean;
  works: boolean;
  favorites: boolean;
  /** Published works the owner has. Absent when the works are hidden. */
  workCount?: number;
  /** Times the owner's published works were opened. */
  plays?: number;
  /** Favorites the owner's published works received. */
  likes?: number;
  /** Favorites the owner shows publicly. */
  favoriteCount?: number;
  /** Published works split by kind. */
  kindCounts?: { image: number; video: number; music: number };
}

export interface FavoriteFolder { id: string; name: string; count: number }

export interface InboxItem {
  id: string;
  with: { id: string; name: string; avatar: string };
  last: string;
  mine: boolean;
  updatedAt: number;
  unread: number;
}

export interface DirectMessage { id: string; body: string; mine: boolean; createdAt: number }

async function peopleRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    signal: init.signal || AbortSignal.timeout(30_000),
    ...init,
  });
  let data: any = null;
  try { data = await response.json(); } catch { /* 非 JSON 错误走下面的统一提示。 */ }
  if (!response.ok) {
    throw new Error(t(data?.error?.message || '请求失败，请稍后重试。'));
  }
  return data;
}

function json(method: string, body?: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) };
}

export function getMyProfile(): Promise<{ profile: PrivacySettings }> {
  return peopleRequest('/api/profile');
}

export function saveMyProfile(profile: Partial<PrivacySettings>): Promise<{ profile: PrivacySettings }> {
  return peopleRequest('/api/profile', json('PUT', profile));
}

export function getPublicProfile(handle: string, signal?: AbortSignal): Promise<{ profile: PublicProfile }> {
  return peopleRequest(`/api/users/${encodeURIComponent(handle)}`, { signal });
}

export async function getProfileWorks(handle: string, offset = 0, signal?: AbortSignal): Promise<{ records: Asset[]; nextOffset: number | null }> {
  const data = await peopleRequest(`/api/users/${encodeURIComponent(handle)}/works?offset=${offset}&limit=24`, { signal });
  return { records: Array.isArray(data.records) ? data.records : [], nextOffset: Number.isInteger(data.nextOffset) ? data.nextOffset : null };
}

export async function getProfileFavorites(handle: string, offset = 0, signal?: AbortSignal): Promise<{ records: Asset[]; nextOffset: number | null }> {
  const data = await peopleRequest(`/api/users/${encodeURIComponent(handle)}/favorites?offset=${offset}&limit=24`, { signal });
  return { records: Array.isArray(data.records) ? data.records : [], nextOffset: Number.isInteger(data.nextOffset) ? data.nextOffset : null };
}

export function setFollow(handle: string, follow: boolean): Promise<{ following: boolean; followers: number }> {
  return peopleRequest(`/api/users/${encodeURIComponent(handle)}/follow`, { method: follow ? 'PUT' : 'DELETE' });
}

export function setBlocked(handle: string, blocked: boolean): Promise<{ blocked: boolean }> {
  return peopleRequest(`/api/users/${encodeURIComponent(handle)}/block`, { method: blocked ? 'PUT' : 'DELETE' });
}

export function getInbox(): Promise<{ conversations: InboxItem[]; unread: number }> {
  return peopleRequest('/api/messages');
}

export function getConversation(handle: string): Promise<{ id: string; messages: DirectMessage[] }> {
  return peopleRequest(`/api/users/${encodeURIComponent(handle)}/messages`);
}

export function sendMessage(handle: string, body: string): Promise<{ id: string; messages: DirectMessage[] }> {
  return peopleRequest(`/api/users/${encodeURIComponent(handle)}/messages`, json('POST', { body }));
}

/** One account the signed-in viewer may share a work with. */
export interface ShareUser { id: string; name: string; avatar: string }

export function searchUsers(query: string, signal?: AbortSignal): Promise<{ users: ShareUser[] }> {
  return peopleRequest(`/api/users?q=${encodeURIComponent(query)}`, { signal });
}

export function getFavoriteFolders(): Promise<{ folders: FavoriteFolder[] }> {
  return peopleRequest('/api/favorites/folders');
}

export function createFavoriteFolder(name: string): Promise<{ folder: FavoriteFolder }> {
  return peopleRequest('/api/favorites/folders', json('POST', { name }));
}

export function renameFavoriteFolder(id: string, name: string): Promise<{ ok: boolean }> {
  return peopleRequest(`/api/favorites/folders/${encodeURIComponent(id)}`, json('PUT', { name }));
}

export function deleteFavoriteFolder(id: string): Promise<{ ok: boolean }> {
  return peopleRequest(`/api/favorites/folders/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function placeFavorite(workID: string, folder: string): Promise<{ ok: boolean }> {
  return peopleRequest(`/api/gallery/${encodeURIComponent(workID)}/folder`, json('PUT', { folder }));
}

export function setWorkVisibility(workID: string, visibility: 'public' | 'private'): Promise<{ visibility: string }> {
  return peopleRequest(`/api/gallery/${encodeURIComponent(workID)}/visibility`, json('PUT', { visibility }));
}
