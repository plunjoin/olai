<template>
  <div class="app-rail">
    <RouterLink class="app-rail-brand" to="/" :aria-label="t('小o 首页')" :data-tip="t('小o 首页')">
      <BrandLogo :size="30" />
    </RouterLink>

    <nav class="app-rail-nav" :aria-label="t('主导航')">
      <RouterLink
        v-for="item in items"
        :key="item.key"
        class="app-rail-btn"
        :class="{ 'is-active': isActive(item) }"
        :to="item.to"
        :aria-label="t(item.label)"
        :aria-current="isActive(item) ? 'page' : undefined"
        :data-tip="t(item.label)"
        @click="onNavigate(item.key, $event)"
      >
        <component :is="item.icon" :size="20" :stroke-width="1.7" />
      </RouterLink>
    </nav>

    <div class="app-rail-bottom">
      <RouterLink class="app-rail-btn app-rail-download" to="/download" :aria-label="t('下载应用')" :data-tip="t('下载应用')">
        <Download :size="20" :stroke-width="1.7" />
      </RouterLink>
      <slot name="settings" />
      <RouterLink
        class="app-rail-avatar"
        :to="accountTarget"
        :aria-label="accountLabel"
        :data-tip="accountLabel"
        @click="emit('account-click', $event)"
      >
        <AccountAvatar :name="accountName" :avatar="user?.avatar" :size="26" />
      </RouterLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { Download } from 'lucide-vue-next';
import BrandLogo from './BrandLogo.vue';
import AccountAvatar from './AccountAvatar.vue';
import { t } from '../lib/i18n';
import { profileDisplayName } from '../lib/profile';
import type { Account } from '../lib/account';
import { isNavigationActive, primaryNavigation, type NavigationItem, type NavigationKey } from '../lib/navigation';

const props = withDefaults(defineProps<{ user?: Account | null; shortFilm?: boolean }>(), {
  user: null,
  shortFilm: false,
});
const emit = defineEmits<{
  'account-click': [event: MouseEvent];
  navigate: [key: NavigationKey, event: MouseEvent];
}>();
const route = useRoute();
const items = computed(() => primaryNavigation(props.shortFilm));
const accountName = computed(() => props.user ? profileDisplayName(props.user) : t('访客'));
const accountTarget = computed(() => props.user ? '/account' : '/login');
const accountLabel = computed(() => props.user ? t('我的账号 · {name}', { name: accountName.value }) : t('登录 / 注册'));

function isActive(item: NavigationItem) {
  return isNavigationActive(item, route.path, route.name);
}
function onNavigate(key: NavigationKey, event: MouseEvent) {
  emit('navigate', key, event);
}
</script>
