<template>
  <article
    ref="articleRef"
    class="plaza-detail"
    :class="{ 'is-closing': closing }"
    tabindex="-1"
    :aria-label="t('{kind}作品详情：{title}', { kind: kindLabel, title })"
  >
    <section class="plaza-detail-stage-wrap" :aria-label="t('作品展示')">
      <div ref="stageRef" class="plaza-detail-stage" :class="`is-${asset.kind}`">
        <template v-if="asset.kind === 'image'">
          <img
            v-if="thumbSrc"
            class="plaza-detail-image is-thumb"
            :class="{ 'is-hidden': imageLoaded || imageFailed }"
            :src="thumbSrc"
            alt=""
            aria-hidden="true"
            draggable="false"
          />
          <img
            v-if="fullSrc && !imageFailed"
            ref="stageImageRef"
            class="plaza-detail-image is-full"
            :class="{ 'is-loaded': imageLoaded }"
            :src="fullSrc"
            :alt="title"
            draggable="false"
            @load="imageLoaded = true"
            @error="imageFailed = true"
          />
          <div v-if="!fullSrc || imageFailed" class="plaza-detail-missing">
            <ImageIcon :size="30" />
            <strong>{{ t('图片暂不可用') }}</strong>
          </div>
        </template>

        <template v-else-if="asset.kind === 'video'">
          <video
            v-if="asset.url"
            class="plaza-detail-video"
            :src="asset.url"
            :poster="asset.coverUrl || ''"
            controls
            playsinline
            preload="metadata"
          />
          <div v-else class="plaza-detail-missing">
            <Video :size="30" />
            <strong>{{ t('视频暂不可用') }}</strong>
          </div>
        </template>

        <template v-else>
          <div class="plaza-detail-music">
            <div class="plaza-detail-cover">
              <img v-if="(fullSrc || thumbSrc) && !imageFailed" :src="fullSrc || thumbSrc" :alt="t('{title}封面', { title })" @error="imageFailed = true" />
              <div v-else class="plaza-detail-cover-fallback"><Music2 :size="52" /><span>{{ title }}</span></div>
              <button
                type="button"
                class="plaza-detail-play"
                :disabled="!asset.url"
                :aria-label="playing ? t('暂停') : t('播放')"
                @click="toggleMusic"
              >
                <Pause v-if="playing" :size="24" /><Play v-else :size="24" class="play-icon-offset" />
              </button>
            </div>
            <strong>{{ asset.song?.title || title }}</strong>
            <span>{{ asset.song?.style || t('原创音乐') }}</span>
          </div>
        </template>

        <div class="plaza-detail-stage-actions">
          <button type="button" :aria-label="t('复制链接')" :title="t('复制链接')" @click="emit('share', asset)">
            <Link2 :size="16" />
          </button>
          <button v-if="asset.kind === 'image' && fullSrc" type="button" :aria-label="t('查看大图')" :title="t('查看大图')" @click="lightbox = true">
            <Maximize2 :size="16" />
          </button>
        </div>
        <button type="button" class="plaza-detail-back" :aria-label="t('返回作品广场')" :title="t('返回作品广场')" @click="requestClose">
          <ArrowLeft :size="19" />
        </button>
      </div>
    </section>

    <aside class="plaza-detail-side">
      <div class="plaza-detail-actions">
        <button
          type="button"
          class="plaza-detail-action"
          :class="{ 'is-active': favorite }"
          :aria-label="favorite ? t('取消收藏') : t('收藏作品')"
          :aria-pressed="favorite"
          @click="emit('favorite', asset)"
        >
          <Heart :size="18" :fill="favorite ? 'currentColor' : 'none'" /><span>{{ compactCount(asset.favoriteCount) }}</span>
        </button>
        <button type="button" class="plaza-detail-action" :aria-label="t('查看评论')" @click="scrollToComments">
          <MessageCircle :size="18" /><span>{{ compactCount(commentTotal) }}</span>
        </button>
        <button type="button" class="plaza-detail-action" :aria-label="t('分享作品')" :title="t('分享作品')" @click="emit('share', asset)">
          <Share2 :size="18" />
        </button>
        <div class="plaza-detail-more-wrap">
          <button type="button" class="plaza-detail-action" :aria-label="t('更多操作')" :aria-expanded="moreOpen" @click.stop="toggleMore">
            <Ellipsis :size="18" />
          </button>
          <div v-if="moreOpen" class="plaza-card-menu is-detail" role="menu" @click.stop>
            <button type="button" role="menuitem" @click="moreAction('download')"><Download :size="14" />{{ t('下载作品') }}</button>
            <button type="button" role="menuitem" @click="moreAction('share')"><Link2 :size="14" />{{ t('复制链接') }}</button>
            <button type="button" role="menuitem" class="is-danger" @click="moreAction('report')"><Flag :size="14" />{{ t('举报作品') }}</button>
          </div>
        </div>
        <span class="plaza-detail-actions-spacer" />
        <span class="plaza-detail-kind">
          <ImageIcon v-if="asset.kind === 'image'" :size="13" />
          <Video v-else-if="asset.kind === 'video'" :size="13" />
          <Music2 v-else :size="13" />
          {{ kindLabel }}
        </span>
      </div>

      <div class="plaza-detail-author">
        <AccountAvatar :name="authorName" :avatar="asset.author?.avatar" :size="32" />
        <div>
          <strong>{{ authorName }}</strong>
          <span>{{ t('发布于 {date}', { date: publishedAt }) }}</span>
        </div>
      </div>

      <div ref="scrollRef" class="plaza-detail-scroll">
        <h1>{{ title }}</h1>
        <section v-if="asset.prompt" class="plaza-detail-prompt-block" :aria-label="t('提示词')">
          <header class="plaza-detail-section-head">
            <h2>{{ t('提示词') }}</h2>
            <button
              type="button"
              class="plaza-detail-copy"
              :class="{ 'is-copied': copyState === 'copied', 'is-failed': copyState === 'failed' }"
              :aria-label="t('复制提示词')"
              @click="copyPrompt"
            >
              <Check v-if="copyState === 'copied'" :size="13" />
              <Copy v-else :size="13" />
              {{ copyState === 'copied' ? t('已复制') : copyState === 'failed' ? t('复制失败') : t('复制') }}
            </button>
          </header>
          <p class="plaza-detail-prompt" :class="{ 'is-expanded': promptExpanded }">{{ asset.prompt }}</p>
          <button v-if="promptLong" type="button" class="plaza-detail-prompt-toggle" @click="promptExpanded = !promptExpanded">
            {{ promptExpanded ? t('收起') : t('展开全部') }}
          </button>
        </section>

        <section class="plaza-detail-params" :aria-label="t('作品参数')">
          <header class="plaza-detail-section-head"><h2>{{ t('作品参数') }}</h2></header>
          <dl>
            <div v-for="parameter in parameters" :key="parameter.label">
              <dt>{{ parameter.label }}</dt>
              <dd>{{ parameter.value }}</dd>
            </div>
          </dl>
        </section>

        <div class="plaza-detail-stats">
          <span><Eye :size="14" />{{ compactCount(asset.views) }}</span>
          <span><Download :size="14" />{{ compactCount(asset.downloads) }}</span>
          <span><Bookmark :size="14" />{{ compactCount(asset.favoriteCount) }}</span>
        </div>

        <section ref="commentsRef" class="plaza-detail-comments" :aria-label="t('评论')">
          <header class="plaza-detail-comments-head">
            <h2>{{ t('评论') }}<span v-if="commentTotal">{{ commentTotal }}</span></h2>
            <span v-if="commentsLoading" class="plaza-detail-comments-loading">{{ t('正在加载评论…') }}</span>
          </header>

          <div v-if="commentsError" class="plaza-detail-comments-state">
            <span>{{ commentsError }}</span>
            <button type="button" @click="loadComments(0)">{{ t('重试') }}</button>
          </div>
          <div v-else-if="commentsLoading && !comments.length" class="plaza-comment-skeletons" aria-hidden="true">
            <div v-for="index in 2" :key="index" class="plaza-comment-skeleton"><i /><span><b /><em /></span></div>
          </div>
          <div v-else-if="!comments.length" class="plaza-detail-comments-state is-empty">
            <MessageCircle :size="22" />
            <span>{{ t('还没有评论，来留下第一句吧。') }}</span>
          </div>
          <div v-else class="plaza-comment-list">
            <article v-for="comment in comments" :key="comment.id" class="plaza-comment">
              <AccountAvatar :name="comment.author.name" :avatar="comment.author.avatar" :size="30" />
              <div>
                <header><strong>{{ comment.author.name }}</strong><time :datetime="new Date(comment.createdAt).toISOString()">{{ relativeTime(comment.createdAt) }}</time></header>
                <p>{{ comment.body }}</p>
              </div>
            </article>
            <button v-if="commentsNext !== null" type="button" class="plaza-comment-more" :disabled="commentsLoading" @click="loadComments(commentsNext, true)">
              {{ commentsLoading ? t('正在加载评论…') : t('加载更多评论') }}
            </button>
          </div>
        </section>
      </div>

      <footer class="plaza-detail-composer">
        <template v-if="user">
          <AccountAvatar :name="userName" :avatar="user.avatar" :size="26" />
          <div class="plaza-detail-composer-box">
            <textarea
              v-model="commentDraft"
              rows="1"
              maxlength="500"
              :placeholder="t('添加评论…')"
              :aria-label="t('添加评论')"
              @keydown.enter.exact="onComposerEnter"
            />
            <button type="button" class="plaza-detail-send" :disabled="!canComment" :aria-label="t('发送评论')" :title="t('发送评论')" @click="submitComment">
              <LoaderCircle v-if="commentBusy" :size="16" class="spin" /><Send v-else :size="16" />
            </button>
          </div>
        </template>
        <template v-else>
          <div class="plaza-detail-login">
            <span>{{ t('登录后参与评论') }}</span>
            <button type="button" @click="emit('login')">{{ t('去登录') }}</button>
          </div>
        </template>
      </footer>
    </aside>

    <Teleport to="body">
      <div v-if="lightbox" class="plaza-lightbox" role="dialog" aria-modal="true" :aria-label="t('查看大图')" @click.self="lightbox = false">
        <button type="button" class="plaza-lightbox-close" :aria-label="t('关闭')" @click="lightbox = false"><X :size="20" /></button>
        <img v-if="fullSrc" :src="fullSrc" :alt="title" />
      </div>
    </Teleport>
  </article>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  ArrowLeft, Bookmark, Check, Copy, Download, Ellipsis, Eye, Flag, Heart, Image as ImageIcon, Link2, LoaderCircle,
  Maximize2, MessageCircle, Music2, Pause, Play, Send, Share2, Video, X,
} from 'lucide-vue-next';
import AccountAvatar from '../AccountAvatar.vue';
import {
  getGalleryComments, postGalleryComment, type GalleryCommentsPage,
} from '../../lib/gallery';
import { galleryKindLabel, galleryParameters, galleryPublishedAt, galleryTitle } from '../../lib/galleryDetail';
import { intlLocale, t } from '../../lib/i18n';
import { containedMediaRect, flyPlazaMedia, mediaRatio, type PlazaMotionSource } from '../../lib/plazaMotion';
import type { Account } from '../../lib/account';
import type { Asset, GalleryComment } from '../../lib/types';
import { notify } from '../../composables/ui';
import { activeMedia, isPlaying, play, toggle } from '../../composables/player';

const props = withDefaults(defineProps<{
  asset: Asset;
  favorite?: boolean;
  user?: Account | null;
  sourceRect?: DOMRect | null;
  sourceSrc?: string;
  closing?: boolean;
}>(), {
  favorite: false,
  user: null,
  sourceRect: null,
  sourceSrc: '',
  closing: false,
});
const emit = defineEmits<{
  close: [];
  favorite: [asset: Asset];
  download: [asset: Asset];
  share: [asset: Asset];
  report: [asset: Asset];
  login: [];
}>();

const articleRef = ref<HTMLElement | null>(null);
const stageRef = ref<HTMLElement | null>(null);
const stageImageRef = ref<HTMLImageElement | null>(null);
const scrollRef = ref<HTMLElement | null>(null);
const commentsRef = ref<HTMLElement | null>(null);
const imageLoaded = ref(false);
const imageFailed = ref(false);
const promptExpanded = ref(false);
const copyState = ref<'idle' | 'copied' | 'failed'>('idle');
let copyTimer: number | undefined;
const lightbox = ref(false);
const moreOpen = ref(false);
const comments = ref<GalleryComment[]>([]);
const commentTotal = ref(0);
const commentsNext = ref<number | null>(null);
const commentsLoading = ref(false);
const commentsError = ref('');
const commentDraft = ref('');
const commentBusy = ref(false);
let commentsController: AbortController | null = null;

const title = computed(() => galleryTitle(props.asset));
const kindLabel = computed(() => galleryKindLabel(props.asset.kind));
const publishedAt = computed(() => galleryPublishedAt(props.asset.createdAt));
const authorName = computed(() => props.asset.author?.name || t('Olai 社区'));
const userName = computed(() => {
  const user = props.user;
  if (!user) return '';
  return (user.name || '').trim() || user.email.split('@')[0] || t('Olai 用户');
});
const thumbSrc = computed(() => {
  const asset = props.asset;
  if (asset.kind === 'music') return asset.coverThumbnail || asset.coverUrl || '';
  return asset.thumbnail || '';
});
const fullSrc = computed(() => {
  const asset = props.asset;
  if (asset.kind === 'music') return asset.coverUrl || '';
  if (asset.kind === 'video') return asset.coverUrl || asset.coverThumbnail || '';
  return asset.url || asset.thumbnail || '';
});
const ratio = computed(() => {
  if (props.asset.kind !== 'image') return 1;
  return mediaRatio(props.asset.imageWidth, props.asset.imageHeight);
});
const promptLong = computed(() => (props.asset.prompt || '').length > 260);
const parameters = computed(() => galleryParameters(props.asset));
const playing = computed(() => activeMedia.value?.id === props.asset.id && isPlaying.value);
const canComment = computed(() => !commentBusy.value && commentDraft.value.trim().length > 0 && commentDraft.value.trim().length <= 500);

function compactCount(value: number | undefined): string {
  if (!value || !Number.isFinite(value)) return '0';
  try { return new Intl.NumberFormat(intlLocale(), { notation: 'compact', maximumFractionDigits: 1 }).format(value); }
  catch { return String(Math.round(value)); }
}
function relativeTime(timestamp: number): string {
  const then = Number(timestamp);
  if (!Number.isFinite(then)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return t('刚刚');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('{n} 分钟前', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('{n} 小时前', { n: hours });
  const days = Math.round(hours / 24);
  if (days < 7) return t('{n} 天前', { n: days });
  return new Date(then).toLocaleDateString(intlLocale(), { month: 'short', day: 'numeric' });
}

async function loadComments(offset = 0, append = false) {
  commentsController?.abort();
  const controller = new AbortController();
  commentsController = controller;
  commentsLoading.value = true;
  commentsError.value = '';
  try {
    const page: GalleryCommentsPage = await getGalleryComments(props.asset.id, offset, 20, controller.signal);
    if (controller.signal.aborted) return;
    if (append) {
      // Posting a comment shifts the server's offset pages; skip anything the
      // next page repeats instead of rendering it twice.
      const seen = new Set(comments.value.map(comment => comment.id));
      comments.value = [...comments.value, ...page.comments.filter(comment => !seen.has(comment.id))];
    } else {
      comments.value = page.comments;
    }
    commentTotal.value = page.total;
    commentsNext.value = page.nextOffset;
  } catch (failure) {
    if (controller.signal.aborted) return;
    commentsError.value = failure instanceof Error ? t(failure.message) : t('评论加载失败，请稍后重试。');
  } finally {
    if (commentsController === controller) commentsLoading.value = false;
  }
}

/** Enter or Escape pressed while an IME is composing belongs to the IME. */
function compositionKey(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}
function onComposerEnter(event: KeyboardEvent) {
  if (compositionKey(event)) return;
  event.preventDefault();
  void submitComment();
}

async function submitComment() {
  if (!props.user || !canComment.value) return;
  commentBusy.value = true;
  const body = commentDraft.value.trim();
  try {
    const result = await postGalleryComment(props.asset.id, body);
    comments.value = [result.comment, ...comments.value];
    commentTotal.value = result.total;
    // The new comment is now first on the server, so every later page starts
    // one row further down.
    if (commentsNext.value !== null) commentsNext.value += 1;
    commentDraft.value = '';
    notify(t('评论已发布。'));
    await nextTick();
    scrollToComments();
  } catch (failure) {
    const status = (failure as { status?: number })?.status;
    if (status === 401) notify(t('登录状态已失效，请重新登录。'));
    else notify(failure instanceof Error ? t(failure.message) : t('评论发布失败，请稍后重试。'));
  } finally {
    commentBusy.value = false;
  }
}

function scrollToComments() {
  commentsRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Async clipboard first; browsers that deny it can still copy via a selection. */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* Fall through to the selection-based fallback. */ }
  const active = document.activeElement as HTMLElement | null;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try { copied = document.execCommand('copy'); } catch { copied = false; }
  textarea.remove();
  active?.focus?.({ preventScroll: true });
  return copied;
}

async function copyPrompt() {
  window.clearTimeout(copyTimer);
  copyState.value = (await writeClipboard(props.asset.prompt || '')) ? 'copied' : 'failed';
  copyTimer = window.setTimeout(() => { copyState.value = 'idle'; }, 2000);
}

function toggleMusic() {
  const asset = props.asset;
  if (!asset.url) return;
  if (activeMedia.value?.id === asset.id) { toggle(); return; }
  play({
    id: asset.id,
    kind: 'audio',
    src: asset.url,
    title: title.value,
    prompt: asset.prompt,
    lrc: asset.lrc,
    lrcSource: asset.lrcSource,
    coverUrl: asset.coverUrl,
    lyrics: asset.lyrics,
    song: asset.song,
  });
}

function requestClose() {
  emit('close');
}
function toggleMore(event: MouseEvent) {
  event.stopPropagation();
  moreOpen.value = !moreOpen.value;
}
function closeMore() { moreOpen.value = false; }
function moreAction(action: 'download' | 'share' | 'report') {
  moreOpen.value = false;
  if (action === 'download') emit('download', props.asset);
  else if (action === 'share') emit('share', props.asset);
  else emit('report', props.asset);
}

function motionTarget(): DOMRect | null {
  const stage = stageRef.value;
  if (!stage) return null;
  if (props.asset.kind === 'image') return containedMediaRect(stage, ratio.value);
  if (props.asset.kind === 'video') {
    return stage.querySelector('video')?.getBoundingClientRect() ?? stage.getBoundingClientRect();
  }
  return stage.querySelector('.plaza-detail-cover')?.getBoundingClientRect() ?? stage.getBoundingClientRect();
}

/** The card-sized picture currently in the stage, used to fly home on close. */
function captureMedia(): PlazaMotionSource | null {
  const rect = motionTarget();
  const src = fullSrc.value || thumbSrc.value;
  if (!rect || !src) return null;
  return { src, rect, radius: props.asset.kind === 'image' ? '12px' : '18px' };
}
defineExpose({ captureMedia });

function onKeydown(event: KeyboardEvent) {
  // Escape also cancels IME candidates; keyboard handling must leave it alone.
  if (compositionKey(event)) return;
  if (event.key !== 'Escape') return;
  if (lightbox.value) { event.preventDefault(); lightbox.value = false; return; }
  if (moreOpen.value) { event.preventDefault(); moreOpen.value = false; return; }
  event.preventDefault();
  requestClose();
}
function onDocumentClick() { closeMore(); }

watch(() => props.asset.id, () => {
  imageLoaded.value = false;
  imageFailed.value = false;
  promptExpanded.value = false;
  copyState.value = 'idle';
  lightbox.value = false;
  moreOpen.value = false;
  comments.value = [];
  commentTotal.value = 0;
  commentsNext.value = null;
  commentDraft.value = '';
  void loadComments(0);
});
watch(moreOpen, open => {
  if (open) window.setTimeout(() => document.addEventListener('click', onDocumentClick), 0);
  else document.removeEventListener('click', onDocumentClick);
});

onMounted(async () => {
  window.addEventListener('keydown', onKeydown);
  void loadComments(0);
  await nextTick();
  // Move keyboard focus into the floating panel; preventScroll keeps the feed
  // exactly where the reader left it.
  articleRef.value?.focus({ preventScroll: true });
  if (props.sourceRect && props.sourceSrc) {
    const target = motionTarget();
    if (target) {
      void flyPlazaMedia(
        { src: props.sourceSrc, rect: props.sourceRect, radius: '14px' },
        { rect: target, radius: '12px' },
        520,
      );
    }
  }
});
onBeforeUnmount(() => {
  commentsController?.abort();
  window.clearTimeout(copyTimer);
  document.removeEventListener('click', onDocumentClick);
  window.removeEventListener('keydown', onKeydown);
});
</script>
