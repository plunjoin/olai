<template>
  <div class="download-page">
    <header class="download-top">
      <a class="download-brand" href="/" aria-label="Olai">
        <img src="/favicon.svg" width="34" height="34" alt="" />
        <span>Olai<small>Online AI Companion</small></span>
      </a>
      <nav class="download-nav">
        <RouterLink to="/">{{ t('返回首页') }}</RouterLink>
        <RouterLink to="/gallery">{{ t('作品广场') }}</RouterLink>
        <RouterLink to="/chat">{{ t('开始创作') }}</RouterLink>
      </nav>
    </header>

    <div class="page-intro download-intro">
      <div>
        <span class="eyebrow">GET THE APP</span>
        <h1>{{ t('下载 Olai') }}</h1>
        <p>{{ hasStoreRelease ? t('iOS 和 Android 应用已发布，可从官方商店下载。也可以直接在网页里使用。') : t('iOS 和 Android 应用正在准备上架。这个页面会留给正式发布后的下载入口。现在也可以先在网页里使用。') }}</p>
      </div>
      <span v-if="versionLabel" class="download-version">{{ t('当前版本 {version}', { version: versionLabel }) }}</span>
    </div>

    <section class="download-grid" :aria-label="t('下载 Olai')">
      <article class="download-card" :class="ios.downloadUrl ? 'is-ready' : 'is-soon'">
        <span v-if="ios.downloadUrl && ios.latestVersion" class="download-badge">{{ t('版本 {version}', { version: ios.latestVersion }) }}</span>
        <span v-else-if="!ios.downloadUrl" class="download-badge">{{ t('即将上架') }}</span>
        <h2>App Store</h2>
        <p>{{ t('iPhone 和 iPad') }}</p>
        <a v-if="ios.downloadUrl" class="download-cta lime-button" :href="ios.downloadUrl" target="_blank" rel="noopener noreferrer">{{ t('下载') }}</a>
        <span v-else class="download-cta" aria-disabled="true">{{ t('即将上架') }}</span>
      </article>
      <article class="download-card" :class="android.downloadUrl ? 'is-ready' : 'is-soon'">
        <span v-if="android.downloadUrl && android.latestVersion" class="download-badge">{{ t('版本 {version}', { version: android.latestVersion }) }}</span>
        <span v-else-if="!android.downloadUrl" class="download-badge">{{ t('即将上架') }}</span>
        <h2>Google Play</h2>
        <p>{{ t('Android 手机和平板') }}</p>
        <a v-if="android.downloadUrl" class="download-cta lime-button" :href="android.downloadUrl" target="_blank" rel="noopener noreferrer">{{ t('下载') }}</a>
        <span v-else class="download-cta" aria-disabled="true">{{ t('即将上架') }}</span>
      </article>
      <article class="download-card is-ready">
        <h2>{{ t('网页版') }}</h2>
        <p>{{ t('现在就能用，无需安装') }}</p>
        <RouterLink class="download-cta lime-button" to="/chat">{{ t('打开 Olai') }}</RouterLink>
      </article>
    </section>

    <section v-if="notes" class="download-notes" :aria-label="t('更新说明')">
      <span class="eyebrow">{{ t('更新说明') }}</span>
      <p>{{ notes }}</p>
    </section>

    <footer class="page-footer">
      <span>Olai · {{ t('让灵感有个伴') }}</span>
      <span>{{ versionLabel || 'ONLINE AI COMPANION' }}</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { t } from '../lib/i18n';

interface ReleaseInfo {
  latestVersion: string;
  minimumVersion: string;
  downloadUrl: string;
}

interface VersionInfo {
  server: { version: string; commit?: string; builtAt?: string };
  client: {
    enabled: boolean;
    force: boolean;
    notes: string;
    ios: ReleaseInfo;
    android: ReleaseInfo;
  };
}

const versionInfo = ref<VersionInfo | null>(null);
const emptyRelease = (): ReleaseInfo => ({ latestVersion: '', minimumVersion: '', downloadUrl: '' });
const ios = computed(() => versionInfo.value?.client.ios ?? emptyRelease());
const android = computed(() => versionInfo.value?.client.android ?? emptyRelease());
const notes = computed(() => versionInfo.value?.client.notes?.trim() ?? '');
const hasStoreRelease = computed(() => Boolean(ios.value.downloadUrl || android.value.downloadUrl));
const versionLabel = computed(() => {
  const value = versionInfo.value?.server.version?.trim();
  return value && value !== 'dev' ? `v${value}` : '';
});

onMounted(async () => {
  try {
    const response = await fetch('/api/version', {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return;
    const data = await response.json();
    if (data?.server && data?.client) versionInfo.value = data as VersionInfo;
  } catch {
    // The static store cards remain usable when the metadata endpoint is down.
  }
});
</script>
