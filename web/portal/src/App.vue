<template>
  <RouterView />
</template>

<script setup lang="ts">
import { watchEffect } from 'vue';
import { useRoute } from 'vue-router';
import { getLocale } from './lib/i18n';

const route = useRoute();
const bodyClass = (name: string) => {
  // Toggle only the route-owned classes: feature state (for example the
  // plaza's scroll lock while a work is open) must survive navigations.
  document.body.classList.remove('plaza-body', 'download-body');
  if (name) document.body.classList.add(name);
};
watchEffect(() => {
  // SSR has no document; the Go renderer sets <html lang> for that response.
  if (typeof document === 'undefined') return;
  document.documentElement.lang = getLocale();
  if (route.name === 'home' || route.name === 'gallery') bodyClass('plaza-body');
  else if (route.name === 'download') bodyClass('download-body');
  else bodyClass('');
});
</script>
