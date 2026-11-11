import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIContext } from 'astro';
import { scrubRecordPrivacy } from './recordPrivacy';

const state = vi.hoisted(() => ({ records: [] as any[], chunks: [] as any[], imported: [] as any[] }));
vi.mock('./server/auth', () => ({ currentUser: async () => ({ id: 'owner' }) }));
vi.mock('./server/database', () => {
  const StudioRecord = {}, RecordChunk = {};
  return {
    StudioRecord, RecordChunk, VideoJob: {}, eq: vi.fn(), and: vi.fn(), asc: vi.fn(),
    db: {
      insert: (table: unknown) => ({ values: (value: any) => {
        if (table === RecordChunk) { state.chunks.push(value); return value; }
        return { onConflictDoUpdate: () => { state.records = [value]; return value; } };
      } }),
      delete: () => ({ where: vi.fn() }), batch: vi.fn(async () => []),
      select: (fields?: unknown) => ({ from: () => fields
        ? { innerJoin: () => ({ where: () => ({ orderBy: async () => state.chunks }) }) }
        : { where: async () => state.records } }),
      transaction: async (callback: (transaction: any) => unknown) => callback({
        insert: (table: unknown) => ({ values: (value: any) => {
          if (table === RecordChunk) { state.chunks.push(...value); return Promise.resolve(); }
          state.imported.push(value);
          return { onConflictDoNothing: () => ({ returning: async () => [{ key: value.key }] }) };
        } }),
      }),
    },
  };
});
import { ALL } from '../pages/api/records/[store]';

beforeEach(() => { state.records = []; state.chunks = []; state.imported = []; });
const asset = (extra: Record<string, unknown> = {}) => ({ id: 'asset_1', kind: 'image', createdAt: 1, prompt: 'A quiet forest', status: 'completed', options: { ratio: '16:9' }, ...extra });
async function call(method: string, value?: unknown, query = '') {
  const url = new URL(`http://localhost/api/records/assets${query}`);
  return ALL({ params: { store: 'assets' }, url, request: new Request(url, {
    method, headers: { 'Content-Type': 'application/json', Origin: url.origin, 'X-Olai-User': 'owner' },
    body: value === undefined ? undefined : JSON.stringify(value),
  }) } as unknown as APIContext);
}

describe('record privacy helper', () => {
  it('recursively strips model/config aliases without altering user content, workflow IDs or Blob', () => {
    const blob = new Blob(['raw media']);
    const source = {
      id: 'workflow_1', prompt: 'User prompt', lyrics: 'User lyrics', content: 'User content', blob,
      model: 'private', modelName: 'private', model_id: 'private', modelId: 'private',
      systemPrompt: 'preset', system_prompt: 'preset', apiKey: 'secret', api_key: 'secret', key: 'secret', authorization: 'secret',
      settings: { chatModel: 'private', imageModel: 'private', videoModel: 'private', musicModel: 'private', rememberKey: true, temperature: 0.7 },
      shots: [{ id: 'shot_1', elementIds: ['character_1'], keyframePrompt: 'User scene', options: { model: 'private', seconds: 4 } }],
    };
    const clean = scrubRecordPrivacy(source);
    expect(clean).toEqual({ id: 'workflow_1', prompt: 'User prompt', lyrics: 'User lyrics', content: 'User content', blob,
      settings: { temperature: 0.7 }, shots: [{ id: 'shot_1', elementIds: ['character_1'], keyframePrompt: 'User scene', options: { seconds: 4 } }] });
    expect(clean.blob).toBe(blob); expect(source.model).toBe('private'); expect(source.shots[0].options.model).toBe('private');
  });
  it('traverses only arrays and plain objects and reuses unchanged branches', () => {
    const date = new Date(), map = new Map([['model', 'leave host objects alone']]);
    const safe = { prompt: 'hello', blob: new Blob(), date, map, array: [null, 1, 'lyrics'] };
    expect(scrubRecordPrivacy(safe)).toBe(safe);
    expect(scrubRecordPrivacy([safe, { model: 'private' }])).toEqual([safe, {}]);
    expect(scrubRecordPrivacy(Object.assign(Object.create(null), { model: 'private', id: 'ok' }))).toEqual({ id: 'ok' });
  });
  it('optionally redacts text without corrupting base64/media or workflow IDs', () => {
    const redact = (value: string) => value.replaceAll('SECRET', '[hidden]');
    const source = { id: 'SECRET', remoteId: 'job_SECRET', elementIds: ['SECRET'], prompt: 'Hello SECRET', lyrics: 'SECRET',
      blobData: 'data:image/png;base64,SECRET', keyframeBlobData: 'SECRET', b64_json: 'SECRET', url: 'blob:SECRET',
      shots: [{ id: 'SECRET', sceneDescription: 'SECRET', keyframePrompt: 'SECRET' }] };
    expect(scrubRecordPrivacy(source, redact)).toEqual({ ...source, prompt: 'Hello [hidden]', lyrics: '[hidden]',
      shots: [{ id: 'SECRET', sceneDescription: '[hidden]', keyframePrompt: '[hidden]' }] });
  });
});

describe('records API privacy', () => {
  it('drops legacy provider task identifiers while preserving opaque task tokens', async () => {
    state.records = [{ key: 'legacy', data: JSON.stringify(asset({ remoteId: 'private-model-task-1', shots: [{ videoRemoteId: 'private-model-task-2' }] })) }];
    expect((await (await call('GET')).json()).records).toEqual([asset({ shots: [{}] })]);
    const value = asset({ remoteId: 'job_opaque-token', shots: [{ videoRemoteId: 'job_other-token' }] });
    expect(scrubRecordPrivacy(value)).toEqual(value);
  });
  it('scrubs legacy inline and chunked records before GET responses', async () => {
    state.records = [{ key: 'inline', data: JSON.stringify(asset({ model: 'private', options: { apiKey: 'secret', ratio: '16:9' } })) }, { key: 'chunked', data: '' }];
    state.chunks = [{ recordKey: 'chunked', data: JSON.stringify(asset({ system_prompt: 'preset' })) }];
    const response = await call('GET');
    expect(response.status).toBe(200);
    expect((await response.json()).records).toEqual([asset(), asset()]);
  });
  it('scrubs before inline writes and guest imports rather than persisting raw input', async () => {
    const value = asset({ model: 'private', options: { model_id: 'private', ratio: '16:9' } });
    expect((await call('PUT', value)).status).toBe(200);
    expect(JSON.parse(state.records[0].data)).toEqual(asset());
    expect((await call('PUT', value, '?import=guest')).status).toBe(200);
    expect(JSON.parse(state.imported[0].data)).toEqual(asset());
  });
  it('chunks the scrubbed serialization while preserving large media and unicode content', async () => {
    const blobData = `data:image/png;base64,${'A'.repeat(150_000)}`;
    const value = asset({ model: 'private', blobData, lyrics: '听见风声😀', options: { api_key: 'secret', ratio: '16:9' } });
    expect((await call('PUT', value)).status).toBe(200);
    expect(state.records[0].data).toBe(''); expect(state.chunks.length).toBeGreaterThan(1);
    const saved = JSON.parse(state.chunks.map(chunk => chunk.data).join(''));
    expect(saved).toEqual(asset({ blobData, lyrics: '听见风声😀' }));
  });
  it('redacts configured secret values from text, but never media payloads or IDs', async () => {
    vi.stubEnv('AI_API_KEY', 'private-record-test-secret');
    try {
      const blobData = 'data:image/png;base64,private-record-test-secret';
      const value = asset({ prompt: 'A private-record-test-secret forest', blobData });
      expect((await call('PUT', value)).status).toBe(200);
      expect(JSON.parse(state.records[0].data)).toEqual(asset({ prompt: 'A [已隐藏] forest', blobData }));
      state.records = [{ key: 'old', data: JSON.stringify(value) }];
      expect((await (await call('GET')).json()).records).toEqual([asset({ prompt: 'A [已隐藏] forest', blobData })]);
    } finally { vi.unstubAllEnvs(); }
  });
});
