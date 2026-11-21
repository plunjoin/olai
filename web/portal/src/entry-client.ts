import { createApp, createSSRApp } from 'vue';
import App from './App.vue';
import { createAppRouter } from './router';
import { setLocale, type Locale } from './lib/i18n';
import './styles/index.css';

const dataElement = document.getElementById('__WF_DATA__');
const bootstrapElement = document.getElementById('__WF_BOOTSTRAP__');
const dataProps: Record<string, unknown> = dataElement ? JSON.parse(dataElement.textContent || '{}') : {};
const bootstrapProps: Record<string, unknown> = bootstrapElement ? JSON.parse(bootstrapElement.textContent || '{}') : {};
const props: Record<string, unknown> = { ...bootstrapProps, ...dataProps };
if (props.locale === 'en' || props.locale === 'zh-CN') setLocale(props.locale as Locale);

const router = createAppRouter('client');
// SSR pages hydrate; app routes served from the SPA shell mount normally.
const app = dataElement ? createSSRApp(App) : createApp(App);
app.use(router);
app.provide('bootstrap', props);
router.isReady().then(() => app.mount('#root'));
