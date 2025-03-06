import { openDB, type IDBPDatabase } from 'idb';
import { DEFAULT_SETTINGS, type Asset, type Conversation, type Settings } from './types';

let database: Promise<IDBPDatabase> | undefined;
export let storageMode: 'indexeddb' | 'localstorage' = 'indexeddb';
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
export async function getAll<T>(store: 'conversations' | 'assets'): Promise<T[]> {
  const database = await db();
  if (database) return database.getAll(store);
  const rows = JSON.parse(localStorage.getItem(`olai.${store}`) || localStorage.getItem(`studio.${store}`) || '[]');
  if (store === 'assets') for (const row of rows) if (row.blobData) {
    row.blob = await (await fetch(row.blobData)).blob(); delete row.blobData;
  }
  return rows;
}
export async function put(store: 'conversations' | 'assets', value: Conversation | Asset) {
  const database = await db();
  if (database) { await database.put(store, value); return; }
  const rows = JSON.parse(localStorage.getItem(`olai.${store}`) || localStorage.getItem(`studio.${store}`) || '[]');
  const item: Record<string, unknown> = { ...value };
  if ('blob' in value && value.blob) { item.blobData = await encodeBlob(value.blob); delete item.blob; }
  const index = rows.findIndex((row: { id: string }) => row.id === value.id);
  if (index < 0) rows.push(item); else rows[index] = item;
  localStorage.setItem(`olai.${store}`, JSON.stringify(rows));
}
export async function remove(store: 'conversations' | 'assets', id: string) {
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
