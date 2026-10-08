import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import node from '@astrojs/node';

export default defineConfig({
  integrations: [react()],
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  vite: {
    ssr: { noExternal: [/^drizzle-orm(?:\/|$)/] },
  },
  server: { port: 4321 },
  devToolbar: { enabled: false },
});
