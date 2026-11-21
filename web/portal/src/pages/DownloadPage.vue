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
        <p>{{ t('iOS 和 Android 应用正在准备上架。这个页面会留给正式发布后的下载入口。现在也可以先在网页里使用。') }}</p>
      </div>
    </div>

    <section class="download-grid" :aria-label="t('下载 Olai')">
      <article class="download-card is-soon">
        <span class="download-badge">{{ t('即将上架') }}</span>
        <h2>App Store</h2>
        <p>{{ t('iPhone 和 iPad') }}</p>
        <span class="download-cta" aria-disabled="true">{{ t('即将上架') }}</span>
      </article>
      <article class="download-card is-soon">
        <span class="download-badge">{{ t('即将上架') }}</span>
        <h2>Google Play</h2>
        <p>{{ t('Android 手机和平板') }}</p>
        <span class="download-cta" aria-disabled="true">{{ t('即将上架') }}</span>
      </article>
      <article class="download-card is-ready">
        <h2>{{ t('网页版') }}</h2>
        <p>{{ t('现在就能用，无需安装') }}</p>
        <RouterLink class="download-cta lime-button" to="/chat">{{ t('打开 Olai') }}</RouterLink>
      </article>
    </section>

    <footer class="page-footer">
      <span>Olai · {{ t('让灵感有个伴') }}</span>
      <span>ONLINE AI COMPANION</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { t } from '../lib/i18n';
</script>
