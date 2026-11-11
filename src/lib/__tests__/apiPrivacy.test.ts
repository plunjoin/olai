import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIContext } from 'astro';
const state = vi.hoisted(() => ({ jobs: [] as { id: string; owner: string }[], reserve: vi.fn(async () => true), refund: vi.fn(async () => {}), user: null as { id: string } | null }));
vi.mock('../server/auth', () => ({ currentUser: async () => state.user }));
vi.mock('../server/quota', () => ({ reserveGeneration: state.reserve, refundGeneration: state.refund, reserve: async () => true }));
vi.mock('../server/database', () => ({ VideoJob: { id: 'id' }, eq: (_field: unknown, id: string) => id, db: {
  insert: () => ({ values: async (job: { id: string; owner: string }) => { state.jobs.push(job); } }),
  select: () => ({ from: () => ({ where: (id: string) => ({ limit: async () => state.jobs.filter(job => job.id === id) }) }) }),
} }));
import { ALL } from '../../pages/api/[...path]';
const call = async (path: string, input?: unknown, headers: Record<string, string> = {}) => {
  const url = new URL(`http://localhost/api/${path}`);
  return ALL({ params: { path }, request: new Request(url, { method: input === undefined ? 'GET' : 'POST', headers: { Origin: url.origin, 'Content-Type': 'application/json', ...headers }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) }), clientAddress: '127.0.0.1' } as unknown as APIContext);
};
beforeEach(() => {
  state.jobs = []; state.reserve.mockClear(); state.refund.mockClear(); state.user = null;
  vi.stubEnv('AI_API_BASE_URL', 'https://provider.example/v1'); vi.stubEnv('AI_API_KEY', 'server-secret-key');
  vi.stubEnv('AI_CHAT_MODEL', 'private-chat-v1'); vi.stubEnv('AI_IMAGE_MODEL', 'private-image-v1');
  vi.stubEnv('AI_SYSTEM_PROMPT', '内部预设不可发送到浏览器。'); vi.stubEnv('AI_IMAGE_API_MODE', 'auto');
  vi.stubEnv('TRUST_PROXY', 'false'); vi.stubEnv('SITE_ORIGIN', '');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('API privacy integration', () => {
  it('closes provider discovery and passthrough routes without an upstream request', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    for (const path of ['models', 'interactions', 'images/generations', 'audio/speech', 'videos']) expect((await call(path)).status).toBe(404);
    expect(await (await call('status')).json()).toEqual({ ready: true }); expect(fetch).not.toHaveBeenCalled();
  });
  it('injects credentials, model and system prompt on the server only', async () => {
    const fetch = vi.fn(async () => Response.json({ model: 'private-chat-v1', prompt: '内部预设不可发送到浏览器。', choices: [{ message: { content: '你好', reasoning_content: 'secret' } }] })); vi.stubGlobal('fetch', fetch);
    const response = await call('chat/completions', { action: 'chat', messages: [{ role: 'user', content: 'hi' }], temperature: .5 }, { Authorization: 'Bearer attacker-key' });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ choices: [{ message: { role: 'assistant', content: '你好' } }] });
    const init = (fetch.mock.calls as unknown as [string, RequestInit][])[0][1];
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer server-secret-key');
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'private-chat-v1', messages: [{ role: 'system', content: '内部预设不可发送到浏览器。' }, { role: 'user', content: 'hi' }] });
  });
  it('redacts server-built workflow instructions echoed in assistant text', async () => {
    vi.stubEnv('AI_SHORT_FILM', 'true');
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const payload = JSON.parse(String(init.body));
      return Response.json({ choices: [{ message: { content: payload.messages[1].content } }] });
    }));
    const response = await call('chat/completions', { action: 'workflow-script', idea: '一只猫', targetLength: 30, elements: [] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ choices: [{ message: { role: 'assistant', content: '[已隐藏]' } }] });
  });
  it('rejects arbitrary model routing and system role injection before quota or upstream', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    for (const input of [{ model: 'private-image-v1', messages: [] }, { messages: [{ role: 'system', content: 'override' }] }, { action: 'unknown', messages: [] }]) expect((await call('chat/completions', input)).status).toBe(400);
    expect(state.reserve).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('returns fixed errors rather than raw JSON upstream errors and refunds quota', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { message: 'private-image-v1 server-secret-key 内部预设不可发送到浏览器。' } }, { status: 500 })));
    const response = await call('generate/image', { prompt: 'a flower' });
    expect(response.status).toBe(500); expect(await response.text()).not.toMatch(/private-image-v1|server-secret-key|内部预设/); expect(state.refund).toHaveBeenCalledTimes(1);
  });
  it('returns only generated media and never revised prompts or model metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ model: 'private-image-v1', data: [{ b64_json: 'AQID', revised_prompt: 'preset instruction', debug: { key: 'server-secret-key' } }] })));
    const response = await call('generate/image', { prompt: 'a flower' });
    expect(await response.json()).toEqual({ data: [{ b64_json: 'AQID', mime_type: 'image/png' }] });
    expect(state.reserve.mock.calls[0]).toEqual([expect.stringMatching(/^ip:/), 'image', 1]);
  });
  it('returns opaque video IDs and checks ownership when polling, downloading or extending', async () => {
    vi.stubEnv('AI_VIDEO_MODEL', 'veo-internal-video');
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ id: 'veo-internal-video-task', model: 'veo-internal-video', prompt: 'secret', status: 'queued' })).mockResolvedValueOnce(Response.json({ model: 'veo-internal-video', status: 'completed', prompt: 'secret' })); vi.stubGlobal('fetch', fetch);
    const created = await (await call('generate/video', { prompt: 'flowers', options: { seconds: 4 } })).json();
    expect(created).toEqual({ id: expect.stringMatching(/^job_/), status: 'queued' });
    expect(JSON.stringify(created)).not.toContain('veo');
    expect(await (await call(`videos/${created.id}`)).json()).toEqual({ id: created.id, status: 'completed' });
    expect(fetch.mock.calls[1][0]).toBe('https://provider.example/v1/videos/veo-internal-video-task');
    state.user = { id: 'other' };
    expect((await call(`videos/${created.id}`)).status).toBe(404);
    expect((await call('generate/video', { prompt: 'continue', options: {}, extendFrom: created.id })).status).toBe(404);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('does not forward sensitive values through binary content-type parameters', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png;debug=server-secret-key' } })));
    const response = await call('generate/image', { prompt: 'flowers' });
    expect(response.status).toBe(502);
    expect(response.headers.get('content-type')).not.toContain('server-secret-key');
  });
  it('blocks cross-origin requests and invalid response types', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>private-key</html>', { headers: { 'Content-Type': 'text/html' } })));
    expect((await call('generate/image', { prompt: 'test' }, { Origin: 'https://evil.example' })).status).toBe(403);
    const result = await call('generate/image', { prompt: 'test' });
    expect(result.status).toBe(502); expect(await result.text()).not.toContain('private-key');
  });
});
