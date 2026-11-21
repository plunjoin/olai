import { request } from './api';

export type MemorySource = 'manual' | 'auto';

export interface MemoryItem {
  id: string;
  content: string;
  source: MemorySource;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryState {
  enabled: boolean;
  autoCapture: boolean;
  limit: number;
  maxLength: number;
  memories: MemoryItem[];
}

export interface MemoryUpdate {
  id: string;
  content: string;
  updatedAt: number;
}

export const DEFAULT_MEMORY_STATE: MemoryState = {
  enabled: false, autoCapture: false, limit: 50, maxLength: 280, memories: [],
};

function memoryItem(value: any): MemoryItem | null {
  if (!value || typeof value.id !== 'string' || typeof value.content !== 'string') return null;
  return {
    id: value.id,
    content: value.content,
    source: value.source === 'auto' ? 'auto' : 'manual',
    createdAt: Number.isFinite(value.createdAt) ? value.createdAt : Date.now(),
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : Date.now(),
  };
}

function memoryState(value: any): MemoryState {
  if (!value || typeof value.enabled !== 'boolean' || typeof value.autoCapture !== 'boolean' || !Array.isArray(value.memories)) {
    throw new Error('记忆接口未返回有效数据。');
  }
  return {
    enabled: value.enabled,
    autoCapture: value.autoCapture,
    limit: Number.isSafeInteger(value.limit) && value.limit > 0 ? value.limit : DEFAULT_MEMORY_STATE.limit,
    maxLength: Number.isSafeInteger(value.maxLength) && value.maxLength > 0 ? value.maxLength : DEFAULT_MEMORY_STATE.maxLength,
    memories: value.memories.map(memoryItem).filter((item: MemoryItem | null): item is MemoryItem => item !== null),
  };
}

export async function loadMemoryState(): Promise<MemoryState> {
  const response = await request('memory');
  return memoryState(await response.json());
}

export async function saveMemorySettings(enabled: boolean, autoCapture: boolean): Promise<{ enabled: boolean; autoCapture: boolean }> {
  const response = await request('memory/settings', { method: 'PUT', body: JSON.stringify({ enabled, autoCapture }) });
  const data = await response.json();
  if (!data || typeof data.enabled !== 'boolean' || typeof data.autoCapture !== 'boolean') {
    throw new Error('记忆接口未返回有效数据。');
  }
  return { enabled: data.enabled, autoCapture: data.autoCapture };
}

export async function createMemory(content: string): Promise<MemoryItem> {
  const response = await request('memory', { method: 'POST', body: JSON.stringify({ content }) });
  const data = await response.json();
  const item = memoryItem(data?.memory);
  if (!item) throw new Error('记忆接口未返回有效数据。');
  return item;
}

export async function updateMemory(id: string, content: string): Promise<MemoryUpdate> {
  const response = await request(`memory/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ content }) });
  const data = await response.json();
  if (!data?.memory || typeof data.memory.id !== 'string' || typeof data.memory.content !== 'string') {
    throw new Error('记忆接口未返回有效数据。');
  }
  return {
    id: data.memory.id,
    content: data.memory.content,
    updatedAt: Number.isFinite(data.memory.updatedAt) ? data.memory.updatedAt : Date.now(),
  };
}

export async function deleteMemory(id: string): Promise<void> {
  await request(`memory/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function clearMemories(): Promise<void> {
  await request('memory', { method: 'DELETE' });
}

/** Best-effort automatic capture; callers ignore failures and never block chat. */
export async function extractMemories(messages: { role: string; content: string }[]): Promise<MemoryItem[]> {
  const response = await request('memory/extract', { method: 'POST', body: JSON.stringify({ messages }) });
  const data = await response.json();
  if (!Array.isArray(data?.memories)) return [];
  return data.memories.map(memoryItem).filter((item: MemoryItem | null): item is MemoryItem => item !== null);
}
