import { openDB, type IDBPDatabase } from 'idb';
import { DEFAULT_SETTINGS, type Asset, type Conversation, type Settings } from './types';
import { accountRequest, type AccountState } from './account';

let database: Promise<IDBPDatabase> | undefined;
export let storageMode: 'indexeddb' | 'localstorage' | 'cloud' = 'indexeddb';
let accountId: string | null = null;
const pending = new Map<string, Promise<void>>();
export async function initializeStorage(): Promise<AccountState> {
  const state = await accountRequest('me');
  if (state.user) await syncGuestRecords(state.user.id);
  accountId = state.user?.id || null;
  if (accountId) storageMode = 'cloud';
  return state;
}
async function cloudRequest(store: string, init: RequestInit = {}, id?: string, userId = accountId, importing = false) {
  const headers = new Headers(init.headers);
  headers.set('X-Olai-User', userId!);
  if (init.body) headers.set('Content-Type', 'application/json');
  const query = importing ? '?import=guest' : id ? `?id=${encodeURIComponent(id)}` : '';
  const response = await fetch(`/api/records/${store}${query}`, { ...init, headers, credentials: 'same-origin' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || '云端保存失败。');
  return data;
}
function enqueue(key: string, write: () => Promise<void>): Promise<void> {
  const next = (pending.get(key) || Promise.resolve()).catch(() => {}).then(write);
  pending.set(key, next);
  void next.finally(() => { if (pending.get(key) === next) pending.delete(key); }).catch(() => {});
  return next;
}
export async function flushStorage() { await Promise.all([...pending.values()]); }
async function openWithTimeout(name: string, version: number, options?: Parameters<typeof openDB>[2], timeoutMs = 2500) {
  return Promise.race([
    openDB(name, version, options),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('IndexedDB timeout')), timeoutMs)),
  ]);
}

async function db() {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
    storageMode = 'localstorage';
    return null;
  }
  database ??= openWithTimeout('olai', 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('conversations')) db.createObjectStore('conversations', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' });
    }
  });
  try {
    const databaseInstance = await database;
    try {
      const existing = await databaseInstance.getAll('conversations');
      if (existing.length === 0 && indexedDB.databases) {
        const dbs = await Promise.race([
          indexedDB.databases(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('databases timeout')), 1000)),
        ]).catch(() => []);
        if (dbs.some(d => d.name === 'john-ai-studio')) {
          const oldDb = await openWithTimeout('john-ai-studio', 1, undefined, 1000);
          const oldConvs = await oldDb.getAll('conversations');
          const oldAssets = await oldDb.getAll('assets');
          for (const c of oldConvs) await databaseInstance.put('conversations', c);
          for (const a of oldAssets) await databaseInstance.put('assets', a);
          oldDb.close();
        }
      }
    } catch { /* Migration is best-effort */ }
    return databaseInstance;
  } catch {
    storageMode = 'localstorage';
    return null;
  }
}
async function encodeBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject; reader.readAsDataURL(blob);
  });
}
type LocalRecord = (Conversation | Asset) & { linkedAccountId?: string; blobData?: string };
async function localRecords(store: 'conversations' | 'assets'): Promise<LocalRecord[]> {
  const database = await db();
  if (database) return database.getAll(store);
  return JSON.parse(localStorage.getItem(`olai.${store}`) || localStorage.getItem(`studio.${store}`) || '[]');
}
async function linkLocalRecord(store: 'conversations' | 'assets', value: LocalRecord, userId: string) {
  const database = await db();
  if (database) {
    // Keep the original local snapshot as a backup, and claim only this revision.
    const transaction = database.transaction(store, 'readwrite');
    const current = await transaction.store.get(value.id);
    if (current && !current.linkedAccountId && JSON.stringify(current) === JSON.stringify(value) && (!('blob' in value) || current.blob?.size === value.blob?.size)) {
      await transaction.store.put({ ...current, linkedAccountId: userId });
    }
    await transaction.done;
    return;
  }
  const rows = await localRecords(store);
  const current = rows.find(row => row.id === value.id);
  if (current && !current.linkedAccountId && JSON.stringify(current) === JSON.stringify(value)) {
    current.linkedAccountId = userId;
    localStorage.setItem(`olai.${store}`, JSON.stringify(rows));
  }
}
let guestSync: Promise<void> | undefined;
export function syncGuestRecords(userId: string): Promise<void> {
  // Serialize imports within a page. Server-side insert-if-absent also makes
  // retries and concurrent tabs safe without overwriting existing cloud edits.
  const importRecords = async () => {
    await flushStorage();
    for (const store of ['conversations', 'assets'] as const) {
      const records = await localRecords(store);
      for (const value of records) {
        if (value.linkedAccountId) continue;
        const item: Record<string, unknown> = { ...value };
        delete item.linkedAccountId;
        if ('blob' in value && value.blob) { item.blobData = await encodeBlob(value.blob); delete item.blob; }
        if (typeof item.url === 'string' && item.url.startsWith('blob:')) delete item.url;
        try {
          await cloudRequest(store, { method: 'PUT', body: JSON.stringify(item) }, undefined, userId, true);
          await linkLocalRecord(store, value, userId);
        } catch (error) {
          throw new Error(`游客记录同步未完成，未同步的内容仍保留在本地。${error instanceof Error ? error.message : '请重试。'}`);
        }
      }
    }
  };
  const sync = (guestSync || Promise.resolve()).catch(() => {}).then(async () => {
    if (typeof navigator !== 'undefined' && navigator.locks) await navigator.locks.request('olai-guest-import', importRecords);
    else await importRecords();
  });
  guestSync = sync;
  void sync.finally(() => { if (guestSync === sync) guestSync = undefined; }).catch(() => {});
  return sync;
}
export async function getAll<T>(store: 'conversations' | 'assets'): Promise<T[]> {
  if (accountId) {
    const { records } = await cloudRequest(store);
    if (store === 'assets') for (const row of records) if (row.blobData) {
      row.blob = await (await fetch(row.blobData)).blob(); delete row.blobData;
    }
    return records;
  }
  const rows = (await localRecords(store)).filter(row => !row.linkedAccountId);
  if (store === 'assets') for (const row of rows) if ('kind' in row && row.blobData) {
    row.blob = await (await fetch(row.blobData)).blob(); delete row.blobData;
  }
  return rows as unknown as T[];
}
export function put(store: 'conversations' | 'assets', value: Conversation | Asset) {
  const snapshot = { ...value };
  return enqueue(accountId ? `${store}:${value.id}` : `local:${store}`, () => writeRecord(store, snapshot));
}
async function writeRecord(store: 'conversations' | 'assets', value: Conversation | Asset) {
  if (accountId) {
    // Capture each snapshot now and encode inside its queue so older, slower
    // media writes cannot overwrite newer metadata or race deletion.
    const item: Record<string, unknown> = { ...value };
    if ('blob' in value && value.blob) { item.blobData = await encodeBlob(value.blob); delete item.blob; }
    if (typeof item.url === 'string' && item.url.startsWith('blob:')) delete item.url;
    await cloudRequest(store, { method: 'PUT', body: JSON.stringify(item) });
    return;
  }
  const database = await db();
  if (database) { await database.put(store, value); return; }
  const rows = JSON.parse(localStorage.getItem(`olai.${store}`) || localStorage.getItem(`studio.${store}`) || '[]');
  const item: Record<string, unknown> = { ...value };
  if ('blob' in value && value.blob) { item.blobData = await encodeBlob(value.blob); delete item.blob; }
  const index = rows.findIndex((row: { id: string }) => row.id === value.id);
  if (index < 0) rows.push(item); else rows[index] = item;
  localStorage.setItem(`olai.${store}`, JSON.stringify(rows));
}
export function remove(store: 'conversations' | 'assets', id: string) {
  return enqueue(accountId ? `${store}:${id}` : `local:${store}`, () => deleteRecord(store, id));
}
async function deleteRecord(store: 'conversations' | 'assets', id: string) {
  if (accountId) { await cloudRequest(store, { method: 'DELETE' }, id); return; }
  const database = await db();
  if (database) { await database.delete(store, id); return; }
  const rows = JSON.parse(localStorage.getItem(`olai.${store}`) || localStorage.getItem(`studio.${store}`) || '[]');
  localStorage.setItem(`olai.${store}`, JSON.stringify(rows.filter((row: { id: string }) => row.id !== id)));
}
export function loadSettings(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  const settings = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('olai.settings') || localStorage.getItem('studio.settings') || '{}') };
  const previousPrompt = '你是 Olai（Online AI Chat Companion），一个温暖、善解人意且知识渊博的在线 AI 伴侣与创意助手。默认用中文回答。陪伴用户畅聊日常、倾听心声、激发灵感并协助创作。';
  if (settings.systemPrompt === previousPrompt) settings.systemPrompt = DEFAULT_SETTINGS.systemPrompt;
  // Creative engines are managed by the studio; migrate earlier saved model selections.
  Object.assign(settings, { chatModel: DEFAULT_SETTINGS.chatModel, imageModel: DEFAULT_SETTINGS.imageModel, videoModel: DEFAULT_SETTINGS.videoModel, musicModel: DEFAULT_SETTINGS.musicModel, musicPath: DEFAULT_SETTINGS.musicPath, musicExtra: DEFAULT_SETTINGS.musicExtra, imageEngineMode: DEFAULT_SETTINGS.imageEngineMode, audioEngineMode: DEFAULT_SETTINGS.audioEngineMode });
  settings.key = sessionStorage.getItem('olai.key') || sessionStorage.getItem('studio.key') || (settings.rememberKey ? (localStorage.getItem('olai.key') || localStorage.getItem('studio.key')) : '') || '';
  return settings;
}
export function saveSettings(settings: Settings) {
  if (typeof window === 'undefined') return;
  const { key, ...safe } = settings;
  localStorage.setItem('olai.settings', JSON.stringify(safe));
  sessionStorage.setItem('olai.key', key);
  if (settings.rememberKey) localStorage.setItem('olai.key', key); else { localStorage.removeItem('olai.key'); localStorage.removeItem('studio.key'); }
}
