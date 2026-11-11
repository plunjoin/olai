import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import node from '@astrojs/node';

export default defineConfig({
  integrations: [react()],
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  // Astro's built-in CSRF check compares Origin with the adapter-normalized URL.
  // @astrojs/node falls back to localhost unless the host is listed in
  // security.allowedDomains, which cannot be known at build time for arbitrary
  // deployments. Behind a reverse proxy that makes every form-like (for example
  // text/plain uploads) or body-less POST fail with
  // "Cross-site POST form submissions are forbidden". Origin is enforced instead
  // by src/middleware.ts and each mutating API route via sameOrigin(), which
  // honors SITE_ORIGIN and the request Host.
  security: { checkOrigin: false },
  vite: {
    ssr: { noExternal: [/^drizzle-orm(?:\/|$)/] },
  },
  server: { port: 4321 },
  devToolbar: { enabled: false },
});
