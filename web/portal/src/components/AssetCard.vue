<template>
  <article class="asset-card" :class="{ 'audio-asset': asset.kind === 'music', 'is-playing': playing }">
    <div class="asset-preview" :class="asset.kind">
      <div v-if="asset.status === 'pending'" class="asset-placeholder">
        <ThinkingOrb :size="34" :label="t('小o 正在创作')" />
        <strong>{{ asset.kind === 'video' ? t('视频正在生成') : t('正在构建你的灵感') }}</strong>
        <span>{{ t('作品完成后会自动出现在这里') }}</span>
      </div>
      <div v-else-if="asset.status === 'failed'" class="asset-placeholder failed">
        <CircleAlert :size="25" />
        <strong>{{ t('生成未完成') }}</strong>
        <span>{{ t(publicServiceError(asset.error || t('生成未完成，请重试。'))) }}</span>
        <button v-if="!readOnly" class="secondary-button" @click="emit('retry', asset)"><RefreshCw :size="14" />{{ t('重试') }}</button>
      </div>
      <div v-else-if="!url || loadError" class="asset-placeholder">
        <ImageIcon v-if="asset.kind === 'image'" :size="28" /><Video v-else-if="asset.kind === 'video'" :size="28" /><Music2 v-else :size="28" />
        <strong>{{ loadError ? t('媒体链接暂时不可用') : t('暂无可预览内容') }}</strong>
        <span>{{ readOnly ? t('原文件暂不可用，作品信息仍保留。') : t('可重试生成，或尝试下载作品') }}</span>
      </div>
      <img v-else-if="asset.kind === 'image'" :src="url" :alt="asset.prompt" loading="lazy" @error="loadError = true" @load="onImageLoad" />
      <div v-else-if="asset.kind === 'video'" class="card-video-container" @click="openPlayer" @mouseenter="beginVideoPreview" @mouseleave="endVideoPreview">
        <img v-if="asset.coverUrl" class="card-video-cover" :src="asset.coverUrl" alt="" />
        <div v-else class="card-video-poster" aria-hidden="true"><span class="card-video-poster-glow" /><Video :size="42" /><span>{{ t('视频作品') }}</span></div>
        <div ref="previewHost" class="card-video-preview" aria-hidden="true" />
        <span v-if="previewing" class="card-video-preview-badge">{{ t('静音预览') }}</span>
        <div class="card-media-overlay" :class="{ active: playing }">
          <button type="button" class="card-play-trigger-btn" :aria-label="playing ? t('暂停') : t('播放视频')" :title="playing ? t('暂停播放') : t('在播放器中观看')">
            <Pause v-if="playing" :size="24" /><Play v-else :size="24" class="play-icon-offset" />
          </button>
          <span v-if="playing" class="card-playing-indicator"><span class="playing-pulse-dot" />{{ t('正在播放器播放') }}</span>
        </div>
      </div>
      <div v-else class="card-audio-container" :class="[hasCover ? 'has-cover' : 'no-cover', { 'is-playing': playing }]" @click="openPlayer">
        <img v-if="hasCover" class="card-album-cover" :src="asset.coverUrl" :alt="t('{title}封面', { title: songTitle })" @error="coverError = true" />
        <div v-else class="card-audio-art" aria-hidden="true"><span class="card-audio-orb" /><span class="card-audio-orb secondary" /><Music2 :size="36" class="card-audio-note" /></div>
        <div class="card-media-overlay" :class="{ active: playing }">
          <button type="button" class="card-play-trigger-btn" :aria-label="playing ? t('暂停') : t('播放')" :title="playing ? t('暂停') : t('播放')">
            <Pause v-if="playing" :size="22" /><Play v-else :size="22" class="play-icon-offset" />
          </button>
          <span v-if="playing" class="card-playing-indicator music">
            <span class="card-audio-eq active" aria-hidden="true"><span class="c-eq-1" /><span class="c-eq-2" /><span class="c-eq-3" /><span class="c-eq-4" /></span>
            {{ t('播放中') }}
          </span>
          <button v-if="!asset.song?.instrumental && (asset.lyrics || asset.lrc)" type="button" class="card-open-lyrics-btn" :title="t('展开动态歌词')" @click.stop="openAudioStage">
            <Disc3 :size="13" /><span>{{ t('歌词') }}</span>
          </button>
        </div>
        <span v-if="asset.coverStatus === 'pending'" class="card-cover-pending"><LoaderCircle :size="12" class="spin" />{{ t('封面绘制中') }}</span>
      </div>
      <span class="media-badge">
        <ImageIcon v-if="asset.kind === 'image'" :size="12" /><Video v-else-if="asset.kind === 'video'" :size="12" /><Music2 v-else :size="12" />
        {{ kindLabel }}<template v-if="asset.version && asset.version > 1"> · v{{ asset.version }}</template>
      </span>
    </div>

    <div class="asset-info">
      <template v-if="asset.kind === 'image' && asset.status === 'completed'">
        <div class="image-resolution">{{ resolutionLabel }}</div>
        <div v-if="resolutionWarning" class="image-resolution-warning" role="status">{{ resolutionWarning }}</div>
      </template>

      <template v-if="asset.kind === 'music'">
        <div class="music-card-head">
          <strong class="music-card-title" :title="songTitle">{{ songTitle }}</strong>
          <div v-if="asset.song" class="music-card-tags">
            <span>{{ asset.song.instrumental ? t('纯音乐') : t('人声歌曲') }}</span>
            <span v-if="!asset.song.instrumental && asset.lrcSource === 'audio'" class="is-ready">{{ t('歌词已校准') }}</span>
            <span v-else-if="!asset.song.instrumental && asset.lrcSource === 'manual'" class="is-ready">{{ t('歌词已手动校对') }}</span>
            <span v-else-if="!asset.song.instrumental && asset.lyrics">{{ t('歌词待校准') }}</span>
            <span v-if="asset.song.style" class="is-style">{{ asset.song.style.split(/[，,]/)[0] }}</span>
          </div>
        </div>
        <p v-if="asset.song?.title && asset.prompt" class="music-card-prompt" :title="asset.prompt">{{ asset.prompt }}</p>
        <p v-if="asset.lrcError" class="lyric-alignment-error" role="alert">{{ asset.lrcError }}</p>
        <p v-if="asset.coverStatus === 'failed'" class="lyric-alignment-error" role="alert">
          {{ asset.coverError ? t('封面未完成：{error}', { error: asset.coverError }) : t('封面未完成') }}
          <button v-if="!readOnly" type="button" class="text-button" @click="emit('retry-cover', asset)">{{ t('重试') }}</button>
        </p>
        <p v-if="aligning" class="cover-status" role="status"><LoaderCircle :size="12" class="spin" />{{ t('正在校准歌词…') }}</p>
        <details v-if="asset.song" class="asset-song-details">
          <summary>{{ t('查看歌曲段落') }}</summary>
          <pre>{{ asset.lyrics || asset.song.sections.map(section => `[${section.type}] ${section.direction}`).join('\n') }}</pre>
        </details>
      </template>
      <p v-else :title="asset.prompt">{{ asset.prompt }}</p>

      <div class="asset-meta">
        <span>{{ new Date(asset.createdAt).toLocaleDateString(intlLocale(), { month: 'short', day: 'numeric' }) }} · {{ asset.kind === 'music' ? t('原创音乐') : asset.kind === 'video' ? t('动态影像') : t('灵感图像') }}</span>
        <div>
          <button v-if="asset.status === 'completed' && asset.lyrics" class="icon-button" :aria-label="t('下载 TXT 歌词')" :title="t('下载 TXT 歌词')" @click="downloadText(asset.lyrics, 'txt')"><FileText :size="15" /></button>
          <button v-if="asset.status === 'completed' && asset.kind === 'music' && asset.lrc" class="icon-button" :aria-label="t('下载 LRC 歌词')" :title="t('下载 LRC 歌词')" @click="downloadText(asset.lrc, 'lrc')"><FileText :size="15" /></button>
          <button v-if="asset.status === 'completed' && (!readOnly || url)" class="icon-button" :aria-label="t('下载作品')" :title="t('下载作品及关联文件')" @click="emit('download', asset)"><Download :size="15" /></button>
          <button v-if="asset.status === 'completed' && asset.coverUrl" class="icon-button" :aria-label="t('下载封面')" :title="t('下载封面')" @click="emit('download-cover', asset)"><ImageIcon :size="15" /></button>
          <button v-if="!readOnly && asset.kind === 'music' && asset.status === 'completed' && asset.song" class="icon-button" :aria-label="t('编辑后生成')" :title="t('编辑后生成')" @click="emit('edit', asset)"><Pencil :size="15" /></button>
          <button v-if="!readOnly && asset.kind === 'music' && asset.status === 'completed' && !asset.song?.instrumental && asset.lyrics" class="icon-button" :aria-label="t('校准歌词')" :title="t('校准歌词')" :disabled="aligning" @click="emit('align', asset)"><WandSparkles :size="15" /></button>
          <button v-if="!readOnly && asset.kind === 'music' && asset.status === 'completed' && !asset.coverUrl && asset.coverStatus !== 'failed'" class="icon-button" :aria-label="t('生成封面')" :title="t('生成封面')" :disabled="asset.coverStatus === 'pending'" @click="emit('retry-cover', asset)"><ImageIcon :size="15" /></button>
          <button v-if="!readOnly && asset.status === 'completed'" class="icon-button" :aria-label="privateWork ? t('设为公开') : t('设为私密')" :aria-pressed="privateWork" :title="privateWork ? t('设为公开') : t('设为私密')" @click="emit('visibility', asset)"><Lock v-if="privateWork" :size="15" /><Globe v-else :size="15" /></button>
          <button v-if="!readOnly" class="icon-button asset-delete" :aria-label="t('删除作品')" :title="t('删除作品')" :disabled="asset.status === 'pending'" @click="emit('delete', asset.id)"><Trash2 :size="15" /></button>
        </div>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { CircleAlert, Disc3, Download, FileText, Globe, Image as ImageIcon, LoaderCircle, Lock, Music2, Pause, Pencil, Play, RefreshCw, Trash2, Video, WandSparkles } from 'lucide-vue-next';
import ThinkingOrb from './ThinkingOrb.vue';
import type { Asset } from '../lib/types';
import { publicServiceError } from '../lib/api';
import { imageResolutionWarning, type ImageResolution } from '../lib/imageResolution';
import { intlLocale, t } from '../lib/i18n';
import {
  isPlaying, play, activeMedia, previewVideo, setExpanded, setVideoExpanded, stopVideoPreview, toggle, videoPreview,
} from '../composables/player';
import { downloadBlob } from '../composables/ui';

const props = withDefaults(defineProps<{ asset: Asset; readOnly?: boolean; aligning?: boolean }>(), { readOnly: false, aligning: false });
const emit = defineEmits<{
  retry: [asset: Asset];
  delete: [id: string];
  download: [asset: Asset];
  edit: [asset: Asset];
  align: [asset: Asset];
  'download-cover': [asset: Asset];
  'retry-cover': [asset: Asset];
  visibility: [asset: Asset];
}>();
const privateWork = computed(() => props.asset.visibility === 'private');
const loadError = ref(false);
const coverError = ref(false);
const loadedResolution = ref<ImageResolution>();
const previewHost = ref<HTMLDivElement | null>(null);
let previewTimer: ReturnType<typeof setTimeout> | undefined;
let objectURL: string | null = null;
const url = ref('');
const hasCover = computed(() => !!props.asset.coverUrl && !coverError.value);
const songTitle = computed(() => props.asset.song?.title || props.asset.prompt.slice(0, 40) || t('未命名歌曲'));
const kindLabel = computed(() => props.asset.kind === 'image' ? t('图像') : props.asset.kind === 'video' ? t('视频') : t('音乐'));
const resolution = computed(() => loadedResolution.value || (props.asset.imageWidth && props.asset.imageHeight ? { width: props.asset.imageWidth, height: props.asset.imageHeight } : undefined));
const resolutionWarning = computed(() => imageResolutionWarning(resolution.value, props.asset.options.image_size));
const resolutionLabel = computed(() => (resolution.value ? t('实际尺寸：{width} × {height} 像素', { width: resolution.value.width, height: resolution.value.height }) : t('实际尺寸：暂未读取')) + (props.asset.options.image_size ? t(' · 目标 {size}', { size: props.asset.options.image_size }) : ''));
const playing = computed(() => activeMedia.value?.id === props.asset.id && isPlaying.value);
const previewing = computed(() => props.asset.kind === 'video' && videoPreview.value?.media.id === props.asset.id);

function refreshURL() {
  if (objectURL) { URL.revokeObjectURL(objectURL); objectURL = null; }
  loadError.value = false;
  loadedResolution.value = undefined;
  coverError.value = false;
  if (props.asset.blob) {
    objectURL = URL.createObjectURL(props.asset.blob);
    url.value = objectURL;
  } else {
    url.value = props.asset.url || '';
  }
}
watch(() => [props.asset.blob, props.asset.url], refreshURL, { immediate: true });
onBeforeUnmount(() => {
  clearTimeout(previewTimer);
  if (previewing.value) stopVideoPreview();
  if (objectURL) URL.revokeObjectURL(objectURL);
});

function onImageLoad(event: Event) {
  const image = event.target as HTMLImageElement;
  loadedResolution.value = { width: image.naturalWidth, height: image.naturalHeight };
}
function beginVideoPreview() {
  if (props.asset.kind !== 'video' || !url.value) return;
  if (typeof window !== 'undefined' && !window.matchMedia('(hover: hover)').matches) return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    const host = previewHost.value;
    if (!host) return;
    previewVideo({
      id: props.asset.id,
      kind: 'video',
      src: url.value,
      title: songTitle.value,
      prompt: props.asset.prompt,
    }, host);
  }, 150);
}
function endVideoPreview() {
  clearTimeout(previewTimer);
  if (previewing.value) stopVideoPreview();
}
function openPlayer() {
  if (!url.value) return;
  if (activeMedia.value?.id === props.asset.id) { toggle(); return; }
  const media = {
    id: props.asset.id,
    kind: props.asset.kind === 'video' ? 'video' as const : 'audio' as const,
    src: url.value,
    title: props.asset.kind === 'music' ? songTitle.value : (props.asset.prompt.slice(0, 36) || (props.asset.kind === 'video' ? t('AI 视频') : t('原创音乐'))),
    prompt: props.asset.prompt,
    lrc: props.asset.lrc,
    lrcSource: props.asset.lrcSource,
    coverUrl: hasCover.value ? props.asset.coverUrl : undefined,
    lyrics: props.asset.lyrics,
    song: props.asset.song,
  };
  play(media);
  if (props.asset.kind === 'video') setVideoExpanded(true);
}
function openAudioStage() {
  if (!playing.value) openPlayer();
  setExpanded(true);
}
function downloadText(text: string | undefined, extension: string) {
  if (!text) return;
  downloadBlob(new Blob([text], { type: 'text/plain' }), `olai-music-${props.asset.id.slice(0, 8)}.${extension}`);
}
</script>
