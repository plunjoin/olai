import { defineMiddleware } from 'astro:middleware';
import { initializationFailure } from './lib/server/initializationFailure';
import { sameOrigin } from './lib/server/policy';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const onRequest = defineMiddleware(async (context, next) => {
  if (!context.url.pathname.startsWith('/api/')) return next();
  // Astro's built-in origin check is disabled (see astro.config.mjs) because it
  // compares against the adapter-normalized URL instead of SITE_ORIGIN. Enforce
  // it here for every mutating API request so no route can silently miss it.
  if (!SAFE_METHODS.has(context.request.method) && !sameOrigin(context.request)) {
    return Response.json({ error: { message: '不允许跨站调用。' } }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    // Load here so missing drivers and initialization errors reach this catch
    // before Astro's route loader replaces them with an HTML error response.
    await import('./lib/server/database');
    await import('./lib/server/auth');
    const response = await next();
    if (response.status >= 500 && !response.headers.get('content-type')?.includes('application/json')) {
      return initializationFailure();
    }
    return response;
  } catch (error) {
    console.error('API initialization failed:', error);
    return initializationFailure(error);
  }
});
