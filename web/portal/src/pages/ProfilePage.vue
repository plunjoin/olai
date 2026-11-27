<template>
  <div class="plaza-shell profile-shell">
    <PlazaRail :user="me" :short-film="shortFilm" />
    <div class="plaza-main">
      <header class="profile-bar">
        <RouterLink to="/" class="profile-back"><ArrowLeft :size="16" />{{ t('作品广场') }}</RouterLink>
        <RouterLink v-if="me" to="/messages" class="profile-messages">{{ t('私信') }}</RouterLink>
        <RouterLink v-else to="/login" class="profile-messages">{{ t('登录') }}</RouterLink>
      </header>

      <main class="profile-main">
        <p v-if="loading" class="profile-status">{{ t('正在打开主页…') }}</p>
        <div v-else-if="error" class="profile-status" role="alert">
          <p>{{ error }}</p>
          <button type="button" class="secondary-button" @click="load">{{ t('重新加载') }}</button>
        </div>

        <template v-else-if="profile">
          <section class="profile-hero">
            <div class="profile-banner" :style="bannerStyle" aria-hidden="true" />
            <div class="profile-hero-body">
              <div class="profile-hero-avatar">
                <AccountAvatar :name="profile.name" :avatar="profile.avatar" :size="112" />
              </div>

              <div class="profile-identity">
                <h1 class="profile-name">{{ profile.name }}</h1>
                <p class="profile-handle">@{{ profile.id }}</p>
                <p v-if="profile.bio" class="profile-bio">{{ profile.bio }}</p>
                <p v-if="profile.website" class="profile-website"><a :href="profile.website" rel="noreferrer noopener">{{ profile.website }}</a></p>
                <p v-if="profile.joinedAt" class="profile-joined">{{ t('加入于 {date}', { date: joined }) }}</p>
              </div>

              <div class="profile-hero-side">
                <dl class="profile-stats">
                  <div class="profile-stat">
                    <dd>{{ profile.plays ?? 0 }}</dd>
                    <dt>{{ t('播放量') }}</dt>
                  </div>
                  <div class="profile-stat">
                    <dd>{{ profile.likes ?? 0 }}</dd>
                    <dt>{{ t('点赞数') }}</dt>
                  </div>
                  <div class="profile-stat">
                    <dd>{{ profile.followers ?? 0 }}</dd>
                    <dt>{{ t('关注者') }}</dt>
                  </div>
                  <div class="profile-stat">
                    <dd>{{ profile.following ?? 0 }}</dd>
                    <dt>{{ t('正在关注') }}</dt>
                  </div>
                </dl>

                <div class="profile-actions">
                  <RouterLink v-if="profile.self" to="/account" class="primary-button">{{ t('编辑资料与隐私') }}</RouterLink>
                  <template v-else-if="me">
                    <button type="button" class="primary-button" :class="{ 'is-following': profile.followingUser }" :disabled="busy" @click="toggleFollow">
                      {{ profile.followingUser ? t('已关注') : t('关注') }}
                    </button>
                    <RouterLink v-if="profile.canMessage" class="outline-button" :to="`/messages/${profile.id}`">{{ t('私信') }}</RouterLink>
                    <button type="button" class="text-button" :disabled="busy" @click="toggleBlock">
                      {{ profile.blocked ? t('取消拉黑') : t('拉黑') }}
                    </button>
                  </template>
                  <template v-else>
                    <RouterLink :to="`/login?next=${encodeURIComponent('/u/' + profile.id)}`" class="primary-button">{{ t('登录后关注') }}</RouterLink>
                    <button type="button" class="outline-button" @click="shareProfile">{{ t('分享主页') }}</button>
                  </template>
                </div>
              </div>
            </div>
          </section>

          <div class="plaza-content" :class="{ 'has-detail': Boolean(active) }">
            <div v-if="active" class="plaza-detail-pane">
              <PlazaDetail
                ref="detailRef"
                :key="active.id"
                :asset="active"
                :favorite="Boolean(active.favorite)"
                :user="me"
                :source-rect="detailSource.rect"
                :source-src="detailSource.src"
                :closing="closing"
                :back-label="t('返回个人主页')"
                @close="closeDetail"
                @favorite="toggleFavorite"
                @download="downloadWork"
                @share="shareWork"
                @tag="searchTag"
                @login="goLogin"
              />
            </div>

            <div class="profile-content">
              <p v-if="notice" class="profile-notice" role="status">{{ notice }}</p>

              <nav v-if="profile.works || profile.favorites" class="profile-tabs" role="tablist" :aria-label="t('主页内容')">
                <button v-if="profile.works" type="button" role="tab" :aria-selected="tab === 'works'" :class="{ 'is-active': tab === 'works' }" @click="tab = 'works'">
                  {{ t('作品') }}<span class="profile-tab-count">{{ profile.workCount ?? 0 }}</span>
                </button>
                <button v-if="profile.favorites" type="button" role="tab" :aria-selected="tab === 'favorites'" :class="{ 'is-active': tab === 'favorites' }" @click="tab = 'favorites'">
                  {{ t('收藏') }}<span class="profile-tab-count">{{ profile.favoriteCount ?? 0 }}</span>
                </button>
              </nav>

              <div v-if="worksLoading" class="profile-status">{{ t('正在加载作品…') }}</div>
              <div v-else-if="visible.length" class="plaza-masonry">
                <PlazaCard
                  v-for="asset in visible"
                  :key="asset.id"
                  :asset="asset"
                  :favorite="Boolean(asset.favorite)"
                  @open="openWork"
                  @favorite="toggleFavorite"
                  @download="downloadWork"
                  @share="shareWork"
                  @tag="searchTag"
                />
              </div>
              <div v-else-if="profile.works || profile.favorites" class="profile-empty">
                <UserRound :size="58" aria-hidden="true" />
                <h2>{{ tab === 'favorites' ? t('还没有公开的收藏') : t('还没有公开的作品') }}</h2>
                <p>{{ tab === 'favorites' ? t('这位用户还没有公开的收藏。') : t('这位用户还没有公开的作品。') }}</p>
              </div>
              <div v-else class="profile-empty">
                <UserRound :size="58" aria-hidden="true" />
                <h2>{{ t('这位用户暂未公开主页内容。') }}</h2>
                <p>{{ t('公开作品或收藏后就会显示在这里。') }}</p>
              </div>
            </div>
          </div>
        </template>
      </main>
    </div>
    <ShareDialog v-if="shareTarget" :asset="shareTarget" :signed-in="Boolean(me)" @close="shareTarget = null" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft, UserRound } from 'lucide-vue-next';
import AccountAvatar from '../components/AccountAvatar.vue';
import ShareDialog from '../components/ShareDialog.vue';
import PlazaCard from '../components/plaza/PlazaCard.vue';
import PlazaDetail from '../components/plaza/PlazaDetail.vue';
import PlazaRail from '../components/plaza/PlazaRail.vue';
import { accountRequest, type Account } from '../lib/account';
import { setGalleryFavorite } from '../lib/gallery';
import { intlLocale, t } from '../lib/i18n';
import { getProfileFavorites, getProfileWorks, getPublicProfile, setBlocked, setFollow, type PublicProfile } from '../lib/people';
import { avatarTheme, bannerTheme, uploadedBannerURL } from '../lib/profile';
import { flyPlazaMedia, type PlazaMotionSource } from '../lib/plazaMotion';
import type { Asset } from '../lib/types';

const route = useRoute();
const router = useRouter();
const me = ref<Account | null>(null);
const shortFilm = ref(false);
const profile = ref<PublicProfile | null>(null);
const works = ref<Asset[]>([]);
const favorites = ref<Asset[]>([]);
const tab = ref<'works' | 'favorites'>('works');
const loading = ref(true);
const worksLoading = ref(false);
const busy = ref(false);
const error = ref('');
const notice = ref('');
const shareTarget = ref<Asset | null>(null);
// The open work lives in this page, not on the plaza: the detail's own back
// button closes it and the reader lands back on the profile, not the home.
const active = ref<Asset | null>(null);
const closing = ref(false);
const detailSource = ref<{ rect: DOMRect | null; src: string }>({ rect: null, src: '' });
const detailRef = ref<{ captureMedia: () => PlazaMotionSource | null } | null>(null);
let closeTimer: ReturnType<typeof setTimeout> | undefined;
let querySyncing = false;

const handle = computed(() => String(route.params.handle || ''));
const visible = computed(() => tab.value === 'favorites' ? favorites.value : works.value);
const joined = computed(() => profile.value?.joinedAt ? new Date(profile.value.joinedAt).toLocaleDateString(intlLocale(), { year: 'numeric', month: 'long' }) : '');
// The cover is the owner's choice: an uploaded picture, or one of the preset
// tones. Without one the band borrows the avatar's theme, and finally falls
// back to a muted paper tone picked by the handle, so it never looks empty.
const bannerStyle = computed(() => {
  const uploaded = uploadedBannerURL(profile.value?.banner);
  if (uploaded) return { backgroundImage: `url("${uploaded}")` };
  const theme = bannerTheme(profile.value?.banner);
  if (theme) return { backgroundImage: theme.background };
  const avatar = avatarTheme(profile.value?.avatar);
  if (avatar) return { backgroundImage: avatar.background };
  const id = profile.value?.id || '';
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  return { backgroundImage: BANNER_TONES[hash % BANNER_TONES.length] };
});
const BANNER_TONES = [
  'linear-gradient(135deg, #e8e4dc 0%, #dcd5c8 100%)',
  'linear-gradient(135deg, #e3e8ee 0%, #d1d9e3 100%)',
  'linear-gradient(135deg, #e5ebe3 0%, #d3dbcd 100%)',
  'linear-gradient(135deg, #ece5ea 0%, #dbd2db 100%)',
  'linear-gradient(135deg, #eae6e0 0%, #dad2c5 100%)',
  'linear-gradient(135deg, #e4e2ea 0%, #d2cfdd 100%)',
];

async function load() {
  loading.value = true;
  error.value = '';
  profile.value = null;
  try {
    const result = await getPublicProfile(handle.value);
    profile.value = result.profile;
    tab.value = result.profile.works ? 'works' : 'favorites';
    await loadTab();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('个人主页暂不可用，请稍后重试。');
  } finally {
    loading.value = false;
  }
}

async function loadTab() {
  if (!profile.value) return;
  worksLoading.value = true;
  try {
    if (tab.value === 'favorites' && profile.value.favorites) {
      favorites.value = (await getProfileFavorites(profile.value.id)).records;
    } else if (profile.value.works) {
      works.value = (await getProfileWorks(profile.value.id)).records;
    }
  } catch (cause) {
    notice.value = cause instanceof Error ? cause.message : t('作品暂时无法加载。');
  } finally {
    worksLoading.value = false;
  }
  // A shared ?work= link may name a work that only arrives with this list.
  openFromQuery();
}

async function toggleFollow() {
  if (!profile.value || busy.value) return;
  busy.value = true;
  notice.value = '';
  try {
    const next = !profile.value.followingUser;
    const result = await setFollow(profile.value.id, next);
    profile.value = { ...profile.value, followingUser: result.following, followers: result.followers };
  } catch (cause) {
    notice.value = cause instanceof Error ? cause.message : t('关注暂不可用，请稍后重试。');
  } finally {
    busy.value = false;
  }
}

async function toggleBlock() {
  if (!profile.value || busy.value) return;
  busy.value = true;
  notice.value = '';
  try {
    const result = await setBlocked(profile.value.id, !profile.value.blocked);
    profile.value = { ...profile.value, blocked: result.blocked, followingUser: result.blocked ? false : profile.value.followingUser };
  } catch (cause) {
    notice.value = cause instanceof Error ? cause.message : t('操作失败，请稍后重试。');
  } finally {
    busy.value = false;
  }
}

function openWork(asset: Asset, event?: MouseEvent) {
  clearTimeout(closeTimer);
  closing.value = false;
  const button = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  const media = button?.querySelector<HTMLElement>('[data-plaza-media]')
    ?? document.querySelector<HTMLElement>(`[data-plaza-media="${asset.id}"]`);
  detailSource.value = {
    rect: media?.getBoundingClientRect() ?? null,
    src: asset.thumbnail || asset.url || '',
  };
  active.value = asset;
  // The work opens on this page: the detail's back button closes it again.
  syncWorkQuery(asset.id, true);
}
/** Keeps the open work in the URL so browser Back closes it too. */
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
/** Closing the detail returns to the profile page, never to the home page. */
function closeDetail(animate = true) {
  if (!active.value || closing.value) return;
  const target = active.value;
  const captured = animate ? detailRef.value?.captureMedia() ?? null : null;
  closing.value = true;
  closeTimer = setTimeout(async () => {
    active.value = null;
    closing.value = false;
    detailSource.value = { rect: null, src: '' };
    syncWorkQuery(null);
    await nextTick();
    if (captured) {
      const media = document.querySelector<HTMLElement>(`[data-plaza-media="${target.id}"]`);
      const rect = media?.getBoundingClientRect();
      // Fly home only when the card is on screen; never scroll as part of it.
      if (rect && rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth) {
        void flyPlazaMedia(captured, { rect, radius: '14px' }, 420);
      }
    }
  }, animate ? 150 : 0);
}
/** Opens the work named by ?work=… once it is present in the loaded grid. */
function openFromQuery() {
  const id = typeof route.query.work === 'string' ? route.query.work : '';
  if (!id || active.value?.id === id) return;
  const asset = visible.value.find(item => item.id === id);
  if (!asset) return;
  detailSource.value = { rect: null, src: '' };
  active.value = asset;
}
function goLogin() {
  router.push(`/login?next=${encodeURIComponent(route.fullPath)}`);
}
function searchTag(tag: string) {
  router.push({ path: '/', query: { tag } });
}
function downloadWork(asset: Asset) {
  if (asset.url) window.open(asset.url, '_blank', 'noopener');
}
function shareWork(asset: Asset) {
  shareTarget.value = asset;
}
/** Shares the profile page itself rather than one of its works. */
async function shareProfile() {
  const url = `${window.location.origin}/u/${profile.value?.id || ''}`;
  try {
    await navigator.clipboard.writeText(url);
    notice.value = t('主页链接已复制。');
  } catch {
    notice.value = t('主页链接：{url}', { url });
  }
}
async function toggleFavorite(asset: Asset) {
  if (!me.value) { router.push(`/login?next=${encodeURIComponent(route.fullPath)}`); return; }
  try {
    const result = await setGalleryFavorite(asset.id, !asset.favorite);
    const list = tab.value === 'favorites' ? favorites : works;
    list.value = list.value.map(item => item.id === asset.id ? { ...item, favorite: result.favorite, favoriteCount: result.favoriteCount } : item);
  } catch (cause) {
    notice.value = cause instanceof Error ? cause.message : t('收藏暂不可用，请稍后重试。');
  }
}

watch(tab, () => { if (!loading.value) loadTab(); });
watch(handle, () => {
  // Another profile replaces the page: the open work goes with it.
  active.value = null;
  closing.value = false;
  void load();
});
watch(() => route.query.work, work => {
  if (querySyncing) return;
  const id = typeof work === 'string' ? work : '';
  if (!id) {
    if (active.value) closeDetail(false);
    return;
  }
  openFromQuery();
});
onMounted(async () => {
  try {
    const state = await accountRequest('me');
    me.value = state.user;
    shortFilm.value = Boolean(state.shortFilm);
  } catch { /* 游客也能看主页。 */ }
  await load();
  openFromQuery();
});
</script>
