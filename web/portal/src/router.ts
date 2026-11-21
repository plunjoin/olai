import { createMemoryHistory, createRouter, createWebHistory, type RouterHistory } from 'vue-router';
import GalleryPage from './pages/GalleryPage.vue';
import DownloadPage from './pages/DownloadPage.vue';
import SetupPage from './pages/SetupPage.vue';
import LoginPage from './pages/LoginPage.vue';
import AccountPage from './pages/AccountPage.vue';
import StudioPage from './pages/StudioPage.vue';
import NotFoundPage from './pages/NotFoundPage.vue';

const routes = [
  { path: '/', name: 'home', component: GalleryPage },
  { path: '/download', name: 'download', component: DownloadPage },
  { path: '/setup', name: 'setup', component: SetupPage },
  { path: '/login', name: 'login', component: LoginPage },
  { path: '/account', name: 'account', component: AccountPage },
  { path: '/chat/:conversationId?', name: 'chat', component: StudioPage, props: (route: any) => ({ view: 'chat', conversationId: route.params.conversationId || '' }) },
  { path: '/image', name: 'image', component: StudioPage, props: { view: 'image' } },
  { path: '/video', name: 'video', component: StudioPage, props: { view: 'video' } },
  { path: '/music', name: 'music', component: StudioPage, props: { view: 'music' } },
  { path: '/gallery', name: 'gallery', component: GalleryPage },
  { path: '/library', name: 'library', component: StudioPage, props: { view: 'library' } },
  { path: '/workflow', name: 'workflow', component: StudioPage, props: { view: 'workflow' } },
  // Admin lives in its own SPA (web/admin); portal only knows the public app.
  { path: '/:pathMatch(.*)*', name: 'fallback', component: NotFoundPage },
];

// The server renders with memory history; the browser hydrates with real URLs.
export function createAppRouter(target: 'client' | 'server' = 'client') {
  const history: RouterHistory = target === 'server' ? createMemoryHistory() : createWebHistory();
  return createRouter({
    history,
    routes,
    // Query-only moves (opening a work) must not disturb the shared-element
    // flight, so keep the current position when the path is unchanged.
    scrollBehavior(to, from, savedPosition) {
      if (savedPosition) return savedPosition;
      if (to.path === from.path) return false;
      return { top: 0 };
    },
  });
}
