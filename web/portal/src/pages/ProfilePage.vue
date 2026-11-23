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
          <section class="profile-head">
            <AccountAvatar :name="profile.name" :avatar="profile.avatar" :size="72" />
            <div class="profile-identity">
              <h1>{{ profile.name }}</h1>
              <p class="profile-handle">@{{ profile.id }}</p>
              <p v-if="profile.bio" class="profile-bio">{{ profile.bio }}</p>
              <p v-if="profile.website" class="profile-website"><a :href="profile.website" rel="noreferrer noopener">{{ profile.website }}</a></p>
              <p v-if="profile.joinedAt" class="profile-joined">{{ t('加入于 {date}', { date: joined }) }}</p>
              <p v-if="profile.followers !== undefined && profile.following !== undefined" class="profile-counts">
                <span><strong>{{ profile.followers }}</strong>{{ t('关注者') }}</span>
                <span><strong>{{ profile.following }}</strong>{{ t('正在关注') }}</span>
              </p>
            </div>
            <div class="profile-actions">
              <RouterLink v-if="profile.self" to="/account" class="secondary-button">{{ t('编辑资料与隐私') }}</RouterLink>
              <template v-else-if="me">
                <button type="button" class="secondary-button" :class="{ 'is-following': profile.followingUser }" :disabled="busy" @click="toggleFollow">
                  {{ profile.followingUser ? t('已关注') : t('关注') }}
                </button>
                <RouterLink v-if="profile.canMessage" class="secondary-button" :to="`/messages/${profile.id}`">{{ t('私信') }}</RouterLink>
                <button type="button" class="text-button" :disabled="busy" @click="toggleBlock">
                  {{ profile.blocked ? t('取消拉黑') : t('拉黑') }}
                </button>
              </template>
              <RouterLink v-else :to="`/login?next=${encodeURIComponent('/u/' + profile.id)}`" class="secondary-button">{{ t('登录后关注') }}</RouterLink>
            </div>
          </section>

          <p v-if="notice" class="profile-notice" role="status">{{ notice }}</p>

          <nav v-if="profile.works || profile.favorites" class="profile-tabs" role="tablist" :aria-label="t('主页内容')">
            <button v-if="profile.works" type="button" role="tab" :aria-selected="tab === 'works'" :class="{ 'is-active': tab === 'works' }" @click="tab = 'works'">{{ t('作品') }}</button>
            <button v-if="profile.favorites" type="button" role="tab" :aria-selected="tab === 'favorites'" :class="{ 'is-active': tab === 'favorites' }" @click="tab = 'favorites'">{{ t('收藏') }}</button>
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
            />
          </div>
          <p v-else-if="profile.works || profile.favorites" class="profile-status">{{ tab === 'favorites' ? t('还没有公开的收藏') : t('还没有公开的作品') }}</p>
          <p v-else class="profile-status">{{ t('这位用户暂未公开主页内容。') }}</p>
        </template>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft } from 'lucide-vue-next';
import AccountAvatar from '../components/AccountAvatar.vue';
import PlazaCard from '../components/plaza/PlazaCard.vue';
import PlazaRail from '../components/plaza/PlazaRail.vue';
import { accountRequest, type Account } from '../lib/account';
import { setGalleryFavorite } from '../lib/gallery';
import { intlLocale, t } from '../lib/i18n';
import { getProfileFavorites, getProfileWorks, getPublicProfile, setBlocked, setFollow, type PublicProfile } from '../lib/people';
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

const handle = computed(() => String(route.params.handle || ''));
const visible = computed(() => tab.value === 'favorites' ? favorites.value : works.value);
const joined = computed(() => profile.value?.joinedAt ? new Date(profile.value.joinedAt).toLocaleDateString(intlLocale(), { year: 'numeric', month: 'long' }) : '');

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

function openWork(asset: Asset) {
  router.push({ path: '/', query: { work: asset.id } });
}
function downloadWork(asset: Asset) {
  if (asset.url) window.open(asset.url, '_blank', 'noopener');
}
async function shareWork(asset: Asset) {
  const link = `${location.origin}/?work=${encodeURIComponent(asset.id)}`;
  try { await navigator.clipboard.writeText(link); notice.value = t('已复制作品链接'); } catch { notice.value = link; }
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
watch(handle, load);
onMounted(async () => {
  try {
    const state = await accountRequest('me');
    me.value = state.user;
    shortFilm.value = Boolean(state.shortFilm);
  } catch { /* 游客也能看主页。 */ }
  await load();
});
</script>
