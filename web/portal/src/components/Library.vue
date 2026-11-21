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
      />
    </div>
    <div v-else class="library-empty gallery-empty">
      <template v-if="assets.length">
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

    <p class="library-footnote">{{ account.user ? t('作品保存在你的账号 · 已完成作品也会展示在作品广场 · 重要作品请下载备份') : t('作品保存在当前浏览器 · 登录后可同步 · 重要作品请下载备份') }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { Image as ImageIcon, Music2, Search, Video } from 'lucide-vue-next';
import AssetCard from './AssetCard.vue';
import Companion from './Companion.vue';
import { galleryKindLabel } from '../lib/galleryDetail';
import { t } from '../lib/i18n';
import type { Asset } from '../lib/types';
import {
  account, alignMusicLyrics, aligningIds, assets, deleteAsset, downloadAsset, downloadCover, retryAsset, retryCover, completedCount,
} from '../composables/studio';

const emit = defineEmits<{ edit: [asset: Asset] }>();
type Filter = 'all' | 'image' | 'video' | 'music';
const filter = ref<Filter>('all');
const search = ref('');
const tabs = computed(() => [
  { key: 'all' as const, label: t('全部作品') },
  { key: 'image' as const, label: galleryKindLabel('image') },
  { key: 'video' as const, label: galleryKindLabel('video') },
  { key: 'music' as const, label: galleryKindLabel('music') },
]);
const visible = computed(() => assets.value.filter(asset => {
  const kindMatch = filter.value === 'all' || asset.kind === filter.value;
  const query = search.value.trim().toLowerCase();
  const haystack = `${asset.prompt}\n${asset.song?.title ?? ''}\n${asset.song?.style ?? ''}`.toLowerCase();
  return kindMatch && (!query || haystack.includes(query));
}));
const countFor = (key: Filter) => assets.value.filter(asset => key === 'all' || asset.kind === key).length;
/** Reserve the image's ratio before it loads so masonry columns do not jump. */
function ratioStyle(asset: Asset) {
  if (asset.kind !== 'image' || !asset.imageWidth || !asset.imageHeight) return undefined;
  return { '--asset-ratio': `${asset.imageWidth} / ${asset.imageHeight}` };
}
function resetFilters() { search.value = ''; filter.value = 'all'; }
function editAsset(asset: Asset) { emit('edit', asset); }
</script>
