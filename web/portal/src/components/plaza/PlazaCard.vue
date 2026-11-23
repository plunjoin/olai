<template>
  <article class="plaza-card" :class="{ 'is-menu-open': menuOpen }" :data-asset-id="asset.id">
    <div class="plaza-card-visual">
      <button
        type="button"
        class="plaza-card-open"
        :aria-label="t('查看作品：{title}', { title })"
        @click="emit('open', asset, $event)"
      >
        <span class="plaza-card-media" :data-plaza-media="asset.id" :style="{ aspectRatio: ratio }">
          <img
            v-if="imageSrc && !imageFailed"
            :src="imageSrc"
            :alt="title"
            loading="lazy"
            decoding="async"
            draggable="false"
            @error="imageFailed = true"
          />
          <span v-else class="plaza-card-fallback">
            <Video v-if="asset.kind === 'video'" :size="26" stroke-width="1.5" />
            <Music2 v-else-if="asset.kind === 'music'" :size="26" stroke-width="1.5" />
            <ImageIcon v-else :size="26" stroke-width="1.5" />
          </span>
          <span v-if="asset.kind !== 'image'" class="plaza-card-kind">
            <Video v-if="asset.kind === 'video'" :size="11" /><Music2 v-else :size="11" />{{ kindLabel }}
          </span>
          <span class="plaza-card-shade" aria-hidden="true" />
          <span class="plaza-card-title">{{ title }}</span>
        </span>
      </button>
      <button
        type="button"
        class="plaza-card-save"
        :class="{ 'is-favorite': favorite }"
        :aria-label="favorite ? t('取消收藏：{title}', { title }) : t('收藏作品：{title}', { title })"
        :aria-pressed="favorite"
        :title="favorite ? t('取消收藏') : t('收藏作品')"
        @click.stop="emit('favorite', asset)"
      >
        <Bookmark :size="16" :fill="favorite ? 'currentColor' : 'none'" />
      </button>
    </div>

    <footer class="plaza-card-meta">
      <RouterLink v-if="asset.author?.id" class="plaza-card-author" :to="`/u/${asset.author.id}`" :title="authorName" @click.stop>
        <AccountAvatar :name="authorName" :avatar="asset.author?.avatar" :size="20" />
        <span class="plaza-card-author-name">{{ authorName }}</span>
      </RouterLink>
      <span v-else class="plaza-card-author" :title="authorName">
        <AccountAvatar :name="authorName" :avatar="asset.author?.avatar" :size="20" />
        <span class="plaza-card-author-name">{{ authorName }}</span>
      </span>
      <div class="plaza-card-more-wrap">
        <button
          type="button"
          class="plaza-card-more"
          :class="{ 'is-open': menuOpen }"
          :aria-label="t('更多作品操作')"
          :aria-expanded="menuOpen"
          @click.stop="toggleMenu"
        >
          <Ellipsis :size="18" />
        </button>
        <div v-if="menuOpen" class="plaza-card-menu" role="menu" @click.stop>
          <button type="button" role="menuitem" @click="choose('favorite')">
            <Bookmark :size="14" :fill="favorite ? 'currentColor' : 'none'" />{{ favorite ? t('取消收藏') : t('收藏作品') }}
          </button>
          <button type="button" role="menuitem" @click="choose('download')">
            <Download :size="14" />{{ t('下载作品') }}
          </button>
          <button type="button" role="menuitem" @click="choose('share')">
            <Link2 :size="14" />{{ t('复制链接') }}
          </button>
          <button type="button" role="menuitem" class="is-danger" @click="choose('report')">
            <Flag :size="14" />{{ t('举报作品') }}
          </button>
        </div>
      </div>
    </footer>
  </article>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Bookmark, Download, Ellipsis, Flag, Image as ImageIcon, Link2, Music2, Video } from 'lucide-vue-next';
import AccountAvatar from '../AccountAvatar.vue';
import { galleryKindLabel, galleryTitle } from '../../lib/galleryDetail';
import { t } from '../../lib/i18n';
import type { Asset } from '../../lib/types';

const props = withDefaults(defineProps<{ asset: Asset; favorite?: boolean }>(), { favorite: false });
const emit = defineEmits<{
  open: [asset: Asset, event: MouseEvent];
  favorite: [asset: Asset];
  download: [asset: Asset];
  share: [asset: Asset];
  report: [asset: Asset];
}>();

const menuOpen = ref(false);
const imageFailed = ref(false);
const title = computed(() => galleryTitle(props.asset));
const kindLabel = computed(() => galleryKindLabel(props.asset.kind));
const authorName = computed(() => props.asset.author?.name || t('Olai 社区'));
const imageSrc = computed(() => {
  const asset = props.asset;
  if (asset.kind === 'image') return asset.thumbnail || asset.url || '';
  return asset.coverThumbnail || asset.coverUrl || (asset.kind === 'music' ? '' : asset.thumbnail || '');
});
const ratio = computed(() => {
  const asset = props.asset;
  if (asset.kind === 'image') {
    if (asset.imageWidth && asset.imageHeight) return `${asset.imageWidth} / ${asset.imageHeight}`;
    return '4 / 5';
  }
  if (asset.kind === 'video') return '16 / 10';
  return '1 / 1';
});

function closeMenu() { menuOpen.value = false; }
function toggleMenu(event: MouseEvent) {
  event.stopPropagation();
  menuOpen.value = !menuOpen.value;
}
function choose(action: 'favorite' | 'download' | 'share' | 'report') {
  menuOpen.value = false;
  if (action === 'favorite') emit('favorite', props.asset);
  else if (action === 'download') emit('download', props.asset);
  else if (action === 'share') emit('share', props.asset);
  else emit('report', props.asset);
}
function onDocumentClick() { closeMenu(); }

watch(menuOpen, open => {
  if (open) window.setTimeout(() => document.addEventListener('click', onDocumentClick), 0);
  else document.removeEventListener('click', onDocumentClick);
});
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick));
</script>
