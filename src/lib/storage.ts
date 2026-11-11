import { openDB, type IDBPDatabase } from 'idb';
import { DEFAULT_SETTINGS, type Asset, type Conversation, type Settings } from './types';
import { accountRequest, type AccountState } from './account';
import type { VideoWorkflowProject } from './videoWorkflow';
import { scrubRecordPrivacy } from './recordPrivacy';
import { hydrateWorkflowMedia, persistRecordMedia } from './mediaStorage';

let database: Promise<IDBPDatabase> | undefined;
export let storageMode: 'indexeddb' | 'localstorage' | 'cloud' = 'indexeddb';
let accountId: string | null = null;
let ossStorage = false;
let shortFilm: boolean | undefined;
const pending = new Map<string, Promise<void>>();
export async function initializeStorage(): Promise<AccountState> {
  const state = await accountRequest('me');
  accountId = state.user?.id || null;
  ossStorage = state.mediaStorage === 'oss';
  shortFilm = state.shortFilm;
  storageMode = accountId ? 'cloud' : 'indexeddb';
  return state;
}
async function cloudRequest(store: string, init: RequestInit = {}, id?: string, userId = accountId, importing = false) {
  const headers = new Headers(init.headers);
  headers.set('X-Olai-User', userId!);
  if (init.body) headers.set('Content-Type', 'application/json');
  const query = importing ? '?import=guest' : id ? `?id=${encodeURIComponent(id)}` : '';
  const response = await fetch(`/api/records/${store}${query}`, { ...init, headers, credentials: 'same-origin', signal: init.signal || AbortSignal.timeout(60_000) });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error(`云端记录接口未返回 JSON（HTTP ${response.status}），请检查服务配置。`);
  let data;
  try { data = await response.json(); } catch { throw new Error('云端记录接口返回的数据格式无效。'); }
  if (!response.ok) throw new Error(`${data?.error?.message || '云端保存失败。'}（HTTP ${response.status}）`);
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
    if (!accountId) storageMode = 'localstorage';
    return null;
  }
  database ??= openWithTimeout('olai', 2, {
    upgrade(db, oldVersion) {
      if (!db.objectStoreNames.contains('conversations')) db.createObjectStore('conversations', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' });
      if (oldVersion < 2 && !db.objectStoreNames.contains('workflows')) {
        db.createObjectStore('workflows', { keyPath: 'id' });
      }
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
          for (const c of oldConvs) await databaseInstance.put('conversations', scrubRecordPrivacy(c));
          for (const a of oldAssets) await databaseInstance.put('assets', scrubRecordPrivacy(a));
          oldDb.close();
        }
      }
    } catch { /* Migration is best-effort */ }
    return databaseInstance;
  } catch {
    if (!accountId) storageMode = 'localstorage';
    return null;
  }
}
async function encodeBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject; reader.readAsDataURL(blob);
  });
}
type LocalRecord = (Conversation | Asset | VideoWorkflowProject) & { linkedAccountId?: string; blobData?: string };
async function localRecords(store: 'conversations' | 'assets' | 'workflows'): Promise<LocalRecord[]> {
  purgeLegacySettings();
  const database = await db();
  if (database) {
    const rows = await database.getAll(store);
    const clean = scrubRecordPrivacy(rows);
    for (let i = 0; i < rows.length; i++) if (clean[i] !== rows[i]) await database.put(store, clean[i]);
    return clean;
  }
  const rows = JSON.parse(localStorage.getItem(`olai.${store}`) || localStorage.getItem(`studio.${store}`) || '[]');
  const clean = scrubRecordPrivacy(rows);
  localStorage.setItem(`olai.${store}`, JSON.stringify(clean));
  localStorage.removeItem(`studio.${store}`);
  return clean;
}
async function linkLocalRecord(store: 'conversations' | 'assets' | 'workflows', value: LocalRecord, userId: string) {
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
const MAX_RECORD_BYTES = 64 * 1024 * 1024;
async function recordBody(value: Conversation | Asset | VideoWorkflowProject | LocalRecord, userId = accountId) {
  if (ossStorage) {
    const item = { ...await persistRecordMedia(scrubRecordPrivacy(value), userId) } as Record<string, unknown>;
    delete item.linkedAccountId;
    const body = JSON.stringify(item);
    if (new Blob([body]).size > MAX_RECORD_BYTES) throw new Error('记录正文超过 64 MB，请先下载备份。');
    return body;
  }
  if ('blob' in value && value.blob && Math.ceil(value.blob.size / 3) * 4 > MAX_RECORD_BYTES) {
    throw new Error('文件编码后超过单条记录 64 MB 的上限，请先下载备份。');
  }
  value = scrubRecordPrivacy(value);
  const item: Record<string, unknown> = { ...value };
  delete item.linkedAccountId;
  if ('blob' in value && value.blob) { item.blobData = await encodeBlob(value.blob); delete item.blob; }
  
  // Handle workflow project blobs
  if ('shots' in value && Array.isArray(value.shots)) {
    item.shots = await Promise.all(value.shots.map(async (shot: any) => {
      const shotCopy = { ...shot };
      if (shot.keyframeBlob) {
        shotCopy.keyframeBlobData = await encodeBlob(shot.keyframeBlob);
        delete shotCopy.keyframeBlob;
      }
      if (shot.videoBlob) {
        shotCopy.videoBlobData = await encodeBlob(shot.videoBlob);
        delete shotCopy.videoBlob;
      }
      if (typeof shotCopy.keyframeUrl === 'string' && shotCopy.keyframeUrl.startsWith('blob:')) delete shotCopy.keyframeUrl;
      if (typeof shotCopy.videoUrl === 'string' && shotCopy.videoUrl.startsWith('blob:')) delete shotCopy.videoUrl;
      return shotCopy;
    }));
  }
  if ('musicBlob' in value && value.musicBlob) {
    item.musicBlobData = await encodeBlob(value.musicBlob);
    delete item.musicBlob;
  }
  if ('finalVideoBlob' in value && value.finalVideoBlob) {
    item.finalVideoBlobData = await encodeBlob(value.finalVideoBlob);
    delete item.finalVideoBlob;
  }
  if (typeof item.url === 'string' && item.url.startsWith('blob:')) delete item.url;
  if (typeof item.musicUrl === 'string' && item.musicUrl.startsWith('blob:')) delete item.musicUrl;
  if (typeof item.finalVideoUrl === 'string' && item.finalVideoUrl.startsWith('blob:')) delete item.finalVideoUrl;
  
  const body = JSON.stringify(item);
  if (new Blob([body]).size > MAX_RECORD_BYTES) throw new Error('记录包含媒体编码后超过 64 MB 的上限，请先下载备份。');
  return body;
}
export type GuestSyncReport = { synced: { conversations: string[]; assets: string[]; workflows: string[] }; failures: string[] };
let guestSync: Promise<GuestSyncReport> | undefined;
export function syncGuestRecords(userId: string): Promise<GuestSyncReport> {
  // Serialize imports within a page. Server-side insert-if-absent also makes
  // retries and concurrent tabs safe without overwriting existing cloud edits.
  const importRecords = async () => {
    const report: GuestSyncReport = { synced: { conversations: [], assets: [], workflows: [] }, failures: [] };
    await flushStorage();
    for (const store of ['conversations', 'assets', 'workflows'] as const) {
      if (store === 'workflows' && shortFilm === false) continue;
      const records = await localRecords(store);
      for (const value of records) {
        if (value.linkedAccountId) continue;
        try {
          await cloudRequest(store, { method: 'PUT', body: await recordBody(value, userId) }, undefined, userId, true);
          await linkLocalRecord(store, value, userId);
          report.synced[store].push(value.id);
        } catch (error) {
          const label = 'title' in value ? value.title : value.prompt;
          const detail = error instanceof Error && error.name === 'TimeoutError' ? '上传超时，请检查网络后重试。' : error instanceof Error ? error.message : '请重试。';
          report.failures.push(`游客${store === 'conversations' ? '会话' : '作品'}「${label?.slice(0, 30) || value.id}」同步未完成，未同步的内容仍保留在本地。${detail}`);
        }
      }
      // Migrate legacy media already stored inline in the account database.
      // The server uses an optimistic revision check, never blind overwrites.
      if (ossStorage) {
        try {
          const migrated = await cloudRequest(store, { method: 'POST' }, undefined, userId);
          if (Array.isArray(migrated.failures)) report.failures.push(...migrated.failures);
          if (Array.isArray(migrated.migratedIds)) report.synced[store].push(...migrated.migratedIds);
        } catch (error) {
          report.failures.push(`账号附件迁移未完成：${error instanceof Error ? error.message : '请重试。'}`);
        }
      }
    }
    return report;
  };
  const sync = (guestSync || Promise.resolve()).catch(() => {}).then(async () => {
    if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request('olai-guest-import', importRecords);
    return importRecords();
  });
  guestSync = sync;
  void sync.finally(() => { if (guestSync === sync) guestSync = undefined; }).catch(() => {});
  return sync;
}
export async function getAll<T>(store: 'conversations' | 'assets' | 'workflows'): Promise<T[]> {
  if (accountId) {
    const { records: rawRecords } = await cloudRequest(store);
    const records = scrubRecordPrivacy(rawRecords);
    if (store === 'assets') for (const row of records) if (row.blobData) {
      row.blob = await (await fetch(row.blobData)).blob(); delete row.blobData;
    }
    if (store === 'workflows') for (const row of records) {
      // Restore blobs from blobData for workflow shots and media
      if (row.shots) {
        for (const shot of row.shots) {
          if (shot.keyframeBlobData) {
            shot.keyframeBlob = await (await fetch(shot.keyframeBlobData)).blob();
            delete shot.keyframeBlobData;
          }
          if (shot.videoBlobData) {
            shot.videoBlob = await (await fetch(shot.videoBlobData)).blob();
            delete shot.videoBlobData;
          }
        }
      }
      if (row.musicBlobData) {
        row.musicBlob = await (await fetch(row.musicBlobData)).blob();
        delete row.musicBlobData;
      }
      if (row.finalVideoBlobData) {
        row.finalVideoBlob = await (await fetch(row.finalVideoBlobData)).blob();
        delete row.finalVideoBlobData;
      }
    }
    if (store === 'workflows' && ossStorage) return Promise.all(records.map((row: VideoWorkflowProject) => hydrateWorkflowMedia(row))) as Promise<T[]>;
    return records;
  }
  const rows = (await localRecords(store)).filter(row => !row.linkedAccountId);
  if (store === 'assets') for (const row of rows) if ('kind' in row && row.blobData) {
    row.blob = await (await fetch(row.blobData)).blob(); delete row.blobData;
  }
  if (store === 'workflows') for (const row of rows as any[]) {
    if (row.shots) {
      for (const shot of row.shots) {
        if (shot.keyframeBlobData) {
          shot.keyframeBlob = await (await fetch(shot.keyframeBlobData)).blob();
          delete shot.keyframeBlobData;
        }
        if (shot.videoBlobData) {
          shot.videoBlob = await (await fetch(shot.videoBlobData)).blob();
          delete shot.videoBlobData;
        }
      }
    }
    if (row.musicBlobData) {
      row.musicBlob = await (await fetch(row.musicBlobData)).blob();
      delete row.musicBlobData;
    }
    if (row.finalVideoBlobData) {
      row.finalVideoBlob = await (await fetch(row.finalVideoBlobData)).blob();
      delete row.finalVideoBlobData;
    }
  }
  if (store === 'workflows' && ossStorage) return Promise.all(rows.map(row => hydrateWorkflowMedia(row))) as Promise<T[]>;
  return rows as unknown as T[];
}
export function put(store: 'conversations' | 'assets' | 'workflows', value: Conversation | Asset | VideoWorkflowProject) {
  const snapshot = scrubRecordPrivacy({ ...value });
  return enqueue(accountId ? `${store}:${value.id}` : `local:${store}`, () => writeRecord(store, snapshot));
}
async function writeRecord(store: 'conversations' | 'assets' | 'workflows', value: Conversation | Asset | VideoWorkflowProject) {
  purgeLegacySettings();
  value = scrubRecordPrivacy(value);
  if (accountId) {
    // Capture each snapshot now and encode inside its queue so older, slower
    // media writes cannot overwrite newer metadata or race deletion.
    await cloudRequest(store, { method: 'PUT', body: await recordBody(value) });
    return;
  }
  // Keep a recoverable local snapshot first. Upload failures must never destroy
  // a generated Blob; callers can retry or import it on the next login.
  const original = value;
  const database = await db();
  if (database) await database.put(store, original);
  if (ossStorage) {
    try { value = await persistRecordMedia(value, null); }
    catch (error) {
      if (!database) await writeLocalFallback(store, original);
      throw error;
    }
  }
  if (database) { await database.put(store, value); return; }
  await writeLocalFallback(store, value);
}
async function writeLocalFallback(store: 'conversations' | 'assets' | 'workflows', value: Conversation | Asset | VideoWorkflowProject) {
  const rows = await localRecords(store);
  const item = { ...value } as LocalRecord & Record<string, unknown>;
  if ('blob' in value && value.blob) { item.blobData = await encodeBlob(value.blob); delete item.blob; }
  // Handle workflow blobs in localStorage
  if ('shots' in value && Array.isArray(value.shots)) {
    item.shots = await Promise.all(value.shots.map(async (shot: any) => {
      const shotCopy = { ...shot };
      if (shot.keyframeBlob) {
        shotCopy.keyframeBlobData = await encodeBlob(shot.keyframeBlob);
        delete shotCopy.keyframeBlob;
      }
      if (shot.videoBlob) {
        shotCopy.videoBlobData = await encodeBlob(shot.videoBlob);
        delete shotCopy.videoBlob;
      }
      return shotCopy;
    }));
  }
  if ('musicBlob' in value && value.musicBlob) {
    item.musicBlobData = await encodeBlob(value.musicBlob);
    delete item.musicBlob;
  }
  if ('finalVideoBlob' in value && value.finalVideoBlob) {
    item.finalVideoBlobData = await encodeBlob(value.finalVideoBlob);
    delete item.finalVideoBlob;
  }
  const index = rows.findIndex((row: { id: string }) => row.id === value.id);
  if (index < 0) rows.push(item); else rows[index] = item;
  localStorage.setItem(`olai.${store}`, JSON.stringify(rows));
}
export function remove(store: 'conversations' | 'assets' | 'workflows', id: string) {
  return enqueue(accountId ? `${store}:${id}` : `local:${store}`, () => deleteRecord(store, id));
}
async function deleteRecord(store: 'conversations' | 'assets' | 'workflows', id: string) {
  if (accountId) { await cloudRequest(store, { method: 'DELETE' }, id); return; }
  const database = await db();
  if (database) { await database.delete(store, id); return; }
  const rows = await localRecords(store);
  localStorage.setItem(`olai.${store}`, JSON.stringify(rows.filter((row: { id: string }) => row.id !== id)));
}
function safeSettings(value: unknown): Settings {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  let musicExtra = DEFAULT_SETTINGS.musicExtra;
  if (typeof source.musicExtra === 'string') {
    try {
      const extra = JSON.parse(source.musicExtra);
      if (extra && typeof extra === 'object' && !Array.isArray(extra)) musicExtra = JSON.stringify(scrubRecordPrivacy(extra));
    } catch { /* Malformed legacy extras are not client configuration. */ }
  }
  return {
    temperature: typeof source.temperature === 'number' && Number.isFinite(source.temperature) && source.temperature >= 0 && source.temperature <= 2 ? source.temperature : DEFAULT_SETTINGS.temperature,
    musicPath: typeof source.musicPath === 'string' && source.musicPath ? source.musicPath : DEFAULT_SETTINGS.musicPath,
    musicExtra,
    imageEngineMode: ['auto', 'native', 'upstream', 'interactions'].includes(source.imageEngineMode as string) ? source.imageEngineMode as Settings['imageEngineMode'] : DEFAULT_SETTINGS.imageEngineMode,
    audioEngineMode: ['auto', 'native', 'upstream'].includes(source.audioEngineMode as string) ? source.audioEngineMode as Settings['audioEngineMode'] : DEFAULT_SETTINGS.audioEngineMode,
  };
}
function purgeLegacySettings() {
  if (typeof window === 'undefined') return;
  // Access can throw in restricted browser contexts; clear each storage independently.
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    try {
      const storage = globalThis[name];
      for (const key of ['olai.key', 'studio.key', 'studio.settings']) storage?.removeItem(key);
      if (name === 'sessionStorage') storage?.removeItem('olai.settings');
    } catch { /* Storage may be disabled. Never print legacy configuration. */ }
  }
}
export function loadSettings(): Settings {
  if (typeof window === 'undefined') return { ...DEFAULT_SETTINGS };
  let value: unknown;
  try { value = JSON.parse(localStorage.getItem('olai.settings') || localStorage.getItem('studio.settings') || '{}'); }
  catch { /* Corrupt or inaccessible settings fall back to public defaults. */ }
  const settings = safeSettings(value);
  purgeLegacySettings();
  try { localStorage.setItem('olai.settings', JSON.stringify(settings)); } catch { /* Optional local preferences. */ }
  return settings;
}
export function saveSettings(settings: Settings) {
  if (typeof window === 'undefined') return;
  purgeLegacySettings();
  try { localStorage.setItem('olai.settings', JSON.stringify(safeSettings(settings))); } catch { /* Optional local preferences. */ }
}
