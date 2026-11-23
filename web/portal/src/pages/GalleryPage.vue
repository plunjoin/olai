<template>
  <div class="plaza-shell">
    <PlazaRail :user="user" :short-film="status.shortFilm" />

    <div class="plaza-main">
      <header class="plaza-topbar">
        <div class="plaza-search">
          <Search :size="18" stroke-width="1.8" />
          <input v-model="search" type="search" :aria-label="t('搜索作品')" :placeholder="t('搜索作品、风格或提示词')" />
          <button v-if="search" type="button" class="plaza-search-clear" :aria-label="t('清除搜索')" @click="search = ''"><X :size="15" /></button>
        </div>
        <div class="plaza-topbar-actions">
          <RouterLink v-if="user" class="plaza-topbar-account" to="/account" :aria-label="t('我的账号 · {name}', { name: accountName })">
            <AccountAvatar :name="accountName" :avatar="user.avatar" :size="28" />
            <span>{{ accountName }}</span>
          </RouterLink>
          <RouterLink v-else class="plaza-topbar-login" to="/login">{{ t('登录') }}</RouterLink>
        </div>
      </header>

      <nav v-if="!active || !isNarrow" class="plaza-tabs" :aria-label="t('作品筛选')">
        <div class="plaza-tab-list" role="tablist">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            type="button"
            role="tab"
            :aria-selected="filter === tab.key"
            :class="{ 'is-active': filter === tab.key }"
            @click="changeFilter(tab.key)"
          >{{ tab.label }}<span v-if="tab.key === 'favorites' && favoriteTotal" class="plaza-tab-count">{{ favoriteTotal }}</span></button>
        </div>
        <form v-if="pendingFolder" class="plaza-folder-picker" @submit.prevent="saveFolder">
          <span>{{ t('收藏到') }}</span>
          <select :aria-label="t('选择收藏分类')" @change="chooseFolder(($event.target as HTMLSelectElement).value)">
            <option value="">{{ t('未分类') }}</option>
            <option v-for="folder in folders" :key="folder.id" :value="folder.id">{{ folder.name }}</option>
          </select>
          <input v-model="folderName" maxlength="24" :aria-label="t('新分类名称')" :placeholder="t('新建分类')" />
          <button type="submit">{{ t('创建') }}</button>
        </form>
        <div class="plaza-sort" role="group" :aria-label="t('作品排序')">
          <button type="button" :class="{ 'is-active': sort === 'new' }" :aria-pressed="sort === 'new'" @click="changeSort('new')"><Clock3 :size="14" />{{ t('最新') }}</button>
          <button type="button" :class="{ 'is-active': sort === 'hot' }" :aria-pressed="sort === 'hot'" @click="changeSort('hot')"><Flame :size="14" />{{ t('最热') }}</button>
        </div>
      </nav>

      <main class="plaza-content" :class="{ 'has-detail': Boolean(active) }">
        <!-- The open work is a real column in the flow, not an overlay: it
             reserves its own space at the left of the current scroll position
             while the feed continues beside it. -->
        <div v-if="active" class="plaza-detail-pane">
          <PlazaDetail
            ref="detailRef"
            :key="active.id"
            :asset="active"
            :favorite="Boolean(active.favorite)"
            :user="user"
            :source-rect="detailSource.rect"
            :source-src="detailSource.src"
            :closing="closing"
            @close="closeDetail"
            @favorite="toggleFavorite"
            @download="downloadAsset"
            @share="shareAsset"
            @report="reportTarget = $event"
            @login="goLogin"
          />
        </div>

        <div class="plaza-feed">
          <div v-if="loading && !assets.length" class="plaza-masonry plaza-skeletons" aria-busy="true" aria-live="polite">
            <div v-for="index in 16" :key="index" class="plaza-skeleton" :class="`is-${index % 4}`"><span /><i /></div>
          </div>
          <div v-else-if="visible.length" class="plaza-masonry">
            <PlazaCard
              v-for="asset in visible"
              :key="asset.id"
              :asset="asset"
              :favorite="Boolean(asset.favorite)"
              @open="openDetail"
              @favorite="toggleFavorite"
              @download="downloadAsset"
              @share="shareAsset"
              @report="reportTarget = $event"
            />
          </div>
          <div v-else-if="!active" class="plaza-empty">
            <template v-if="error && !assets.length">
              <CircleAlert :size="30" />
              <h2>{{ t('作品广场暂时走神了') }}</h2>
              <p>{{ error }}</p>
              <button type="button" class="plaza-empty-action" @click="load(0, true)">{{ t('重新加载') }}</button>
            </template>
            <template v-else-if="filter === 'favorites' && !assets.length">
              <Bookmark :size="30" />
              <h2>{{ t('还没有收藏的作品') }}</h2>
              <p>{{ t('在作品卡片右上角点一下书签，收藏会保存到你的账号。') }}</p>
              <button type="button" class="plaza-empty-action" @click="changeFilter('all')">{{ t('查看全部作品') }}</button>
            </template>
            <template v-else-if="assets.length">
              <Search :size="30" />
              <h2>{{ t('还没有匹配的作品') }}</h2>
              <p>{{ t('试试其他关键词，或切换作品类型。') }}</p>
              <button type="button" class="plaza-empty-action" @click="resetFilters">{{ t('查看全部作品') }}</button>
            </template>
            <template v-else>
              <ImageIcon :size="30" />
              <h2>{{ t('作品广场还没有作品') }}</h2>
              <p>{{ t('完成的图像、视频与音乐会出现在这里。来创作第一件吧。') }}</p>
              <div class="plaza-empty-links">
                <RouterLink to="/image">{{ t('生成图像') }}</RouterLink>
                <RouterLink to="/video">{{ t('生成视频') }}</RouterLink>
                <RouterLink to="/music">{{ t('生成音乐') }}</RouterLink>
              </div>
            </template>
          </div>

          <div ref="sentinel" class="plaza-sentinel" aria-live="polite">
            <span v-if="loadingMore"><LoaderCircle :size="15" class="spin" />{{ t('正在加载更多公开作品…') }}</span>
            <button v-else-if="error && assets.length" type="button" class="plaza-sentinel-retry" @click="loadMore">{{ t('加载失败，点击重试') }}</button>
            <span v-else-if="nextOffset === null && assets.length" class="is-end">{{ t('已经看到全部公开作品了。') }}</span>
          </div>
        </div>
      </main>
    </div>

    <GlobalPlayer />
    <GalleryReportDialog v-if="reportTarget" :asset="reportTarget" @close="reportTarget = null" />
    <div v-if="toastText" class="toast plaza-toast" role="status">
      <CircleAlert :size="17" /><span>{{ toastText }}</span>
      <button type="button" :aria-label="t('关闭通知')" @click="clearToast"><X :size="15" /></button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Bookmark, CircleAlert, Clock3, Flame, Image as ImageIcon, LoaderCircle, Search, X,
} from 'lucide-vue-next';
import PlazaRail from '../components/plaza/PlazaRail.vue';
import PlazaCard from '../components/plaza/PlazaCard.vue';
import PlazaDetail from '../components/plaza/PlazaDetail.vue';
import GalleryReportDialog from '../components/GalleryReportDialog.vue';
import GlobalPlayer from '../components/GlobalPlayer.vue';
import AccountAvatar from '../components/AccountAvatar.vue';
import { accountRequest, type Account } from '../lib/account';
import {
  getGallery, importGalleryFavorites, recordGalleryDownload, recordGalleryView, setGalleryFavorite,
  type GalleryMetrics, type GallerySort,
} from '../lib/gallery';
import { readGalleryFavorites, writeGalleryFavorites } from '../lib/galleryFavorites';
import { createFavoriteFolder, getFavoriteFolders, placeFavorite, type FavoriteFolder } from '../lib/people';
import { safeMediaURL } from '../lib/api';
import { t } from '../lib/i18n';
import { flyPlazaMedia, type PlazaMotionSource } from '../lib/plazaMotion';
import { profileDisplayName } from '../lib/profile';
import { DEFAULT_STATUS, loadStatus, type StatusState } from '../lib/status';
import type { Asset } from '../lib/types';
import { clearToast, downloadBlob, notify, toastText } from '../composables/ui';

type Filter = 'all' | 'image' | 'video' | 'music' | 'favorites';

// A shared ?work= link can point at a work past the first page, so the plaza
// walks forward this many extra pages (30 works each) before giving up.
const SHARED_WORK_PAGE_LIMIT = 10;

const bootstrap = inject<{ initialUser?: Account | null }>('bootstrap', {});
const route = useRoute();
const router = useRouter();
const assets = ref<Asset[]>([]);
const nextOffset = ref<number | null>(0);
const loading = ref(true);
const loadingMore = ref(false);
const error = ref('');
const filter = ref<Filter>('all');
const search = ref('');
const sort = ref<GallerySort>('new');
const favoriteTotal = ref(0);
const folders = ref<FavoriteFolder[]>([]);
const pendingFolder = ref<Asset | null>(null);
const folderName = ref('');
const active = ref<Asset | null>(null);
const closing = ref(false);
const detailSource = ref<{ rect: DOMRect | null; src: string }>({ rect: null, src: '' });
const reportTarget = ref<Asset | null>(null);
const user = ref<Account | null>(bootstrap?.initialUser ?? null);
const status = ref<StatusState>({ ...DEFAULT_STATUS });
const isNarrow = ref(false);
const sentinel = ref<HTMLElement | null>(null);
const detailRef = ref<{ captureMedia: () => PlazaMotionSource | null } | null>(null);
const favoriteBusy = new Set<string>();
let controller: AbortController | null = null;
let observer: IntersectionObserver | null = null;
let narrowQuery: MediaQueryList | null = null;
let closeTimer: ReturnType<typeof setTimeout> | undefined;
let querySyncing = false;
let localFavoritesImported = false;
let originButton: HTMLElement | null = null;
let savedScroll: number | null = null;
let narrowPinTimer: ReturnType<typeof setTimeout> | undefined;
let sharedLookup: { id: string; pages: number } | null = null;
const sharedLookupFailed = new Set<string>();
// The signed-in user arrives asynchronously on SPA entry; favorite actions wait
// for it so a real account is never mistaken for a guest.
let authReady: Promise<void> = Promise.resolve();
let authSettled = false;
// Guards favoriteTotal against list snapshots and responses that were computed
// before a newer toggle started.
let favoriteMutations = 0;

const accountName = computed(() => user.value ? profileDisplayName(user.value) : '');
const tabs = computed<{ key: Filter; label: string }[]>(() => [
  { key: 'all', label: t('全部') },
  { key: 'image', label: t('图像') },
  { key: 'video', label: t('视频') },
  { key: 'music', label: t('音乐') },
  { key: 'favorites', label: t('收藏') },
]);
const visible = computed(() => {
  const query = search.value.trim().toLowerCase();
  return assets.value.filter(asset => {
    if (filter.value === 'favorites' && !asset.favorite) return false;
    if (filter.value !== 'all' && filter.value !== 'favorites' && asset.kind !== filter.value) return false;
    if (!query) return true;
    const haystack = `${asset.prompt}\n${asset.song?.title ?? ''}\n${asset.song?.style ?? ''}\n${asset.author?.name ?? ''}`.toLowerCase();
    return haystack.includes(query);
  });
});
function syncNarrow() {
  isNarrow.value = narrowQuery?.matches ?? false;
}
/** Read the live media query for one-off decisions; the ref can trail a resize. */
function narrowNow() {
  return narrowQuery?.matches ?? isNarrow.value;
}
function handleViewportChange() {
  syncNarrow();
  void fillViewport();
}
/** Scroll without the page's global scroll-behavior:smooth turning it into an animation. */
function jumpScroll(top: number) {
  window.scrollTo({ top: Math.max(0, top), left: 0, behavior: 'instant' });
}
/**
 * On phones the detail replaces the feed in the same document, so hiding the
 * feed shrinks the page and the browser can clamp the old offset to the new
 * maximum. Pin the top before the swap, after Vue patches, and once more after
 * the first layout of the detail.
 */
function pinDetailTop(id: string) {
  const pin = () => {
    if (active.value?.id === id) jumpScroll(0);
  };
  // Run once before Vue swaps the feed for the detail, then again after the
  // patch and after the detail's first layout.
  jumpScroll(0);
  void nextTick().then(pin);
  clearTimeout(narrowPinTimer);
  narrowPinTimer = window.setTimeout(pin, 140);
}
function applyMetrics(asset: Asset, metrics: GalleryMetrics) {
  // Only the counters these endpoints own: favoriteCount and heat come from
  // list and favorite responses, so a slower view/download snapshot cannot
  // overwrite a newer favorite toggle.
  asset.views = metrics.views;
  asset.downloads = metrics.downloads;
}
async function load(offset: number, reset = false) {
  controller?.abort();
  const current = new AbortController();
  controller = current;
  if (reset) {
    assets.value = [];
    nextOffset.value = 0;
    loading.value = true;
    loadingMore.value = false;
  } else {
    loadingMore.value = true;
  }
  error.value = '';
  const mutationsAtStart = favoriteMutations;
  try {
    const page = await getGallery(offset, AbortSignal.any([current.signal, AbortSignal.timeout(30_000)]), 30, {
      favorites: filter.value === 'favorites', sort: sort.value,
    });
    if (current.signal.aborted) return;
    const records = page.records.map(asset => ({ ...asset, favorite: Boolean(asset.favorite) }));
    assets.value = reset
      ? records
      : [...new Map([...assets.value, ...records].map(asset => [asset.id, asset])).values()];
    nextOffset.value = page.nextOffset;
    // A snapshot taken before a favorite toggle started must not roll the
    // badge back; the toggle response owns the total from that point.
    if (mutationsAtStart === favoriteMutations) favoriteTotal.value = page.favoriteTotal;
  } catch (failure) {
    if (current.signal.aborted) return;
    if (filter.value === 'favorites' && (failure as { status?: number })?.status === 401) {
      filter.value = 'all';
      notify(t('登录后可以查看收藏的作品。'));
      void load(0, true);
      return;
    }
    error.value = t('作品广场暂时无法读取，请稍后重试。');
  } finally {
    if (controller === current) {
      loading.value = false;
      loadingMore.value = false;
    }
  }
  if (current.signal.aborted || error.value) return;
  // A shared ?work= link may point at a work past the first page. Keep paging
  // until it shows up before topping up the feed.
  if (!openFromQuery() && continueSharedWorkLookup()) return;
  void fillViewport();
}
/**
 * IntersectionObserver only fires when the sentinel crosses its margin. If the
 * first pages are short, it is already inside the margin after a load and would
 * never fire again, so keep fetching until the viewport has enough work.
 */
async function fillViewport() {
  await nextTick();
  // After a failure, wait for the reader to retry: retrying here would flood a
  // failing endpoint back-to-back and the error state would never rest.
  if (loading.value || loadingMore.value || nextOffset.value === null || error.value) return;
  const element = sentinel.value;
  // offsetParent is null while the feed is hidden behind a narrow-screen detail.
  if (element && element.offsetParent && element.getBoundingClientRect().top < window.innerHeight + 900) loadMore();
}
function loadMore() {
  if (loading.value || loadingMore.value || nextOffset.value === null) return;
  void load(nextOffset.value, false);
}
function changeSort(next: GallerySort) {
  if (sort.value === next) return;
  sort.value = next;
  void load(0, true);
}
async function changeFilter(next: Filter) {
  if (next === filter.value) return;
  if (next === 'favorites' && !user.value) {
    // On SPA entry the session check may still be in flight; wait for it
    // before treating the reader as a guest.
    if (!authSettled) await authReady;
    if (!user.value) {
      notify(t('登录后即可收藏作品，收藏会同步到你的账号。'));
      goLogin();
      return;
    }
  }
  const wasFavorites = filter.value === 'favorites';
  filter.value = next;
  if (next === 'favorites') {
    search.value = '';
    void load(0, true);
  } else if (wasFavorites) {
    void load(0, true);
  }
}
function resetFilters() {
  search.value = '';
  const wasFavorites = filter.value === 'favorites';
  filter.value = 'all';
  if (wasFavorites) void load(0, true);
}
function goLogin() {
  void router.push({ path: '/login', query: { next: route.fullPath } });
}

async function toggleFavorite(asset: Asset) {
  if (!user.value && !authSettled) await authReady;
  if (!user.value) {
    notify(t('登录后即可收藏作品，收藏会同步到你的账号。'));
    goLogin();
    return;
  }
  if (favoriteBusy.has(asset.id)) return;
  favoriteBusy.add(asset.id);
  const next = !asset.favorite;
  const previousCount = asset.favoriteCount ?? 0;
  const previousTotal = favoriteTotal.value;
  const mutation = ++favoriteMutations;
  asset.favorite = next;
  asset.favoriteCount = Math.max(0, previousCount + (next ? 1 : -1));
  favoriteTotal.value = Math.max(0, previousTotal + (next ? 1 : -1));
  try {
    const result = await setGalleryFavorite(asset.id, next);
    asset.favorite = result.favorite;
    asset.favoriteCount = result.favoriteCount;
    asset.heat = result.heat;
    if (mutation === favoriteMutations) favoriteTotal.value = result.favoriteTotal;
    if (result.favorite) { pendingFolder.value = asset; void ensureFolders(); }
    else if (pendingFolder.value?.id === asset.id) pendingFolder.value = null;
    if (filter.value === 'favorites') {
      if (!result.favorite) {
        assets.value = assets.value.filter(item => item.id !== asset.id);
        // The server's favorites list shrank by one; move the cursor back so
        // the work that shifted onto the page boundary is not skipped.
        if (nextOffset.value !== null) nextOffset.value = Math.max(0, nextOffset.value - 1);
      } else if (!assets.value.some(item => item.id === asset.id)) {
        // Re-favorited from the open detail: bring the work back to the feed.
        assets.value = [asset, ...assets.value];
      }
    }
  } catch (failure) {
    asset.favorite = !next;
    asset.favoriteCount = previousCount;
    // Restore the snapshot unless a newer toggle now owns the total.
    if (mutation === favoriteMutations) favoriteTotal.value = previousTotal;
    const statusCode = (failure as { status?: number })?.status;
    if (statusCode === 401) notify(t('登录状态已失效，请刷新页面后重新登录。'));
    else notify(failure instanceof Error ? t(failure.message) : t('收藏失败，请稍后重试。'));
  } finally {
    favoriteBusy.delete(asset.id);
  }
}
async function ensureFolders() {
  if (folders.value.length) return;
  try { folders.value = (await getFavoriteFolders()).folders; } catch { /* 分类加载失败不阻断收藏。 */ }
}
async function chooseFolder(folder: string) {
  const asset = pendingFolder.value;
  if (!asset) return;
  try {
    await placeFavorite(asset.id, folder);
    pendingFolder.value = null;
    notify(folder ? t('已放入收藏分类。') : t('已移出分类。'));
  } catch (failure) {
    notify(failure instanceof Error ? failure.message : t('收藏分类暂不可用，请稍后重试。'));
  }
}
async function saveFolder() {
  const name = folderName.value.trim();
  const asset = pendingFolder.value;
  if (!name || !asset) return;
  try {
    const created = await createFavoriteFolder(name);
    folders.value = [...folders.value, created.folder];
    folderName.value = '';
    await chooseFolder(created.folder.id);
  } catch (failure) {
    notify(failure instanceof Error ? failure.message : t('收藏分类暂不可用，请稍后重试。'));
  }
}

function cardSource(asset: Asset): string {
  if (asset.kind === 'image') return asset.thumbnail || asset.url || '';
  return asset.coverThumbnail || asset.coverUrl || asset.thumbnail || '';
}
function openDetail(asset: Asset, event?: MouseEvent) {
  clearTimeout(closeTimer);
  closing.value = false;
  const button = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  const media = button?.querySelector<HTMLElement>('[data-plaza-media]')
    ?? document.querySelector<HTMLElement>(`[data-plaza-media="${asset.id}"]`);
  const narrow = narrowNow();
  detailSource.value = {
    // A phone opens the work as a fresh page, so there is no shared-element
    // origin to fly from.
    rect: narrow ? null : media?.getBoundingClientRect() ?? null,
    src: cardSource(asset),
  };
  originButton = button ?? media?.closest<HTMLElement>('.plaza-card-open') ?? null;
  const wasOpen = Boolean(active.value);
  if (narrow) {
    savedScroll = window.scrollY;
    pinDetailTop(asset.id);
  }
  active.value = asset;
  // Opening from the grid adds a history step so browser Back closes the work;
  // jumping between works replaces the current step instead of piling up.
  syncWorkQuery(asset.id, !wasOpen);
  void recordGalleryView(asset.id).then(metrics => { if (metrics) applyMetrics(asset, metrics); });
}
/** Open the work named by ?work=… once it is present in the loaded feed. */
function openFromQuery(): boolean {
  const id = typeof route.query.work === 'string' ? route.query.work : '';
  if (!id) return false;
  if (active.value?.id === id) return true;
  if (active.value) return false;
  const asset = assets.value.find(item => item.id === id);
  if (!asset) return false;
  originButton = null;
  if (narrowNow()) {
    // A fresh link starts at the top; a lookup that paged forward keeps the
    // position the reader was already at.
    if (savedScroll === null) savedScroll = 0;
    pinDetailTop(asset.id);
  }
  detailSource.value = { rect: null, src: '' };
  active.value = asset;
  sharedLookup = null;
  void recordGalleryView(asset.id).then(metrics => { if (metrics) applyMetrics(asset, metrics); });
  return true;
}
/**
 * The shared link may point past the first page. Keep paging on the default
 * feed until the work appears, bounded so a stale link cannot walk the whole
 * gallery. Returns true when another page is already on its way.
 */
function continueSharedWorkLookup(): boolean {
  const id = typeof route.query.work === 'string' ? route.query.work : '';
  if (!id || active.value || error.value || nextOffset.value === null
    || filter.value !== 'all' || sort.value !== 'new' || search.value
    || sharedLookupFailed.has(id)) {
    sharedLookup = null;
    return false;
  }
  const pages = sharedLookup?.id === id ? sharedLookup.pages + 1 : 1;
  if (pages > SHARED_WORK_PAGE_LIMIT) {
    sharedLookup = null;
    sharedLookupFailed.add(id);
    notify(t('没有找到这件作品，可能已下架。'));
    return false;
  }
  sharedLookup = { id, pages };
  void load(nextOffset.value, false);
  return true;
}
function syncWorkQuery(id: string | null, push = false) {
  const current = typeof route.query.work === 'string' ? route.query.work : '';
  if ((id || '') === current) return;
  const query = { ...route.query };
  if (id) query.work = id;
  else delete query.work;
  querySyncing = true;
  const navigate = push ? router.push : router.replace;
  void navigate({ path: route.path, query }).catch(() => {}).finally(() => { querySyncing = false; });
}
async function closeDetail(animate = true) {
  if (!active.value || closing.value) return;
  clearTimeout(narrowPinTimer);
  const target = active.value;
  const captured = animate && !narrowNow() ? detailRef.value?.captureMedia() ?? null : null;
  closing.value = true;
  closeTimer = setTimeout(async () => {
    active.value = null;
    closing.value = false;
    detailSource.value = { rect: null, src: '' };
    syncWorkQuery(null);
    await nextTick();
    // On phones the feed comes back first; then put the reader back where
    // they were before opening the work.
    if (savedScroll !== null) {
      jumpScroll(savedScroll);
      savedScroll = null;
    }
    if (captured) {
      const media = document.querySelector<HTMLElement>(`[data-plaza-media="${target.id}"]`);
      const rect = media?.getBoundingClientRect();
      // Fly home only when the card is actually on screen. Never scroll the
      // page as part of closing: the card stays where the reader left it.
      if (rect && rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth) {
        void flyPlazaMedia(captured, { rect, radius: '14px' }, 420);
      }
    }
    const origin = originButton;
    originButton = null;
    if (origin?.isConnected) origin.focus({ preventScroll: true });
    void fillViewport();
  }, animate ? 150 : 0);
}

async function downloadAsset(asset: Asset) {
  const url = asset.url || asset.coverUrl;
  if (!url) {
    notify(t('作品暂不可下载。'));
    return;
  }
  const extension = asset.kind === 'image' ? 'png' : asset.kind === 'video' ? 'mp4' : 'mp3';
  try {
    const response = await fetch(safeMediaURL(url), { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error('download failed');
    downloadBlob(await response.blob(), `olai-${asset.kind}-${asset.id.slice(0, 8)}.${extension}`);
  } catch {
    const anchor = document.createElement('a');
    anchor.href = safeMediaURL(url);
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.download = `olai-${asset.kind}-${asset.id.slice(0, 8)}.${extension}`;
    anchor.click();
    notify(t('已打开原始媒体链接，可在新页面保存。'));
  }
  void recordGalleryDownload(asset.id).then(metrics => { if (metrics) applyMetrics(asset, metrics); });
}
async function shareAsset(asset: Asset) {
  const url = `${window.location.origin}${window.location.pathname}?work=${encodeURIComponent(asset.id)}`;
  try {
    await navigator.clipboard.writeText(url);
    notify(t('链接已复制，可以分享给朋友。'));
  } catch {
    notify(url);
  }
}
async function importLocalFavorites() {
  if (localFavoritesImported || !user.value) return;
  const local = readGalleryFavorites();
  if (!local.length) { localFavoritesImported = true; return; }
  try {
    const imported = await importGalleryFavorites(local);
    localFavoritesImported = true;
    writeGalleryFavorites([]);
    if (imported > 0) {
      notify(t('已将本机收藏同步到账号。'));
      void load(0, true);
    }
  } catch { /* Keep local bookmarks so the next visit can retry. */ }
}

watch(() => user.value?.id, id => { if (id) void importLocalFavorites(); }, { immediate: true });
watch(() => route.query.work, work => {
  if (querySyncing) return;
  const id = typeof work === 'string' ? work : '';
  if (!id) {
    if (active.value) void closeDetail(false);
    return;
  }
  if (active.value?.id === id) return;
  const asset = assets.value.find(item => item.id === id);
  if (asset) {
    if (narrowNow() && !active.value) {
      savedScroll = window.scrollY;
      pinDetailTop(asset.id);
    }
    detailSource.value = { rect: null, src: '' };
    active.value = asset;
  } else {
    // Back/forward can land on a work that is not on the current page yet;
    // page forward (bounded) until it appears, keeping the reader's place.
    if (narrowNow() && !active.value && savedScroll === null) savedScroll = window.scrollY;
    sharedLookupFailed.delete(id);
    sharedLookup = null;
    continueSharedWorkLookup();
  }
});

onMounted(async () => {
  narrowQuery = window.matchMedia('(max-width: 1099px)');
  syncNarrow();
  narrowQuery.addEventListener('change', handleViewportChange);
  window.addEventListener('resize', handleViewportChange);
  if (sentinel.value && 'IntersectionObserver' in window) {
    observer = new IntersectionObserver(entries => {
      // While an error is showing, wait for the reader's retry instead of
      // auto-fetching a failing endpoint.
      if (error.value) return;
      if (entries.some(entry => entry.isIntersecting)) loadMore();
    }, { rootMargin: '1000px 0px' });
    observer.observe(sentinel.value);
  }
  void loadStatus().then(value => { status.value = value; }).catch(() => {});
  authReady = accountRequest('me')
    .then(state => { user.value = state.user; })
    .catch(() => { /* Keep the bootstrap user; favorite actions fall back to login. */ })
    .finally(() => { authSettled = true; });
  void load(0, true);
});

onBeforeUnmount(() => {
  controller?.abort();
  observer?.disconnect();
  observer = null;
  narrowQuery?.removeEventListener('change', handleViewportChange);
  window.removeEventListener('resize', handleViewportChange);
  clearTimeout(closeTimer);
  clearTimeout(narrowPinTimer);
});
</script>
