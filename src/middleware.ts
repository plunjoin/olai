import { defineMiddleware } from 'astro:middleware';
import { initializationFailure } from './lib/server/initializationFailure';

export const onRequest = defineMiddleware(async (context, next) => {
  if (!context.url.pathname.startsWith('/api/')) return next();
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
