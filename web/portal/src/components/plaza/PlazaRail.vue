<template>
  <aside class="plaza-rail" :aria-label="t('主导航')">
    <RouterLink class="plaza-rail-brand" to="/" :aria-label="t('作品广场')">
      <BrandLogo :size="30" />
    </RouterLink>

    <nav class="plaza-rail-nav" :aria-label="t('主导航')">
      <RouterLink class="plaza-rail-btn" :class="{ 'is-active': isPath('/chat') }" to="/chat" :aria-label="t('AI 对话')" :data-tip="t('AI 对话')">
        <MessageSquare :size="20" :stroke-width="1.7" />
      </RouterLink>
      <RouterLink class="plaza-rail-btn" :class="{ 'is-active': isPath('/image') }" to="/image" :aria-label="t('图像')" :data-tip="t('图像')">
        <ImageIcon :size="20" :stroke-width="1.7" />
      </RouterLink>
      <RouterLink class="plaza-rail-btn" :class="{ 'is-active': isPath('/video') }" to="/video" :aria-label="t('视频')" :data-tip="t('视频')">
        <Video :size="20" :stroke-width="1.7" />
      </RouterLink>
      <RouterLink class="plaza-rail-btn" :class="{ 'is-active': isPath('/music') }" to="/music" :aria-label="t('音乐')" :data-tip="t('音乐')">
        <Music2 :size="20" :stroke-width="1.7" />
      </RouterLink>
      <RouterLink class="plaza-rail-btn" :class="{ 'is-active': isGallery }" to="/" :aria-label="t('作品广场')" :data-tip="t('作品广场')">
        <Compass :size="20" :stroke-width="1.7" />
      </RouterLink>
      <RouterLink class="plaza-rail-btn" :class="{ 'is-active': isPath('/library') }" to="/library" :aria-label="t('我的库')" :data-tip="t('我的库')">
        <LayoutGrid :size="20" :stroke-width="1.7" />
      </RouterLink>
      <RouterLink v-if="shortFilm" class="plaza-rail-btn" :class="{ 'is-active': isPath('/workflow') }" to="/workflow" :aria-label="t('短片工坊')" :data-tip="t('短片工坊')">
        <Film :size="20" :stroke-width="1.7" />
      </RouterLink>
    </nav>

    <div class="plaza-rail-bottom">
      <RouterLink class="plaza-rail-btn" :class="{ 'is-active': isPath('/download') }" to="/download" :aria-label="t('下载应用')" :data-tip="t('下载应用')">
        <Download :size="20" :stroke-width="1.7" />
      </RouterLink>
      <div class="plaza-rail-menu-wrap">
        <button type="button" class="plaza-rail-btn" :class="{ 'is-active': menuOpen }" :aria-label="t('站点设置')" :aria-expanded="menuOpen" :data-tip="t('站点设置')" @click.stop="toggleMenu">
          <SettingsIcon :size="20" :stroke-width="1.7" />
        </button>
        <div v-if="menuOpen" class="plaza-rail-menu" role="menu" @click.stop>
          <span class="plaza-rail-menu-label">{{ t('语言') }}</span>
          <button v-for="locale in LOCALES" :key="locale.code" type="button" role="menuitem" :class="{ 'is-current': locale.code === currentLocale }" @click="chooseLocale(locale.code)">
            {{ locale.label }}<Check v-if="locale.code === currentLocale" :size="14" />
          </button>
          <span class="plaza-rail-menu-sep" />
          <RouterLink to="/chat" role="menuitem"><Sparkles :size="14" />{{ t('进入创作台') }}</RouterLink>
          <RouterLink :to="user ? '/account' : '/login'" role="menuitem">
            <UserRound :size="14" />{{ user ? t('账号中心') : t('登录') }}
          </RouterLink>
        </div>
      </div>
      <RouterLink class="plaza-rail-avatar" :to="user ? '/account' : '/login'" :aria-label="user ? t('我的账号 · {name}', { name: accountName }) : t('登录 / 注册')" :title="user ? accountName : t('登录 / 注册')">
        <AccountAvatar :name="accountName" :avatar="user?.avatar" :size="26" />
      </RouterLink>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  Check, Compass, Download, Film, Image as ImageIcon, LayoutGrid, MessageSquare, Music2,
  Settings as SettingsIcon, Sparkles, UserRound, Video,
} from 'lucide-vue-next';
import BrandLogo from '../BrandLogo.vue';
import AccountAvatar from '../AccountAvatar.vue';
import { getLocale, LOCALES, setLocalePreference, t, type Locale } from '../../lib/i18n';
import { profileDisplayName } from '../../lib/profile';
import type { Account } from '../../lib/account';

const props = withDefaults(defineProps<{ user?: Account | null; shortFilm?: boolean }>(), { user: null, shortFilm: false });
const route = useRoute();
const menuOpen = ref(false);
const currentLocale = getLocale();
const accountName = computed(() => props.user ? profileDisplayName(props.user) : t('访客'));
const isGallery = computed(() => route.name === 'home' || route.name === 'gallery');
function isPath(path: string) {
  return route.path === path || route.path.startsWith(`${path}/`);
}
function toggleMenu(event: MouseEvent) {
  event.stopPropagation();
  menuOpen.value = !menuOpen.value;
}
function closeMenu() { menuOpen.value = false; }
function chooseLocale(locale: Locale) {
  closeMenu();
  if (locale !== currentLocale) setLocalePreference(locale);
}
watch(menuOpen, open => {
  if (open) window.setTimeout(() => document.addEventListener('click', closeMenu), 0);
  else document.removeEventListener('click', closeMenu);
});
onBeforeUnmount(() => document.removeEventListener('click', closeMenu));
</script>
