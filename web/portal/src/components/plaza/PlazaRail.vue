<template>
  <aside class="plaza-rail" :aria-label="t('主导航')">
    <AppRail :user="user" :short-film="shortFilm">
      <template #settings>
        <div class="plaza-rail-menu-wrap">
          <button type="button" class="app-rail-btn" :class="{ 'is-active': menuOpen }" :aria-label="t('站点设置')" :aria-expanded="menuOpen" :data-tip="t('站点设置')" @click.stop="toggleMenu">
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
      </template>
    </AppRail>
  </aside>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { Check, Settings as SettingsIcon, Sparkles, UserRound } from 'lucide-vue-next';
import AppRail from '../AppRail.vue';
import { getLocale, LOCALES, setLocalePreference, t, type Locale } from '../../lib/i18n';
import type { Account } from '../../lib/account';

const props = withDefaults(defineProps<{ user?: Account | null; shortFilm?: boolean }>(), { user: null, shortFilm: false });
const menuOpen = ref(false);
const currentLocale = getLocale();
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
