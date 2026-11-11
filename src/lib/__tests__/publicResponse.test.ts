import { afterEach, describe, expect, it, vi } from 'vitest';
import { consumeSSE } from '../api';
import { DEFAULT_SYSTEM_PROMPT, encodeTaskId, decodeTaskId } from '../server/aiConfig';
import { privateValues, publicJSON, publicSSE, publicUpstreamError, redactText, SERVICE_ERROR } from '../server/publicResponse';

afterEach(() => vi.unstubAllEnvs());
const stream = (deltas: string[], extra: Record<string, unknown> = {}) => {
  const bytes = new TextEncoder().encode(deltas.map(content => `data: ${JSON.stringify({ model: 'hidden-provider', ...extra, choices: [{ delta: { content } }] })}\r\n\r\n`).join('') + 'data: [DONE]\r\n\r\n');
  return new ReadableStream<Uint8Array>({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); } });
};
describe('public AI response boundary', () => {
  it('returns only assistant text, strips unknown metadata and redacts configured values', () => {
    vi.stubEnv('AI_CHAT_MODEL', 'private-chat-v9'); vi.stubEnv('AI_API_KEY', 'private-key-123456');
    const json = publicJSON({ model: 'private-chat-v9', key: 'private-key-123456', prompt: DEFAULT_SYSTEM_PROMPT, usage: { internal: true }, choices: [{ message: { content: `你好 private-chat-v9 private-key-123456 ${DEFAULT_SYSTEM_PROMPT}`, reasoning_content: 'private' } }] }, null, privateValues());
    expect(Object.keys(json)).toEqual(['choices']);
    expect(JSON.stringify(json)).not.toMatch(/private-chat-v9|private-key-123456|reasoning_content|usage/);
    expect(JSON.stringify(json)).not.toContain(DEFAULT_SYSTEM_PROMPT);
    expect(JSON.stringify(json)).toContain('你好');
  });
  it('allowlists generated media without revised prompts or provider metadata', () => {
    const json = publicJSON({ model: 'internal', data: [{ b64_json: 'AQID', revised_prompt: 'secret', model: 'private-image', mime_type: 'image/png' }] }, 'image', []);
    expect(json).toEqual({ data: [{ b64_json: 'AQID', mime_type: 'image/png' }] });
    expect(() => publicJSON({ data: [{ url: 'https://example.com/image.png?api_key=anything' }] }, 'image', [])).toThrow();
    expect(() => publicJSON({ data: [{ url: 'https://example.com/private-chat-v9.png' }] }, 'image', ['private-chat-v9'])).toThrow();
    expect(publicJSON({ data: [{ b64_json: 'AQID', mime_type: 'image/png;debug=secret-key' }] }, 'image', ['secret-key'])).toEqual({ data: [{ b64_json: 'AQID', mime_type: 'image/png' }] });
  });
  it('hides upstream errors for every error response format', async () => {
    expect(await publicUpstreamError(502).json()).toEqual({ error: { message: SERVICE_ERROR } });
    expect(publicUpstreamError(429).status).toBe(429);
  });
  it('keeps encrypted task identifiers opaque and authenticated', () => {
    vi.stubEnv('AI_API_KEY', 'server-secret');
    const id = encodeTaskId('provider-model-task-123');
    expect(id).toMatch(/^job_[\w-]+$/); expect(id).not.toContain('provider');
    expect(decodeTaskId(id)).toBe('provider-model-task-123');
    expect(() => decodeTaskId(id.slice(0, -3) + 'aaa')).toThrow();
  });
  it('sanitizes fragmented UTF-8 SSE and secrets split across every boundary', async () => {
    const secrets = ['private-key-abcdef', 'sk-real-secret-123456789', 'gemini-private-model-9.1', 'private-chat-9.1', '内部预设提示词不可以返回'];
    for (const secret of secrets) for (let split = 1; split < secret.length; split++) {
      const output: string[] = [];
      await consumeSSE(publicSSE(stream(['你好 ', secret.slice(0, split), secret.slice(split), ' 再见']), secrets), text => output.push(text));
      expect(output.join('')).toBe(`你好 [已隐藏] 再见`);
    }
  });
  it('buffers unconfigured model/key patterns split across SSE events', async () => {
    for (const value of ['gpt-test-9', 'gemini-other-4', 'sk-unknown-secret-123456789', 'nano-banana-2']) {
      for (let split = 1; split < value.length; split++) {
        const output: string[] = [];
        await consumeSSE(publicSSE(stream(['你好 ', value.slice(0, split), value.slice(split), ' 再见']), []), text => output.push(text));
        expect(output.join('')).toBe('你好 [已隐藏] 再见');
      }
    }
  });
  it('does not leak SSE model fields, tools, reasoning, errors or malformed input', async () => {
    const sanitized = await new Response(publicSSE(stream(['safe'], { api_key: 'key-value', reasoning: 'secret-thought' }), [])).text();
    expect(sanitized).toContain('safe'); expect(sanitized).not.toMatch(/hidden-provider|api_key|reasoning|secret-thought/);
    for (const raw of ['data: {"error":{"message":"secret-key"}}\n\n', 'data: invalid secret-key\n\n']) {
      const bytes = new TextEncoder().encode(raw);
      const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } });
      const result = await new Response(publicSSE(body, ['secret-key'])).text();
      expect(result).not.toContain('secret-key'); expect(result).toContain(SERVICE_ERROR);
    }
  });
  it('redacts private values case insensitively and escaped regex characters literally', () => {
    expect(redactText('prefix Private.Model[1] suffix', ['private.model[1]'])).toBe('prefix [已隐藏] suffix');
  });
});
