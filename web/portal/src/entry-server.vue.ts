// webfront SSR entry: runs inside the pure-Go goja runtime (no Node).
// The public plaza, download page and other public routes are server-rendered;
// studio app routes are served from the SPA shell by Go because they depend on
// browser storage.
import { createSSRApp } from 'vue';
import { renderToString } from '@vue/server-renderer';
import App from './App.vue';
import { createAppRouter } from './router';
import { setLocale, type Locale } from './lib/i18n';

export async function render(url: string, props: Record<string, any>) {
  const locale: Locale = props?.locale === 'en' ? 'en' : 'zh-CN';
  setLocale(locale);

  const router = createAppRouter('server');
  await router.push(url);
  await router.isReady();

  const app = createSSRApp(App);
  app.use(router);
  // Per-request bootstrap props (initialUser, githubLogin) are provided on the
  // app instance — never module scope — because the goja VM is pooled.
  app.provide('bootstrap', props ?? {});
  const html = await renderToString(app);
  // The SPA shell uses <div id="root">; SSR must expose the same mount point
  // so the client can hydrate without an extra wrapper mismatch.
  return { html: `<div id="root">${html}</div>`, head: '' };
}
