<template>
  <div class="gallery-page library-page">
    <div class="page-intro gallery-intro">
      <div>
        <span class="eyebrow">A COLLECTION OF YOUR IMAGINATION</span>
        <h1>{{ t('我的库') }}</h1>
        <p>{{ account.user ? t('这里只展示你生成的作品，登录后可跨设备查看。') : t('当前浏览器的创作保留在这里，登录后同步到你的账号。') }}</p>
        <RouterLink v-if="!account.user" class="secondary-button library-login" to="/login">{{ t('登录查看我的作品') }}</RouterLink>
      </div>
      <span class="library-total">{{ completedCount }}<small>{{ t('件创作') }}</small></span>
    </div>

    <div class="gallery-toolbar">
      <div class="filter-tabs" role="group" :aria-label="t('作品类型')">
        <button v-for="tab in tabs" :key="tab.key" type="button" :class="{ active: filter === tab.key }" :aria-pressed="filter === tab.key" @click="filter = tab.key">{{ tab.label }}<span>{{ countFor(tab.key) }}</span></button>
      </div>
      <div class="gallery-toolbar-actions">
        <div class="search-input"><Search :size="16" /><input v-model="search" :aria-label="t('搜索作品')" :placeholder="t('搜索灵感关键词…')" /></div>
      </div>
    </div>

    <div v-if="visible.length" class="library-grid">
      <AssetCard
        v-for="asset in visible"
        :key="asset.id"
        :asset="asset"
        :style="ratioStyle(asset)"
        :aligning="aligningIds.includes(asset.id)"
        @retry="retryAsset"
        @delete="deleteAsset"
        @download="downloadAsset"
        @edit="editAsset"
        @align="alignMusicLyrics"
        @download-cover="downloadCover"
        @retry-cover="retryCover"
        @visibility="changeVisibility"
      />
    </div>
    <div v-else class="library-empty gallery-empty">
      <template v-if="filter === 'failed' && !failedCount">
        <div class="empty-orbit"><CircleAlert :size="96" /></div>
        <h2>{{ t('没有生成失败的作品') }}</h2>
        <p>{{ t('生成未完成的作品会集中在这里，方便重试或删除。') }}</p>
        <button type="button" class="secondary-button empty-reset" @click="resetFilters">{{ t('查看全部作品') }}</button>
      </template>
      <template v-else-if="assets.length">
        <div class="empty-orbit"><Companion :size="130" /></div>
        <h2>{{ t('还没有匹配的作品') }}</h2>
        <p>{{ t('试试其他关键词，或切换作品类型。') }}</p>
        <button type="button" class="secondary-button empty-reset" @click="resetFilters">{{ t('查看全部作品') }}</button>
      </template>
      <template v-else>
        <div class="empty-orbit"><Companion :size="150" /></div>
        <h2>{{ t('第一份灵感，值得一个好位置') }}</h2>
        <p>{{ t('你的作品会在这里相遇。从一个小小的想法开始吧。') }}</p>
        <div class="empty-library-actions">
          <RouterLink class="secondary-button" to="/image"><ImageIcon :size="16" />{{ t('生成图像') }}</RouterLink>
          <RouterLink class="secondary-button" to="/video"><Video :size="16" />{{ t('生成视频') }}</RouterLink>
          <RouterLink class="secondary-button" to="/music"><Music2 :size="16" />{{ t('生成音乐') }}</RouterLink>
        </div>
      </template>
    </div>

    <p v-if="visibilityNote" class="library-footnote" role="status">{{ visibilityNote }}</p>
    <p class="library-footnote">{{ account.user ? t('作品保存在你的账号 · 已完成作品默认公开，可在卡片上设为私密 · 重要作品请下载备份') : t('作品保存在当前浏览器 · 登录后可同步 · 重要作品请下载备份') }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { CircleAlert, Image as ImageIcon, Music2, Search, Video } from 'lucide-vue-next';
import AssetCard from './AssetCard.vue';
import Companion from './Companion.vue';
import { galleryKindLabel } from '../lib/galleryDetail';
import { t } from '../lib/i18n';
import { put } from '../lib/storage';
import type { Asset } from '../lib/types';
import {
  account, alignMusicLyrics, aligningIds, assets, deleteAsset, downloadAsset, downloadCover, retryAsset, retryCover, completedCount,
} from '../composables/studio';

const emit = defineEmits<{ edit: [asset: Asset] }>();
const visibilityNote = ref('');
async function changeVisibility(asset: Asset) {
  if (!account.value.user) { visibilityNote.value = t('登录后才能设置作品是否公开。'); return; }
  const next = asset.visibility === 'private' ? 'public' : 'private';
  const updated = { ...asset, visibility: next } as Asset;
  try {
    await put('assets', updated);
    assets.value = assets.value.map(item => item.id === asset.id ? updated : item);
    visibilityNote.value = next === 'private' ? t('已设为私密，广场和主页不再展示。') : t('已设为公开。');
  } catch (cause) {
    visibilityNote.value = cause instanceof Error ? cause.message : t('公开设置暂不可用，请稍后重试。');
  }
}
type Filter = 'all' | 'image' | 'video' | 'music' | 'failed';
const filter = ref<Filter>('all');
const search = ref('');
const failedCount = computed(() => assets.value.filter(asset => asset.status === 'failed').length);
const tabs = computed(() => [
  { key: 'all' as const, label: t('全部作品') },
  { key: 'image' as const, label: galleryKindLabel('image') },
  { key: 'video' as const, label: galleryKindLabel('video') },
  { key: 'music' as const, label: galleryKindLabel('music') },
  { key: 'failed' as const, label: t('生成失败') },
]);
// Failed generations live in their own tab only, so they never crowd the
// finished and in-progress works in the type tabs.
const visible = computed(() => assets.value.filter(asset => {
  const isFailed = asset.status === 'failed';
  if (filter.value === 'failed') {
    if (!isFailed) return false;
  } else {
    if (isFailed) return false;
    if (filter.value !== 'all' && asset.kind !== filter.value) return false;
  }
  const query = search.value.trim().toLowerCase();
  const haystack = `${asset.prompt}\n${asset.song?.title ?? ''}\n${asset.song?.style ?? ''}`.toLowerCase();
  return !query || haystack.includes(query);
}));
function countFor(key: Filter) {
  return assets.value.filter(asset => {
    const isFailed = asset.status === 'failed';
    if (key === 'failed') return isFailed;
    if (isFailed) return false;
    return key === 'all' || asset.kind === key;
  }).length;
}
/** Reserve the image's ratio before it loads so masonry columns do not jump. */
function ratioStyle(asset: Asset) {
  if (asset.kind !== 'image' || !asset.imageWidth || !asset.imageHeight) return undefined;
  return { '--asset-ratio': `${asset.imageWidth} / ${asset.imageHeight}` };
}
function resetFilters() { search.value = ''; filter.value = 'all'; }
function editAsset(asset: Asset) { emit('edit', asset); }
</script>
