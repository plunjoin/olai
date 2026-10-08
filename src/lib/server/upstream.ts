// Gateways can return HTML error pages. Turn these into API errors before the
// middleware handles them, so a provider outage is not labelled a DB failure.
export async function upstreamErrorResponse(response: Response, path: string): Promise<Response | undefined> {
  if (response.ok || response.headers.get('content-type')?.includes('application/json')) return;
  const kind = path === 'videos' || path.startsWith('videos/') ? '视频' : path.startsWith('images/') || path === 'interactions' ? '图片' : path.startsWith('audio/') ? '音频' : '创作';
  const message = response.status >= 500
    ? `上游${kind}服务暂不可用（HTTP ${response.status}），请稍后重试。`
    : response.status === 429
      ? `上游${kind}服务请求受限（HTTP 429），请稍后重试或检查服务额度。`
      : `上游${kind}服务拒绝了请求（HTTP ${response.status}），请检查参数或服务连接。`;
  await response.body?.cancel().catch(() => {});
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) headers.set('Retry-After', retryAfter);
  return Response.json({ error: { message } }, { status: response.status, headers });
}
