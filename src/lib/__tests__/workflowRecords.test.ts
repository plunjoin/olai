import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIContext } from 'astro';
import { createEmptyShot, createWorkflowProject } from '../videoWorkflow';

const state = vi.hoisted(() => ({ records: [] as { data: string }[], user: { id: 'owner' } as { id: string } | null }));
vi.mock('../server/auth', () => ({ currentUser: async () => state.user }));
vi.mock('../server/database', () => ({
  StudioRecord: {}, RecordChunk: {}, VideoJob: {}, eq: vi.fn(), and: vi.fn(), asc: vi.fn(),
  db: {
    insert: () => ({ values: (record: { data: string }) => ({ onConflictDoUpdate: () => { state.records = [record]; return record; } }) }),
    delete: () => ({ where: vi.fn() }),
    batch: vi.fn(async () => []),
    select: (fields?: unknown) => ({ from: () => fields
      ? { innerJoin: () => ({ where: () => ({ orderBy: async () => [] }) }) }
      : { where: async () => state.records } }),
  },
}));
import { ALL } from '../../pages/api/records/[store]';

async function call(method: string, value?: unknown, userId = 'owner') {
  const url = new URL('http://localhost/api/records/workflows');
  return ALL({ params: { store: 'workflows' }, url, request: new Request(url, {
    method, headers: { 'Content-Type': 'application/json', Origin: url.origin, 'X-Olai-User': userId },
    body: value === undefined ? undefined : JSON.stringify(value),
  }) } as unknown as APIContext);
}

beforeEach(() => { state.records = []; state.user = { id: 'owner' }; });
describe('workflow cloud records', () => {
  it('saves and reads a storyboard with reusable elements', async () => {
    const project = { ...createWorkflowProject('云端故事'), elements: [{ id: 'girl', kind: 'character', name: '小雨', description: '黄色雨衣' }], shots: [{ ...createEmptyShot(1), elementIds: ['girl'] }] };
    expect((await call('PUT', project)).status).toBe(200);
    const response = await call('GET');
    expect(response.status).toBe(200);
    expect((await response.json()).records).toEqual([project]);
  });
  it('accepts legacy projects with no element collection', async () => {
    const project = createWorkflowProject('旧项目');
    delete project.elements;
    expect((await call('PUT', project)).status).toBe(200);
  });
  it('rejects malformed elements and invalid shot durations', async () => {
    const project = createWorkflowProject('校验');
    expect((await call('PUT', { ...project, elements: [{ kind: 'unknown' }] })).status).toBe(400);
    expect((await call('PUT', { ...project, shots: [{ ...createEmptyShot(1), duration: -1 }] })).status).toBe(400);
  });
  it('requires authentication and the current account identifier', async () => {
    expect((await call('PUT', createWorkflowProject('测试'), 'another-user')).status).toBe(409);
    state.user = null;
    expect((await call('GET')).status).toBe(401);
  });
});
