import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import node from '@astrojs/node';
import db from '@astrojs/db';

export default defineConfig({
  integrations: [react(), db(), {
    name: 'olai-database-runtime',
    hooks: {
      'astro:config:setup': ({ updateConfig }) => updateConfig({
        vite: { plugins: [{
          name: 'olai-database-runtime-url',
          enforce: 'pre',
          transform(source, id) {
            if (id !== '\0astro:db') return;
            // Astro DB otherwise fixes the URL at build time, and an empty
            // build env can shadow its fallback and throw during module import.
            return source.replace('url: import.meta.env.ASTRO_DB_REMOTE_URL ??',
              'url: process.env.ASTRO_DB_REMOTE_URL || import.meta.env.ASTRO_DB_REMOTE_URL ||');
          },
        }] },
      }),
    },
  }],
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: { port: 4321 },
  devToolbar: { enabled: false },
});
