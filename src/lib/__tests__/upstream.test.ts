import { describe, expect, it } from 'vitest';
import { upstreamErrorResponse } from '../server/upstream';

describe('upstream API errors', () => {
  it.each(['videos', 'videos/job-123', 'videos/job-123/content'])('identifies a video provider HTML 502 for %s', async path => {
    const result = await upstreamErrorResponse(new Response('<html>Bad gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }), path);
    expect(result?.status).toBe(502);
    expect(result?.headers.get('content-type')).toContain('application/json');
    expect((await result!.json()).error.message).toBe('上游视频服务暂不可用（HTTP 502），请稍后重试。');
  });
  it('preserves upstream JSON errors and their response body', async () => {
    const original = Response.json({ error: { message: '额度不足' } }, { status: 429 });
    expect(await upstreamErrorResponse(original, 'videos')).toBeUndefined();
    expect((await original.json()).error.message).toBe('额度不足');
  });
  it('preserves successful binary video downloads', async () => {
    const original = new Response('video-bytes', { headers: { 'Content-Type': 'video/mp4' } });
    expect(await upstreamErrorResponse(original, 'videos/job/content')).toBeUndefined();
    expect(await original.text()).toBe('video-bytes');
  });
  it('keeps rate limit status and retry timing for plain text errors', async () => {
    const result = await upstreamErrorResponse(new Response('Too many requests', { status: 429, headers: { 'Retry-After': '60' } }), 'videos');
    expect(result?.status).toBe(429);
    expect(result?.headers.get('retry-after')).toBe('60');
    expect((await result!.json()).error.message).toContain('请求受限');
  });
});
