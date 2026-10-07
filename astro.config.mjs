import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import node from '@astrojs/node';
import db from '@astrojs/db';

export default defineConfig({
  integrations: [react(), db()],
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: { port: 4321 },
  devToolbar: { enabled: false },
});
