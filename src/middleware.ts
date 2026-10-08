import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(async (context, next) => {
  if (!context.url.pathname.startsWith('/api/')) return next();
  try {
    const response = await next();
    if (response.status >= 500 && !response.headers.get('content-type')?.includes('application/json')) {
      return apiFailure();
    }
    return response;
  } catch (error) {
    console.error('API initialization failed:', error instanceof Error ? error.message : 'Unknown error');
    return apiFailure();
  }
});
function apiFailure() {
  return Response.json({ error: { message: '服务初始化失败，请检查数据库配置，并使用 npm run build、npm start 重新构建和启动。' } }, {
    status: 503, headers: { 'Cache-Control': 'no-store' },
  });
}
