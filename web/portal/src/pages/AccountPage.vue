<template>
  <div class="account-page">
    <header class="account-topbar">
      <a class="account-brand" href="/"><BrandLogo :size="30" /><span>Olai</span></a>
      <nav class="account-topnav" :aria-label="t('账号中心导航')">
        <RouterLink to="/library">{{ t('我的库') }}</RouterLink>
        <RouterLink to="/gallery">{{ t('作品广场') }}</RouterLink>
        <a class="account-back" href="/" :aria-label="t('返回工作台')"><ArrowLeft :size="15" />{{ t('返回工作台') }}</a>
      </nav>
    </header>

    <main class="account-main">
      <div class="account-heading">
        <h1>{{ t('账号中心') }}</h1>
        <p>{{ t('管理你的账号、积分与每日额度。') }}</p>
      </div>

      <div v-if="account && error" class="account-error" role="alert" style="margin-bottom: 16px">
        <CircleAlert :size="17" /><span>{{ t(error) }}</span>
      </div>

      <div v-if="!account && !error" class="account-loading" aria-busy="true">
        <div class="account-skeleton" /><div class="account-skeleton short" /><div class="account-skeleton" />
      </div>

      <div v-if="error && !account" class="account-error" role="alert">
        <CircleAlert :size="17" /><span>{{ t(error) }}</span>
        <button type="button" class="secondary-button" @click="load">{{ t('重新加载') }}</button>
      </div>

      <div v-if="account && !user" class="account-error" role="alert">
        <CircleAlert :size="17" /><span>{{ t('登录状态已失效，请重新登录。') }}</span>
        <a class="secondary-button" href="/login?next=%2Faccount">{{ t('去登录') }}</a>
      </div>

      <div v-if="account && user" class="account-grid">
        <section class="account-card account-profile">
          <AccountAvatar class-name="account-avatar" :name="name" :avatar="user.avatar" :size="42" />
          <div class="account-identity">
            <h2>{{ name }}<span class="account-badge">{{ t('已登录') }}</span></h2>
            <p>{{ user.email }}</p>
            <p v-if="profileNote" class="account-profile-note" role="status"><CircleCheck :size="13" />{{ profileNote }}</p>
          </div>
          <div class="account-profile-actions">
            <button type="button" class="secondary-button" :disabled="busy" @click="profileNote = ''; editing = true"><Pencil :size="15" />{{ t('编辑资料') }}</button>
            <button type="button" class="danger-button" :disabled="busy" @click="logout"><LogOut :size="15" />{{ busy ? t('请稍候…') : t('退出登录') }}</button>
          </div>
        </section>

        <div class="account-stats">
          <section class="account-card account-stat">
            <span class="account-stat-label">{{ t('积分余额') }}</span>
            <strong>{{ account.points ?? 0 }}</strong>
            <small>{{ t('积分可用于图片、视频与音乐生成') }}</small>
          </section>
          <section class="account-card account-stat">
            <span class="account-stat-label">{{ t('图片 / 视频 / 音乐') }}</span>
            <strong>{{ account.generationLimit }}</strong>
            <small>{{ t('次 / 天，按北京时间零点重置') }}</small>
          </section>
          <section class="account-card account-stat">
            <span class="account-stat-label">{{ t('对话') }}</span>
            <strong>{{ chatLimit }}</strong>
            <small>{{ t('条 / 天，与创作额度分开计算') }}</small>
          </section>
        </div>

        <div class="account-columns">
          <div class="account-column">
            <section class="account-card">
              <div class="account-card-head"><h2>{{ t('积分价目') }}</h2><span>{{ t('按生成档位计费') }}</span></div>
              <dl class="account-rates">
                <div class="account-rate"><dt>{{ t('图片（每次）') }}</dt><dd>{{ prices ? Object.entries(prices.image).map(([quality, cost]) => `${quality} ${cost}`).join(' · ') : '—' }}</dd></div>
                <div class="account-rate"><dt>{{ t('视频（每秒）') }}</dt><dd>{{ prices ? Object.entries(prices.video).map(([resolution, cost]) => `${resolution === '4k' ? '4K' : resolution} ${cost}`).join(' · ') : '—' }}</dd></div>
                <div class="account-rate"><dt>{{ t('音乐（每分钟）') }}</dt><dd>{{ prices ? prices.musicPerMinute : '—' }}</dd></div>
                <div class="account-rate"><dt>{{ t('对话（每条）') }}</dt><dd>{{ prices ? (prices.chatPerMessage > 0 ? prices.chatPerMessage : t('免费')) : '—' }}</dd></div>
              </dl>
              <p class="account-note" style="margin-top: 12px">{{ t('歌曲封面使用图片额度；登录账号生成时按所选画质消耗积分。') }}</p>
            </section>

            <section class="account-card">
              <div class="account-card-head"><h2>{{ t('本地数据') }}</h2><span v-if="syncing" role="status">{{ t('正在同步…') }}</span></div>
              <p class="account-note">{{ t('游客会话与作品会同步到当前账号，未完成的内容仍保留在本地。聊天记录不会公开。') }}</p>
              <div class="account-sync-actions">
                <button type="button" class="secondary-button" :disabled="syncing" :aria-busy="syncing" @click="sync(user.id)">
                  <RefreshCw :size="15" :class="{ 'auth-spin': syncing }" />{{ syncing ? t('正在同步…') : t('同步本地数据') }}
                </button>
              </div>
              <p v-if="syncNote" class="account-status" role="status">{{ syncNote }}</p>
              <div v-if="failures.length" class="account-failures" role="status"><p v-for="(message, index) in failures" :key="index">{{ t(message) }}</p></div>
            </section>

            <section class="account-card">
              <div class="account-card-head"><h2>{{ t('额度说明') }}</h2></div>
              <p class="account-note">{{ t('每天按北京时间零点重置额度。额度用完后仍可浏览作品广场与个人库，次日恢复。') }}</p>
            </section>
          </div>

          <div class="account-column">
            <section class="account-card">
              <div class="account-card-head"><h2>{{ t('邀请好友') }}</h2><span>{{ t('双方各得积分') }}</span></div>
              <p class="account-note">{{ t('好友使用邀请码注册并完成首次生成后，双方都会获得积分。') }}</p>
              <div v-if="account.inviteCode" class="account-code">
                <code>{{ account.inviteCode }}</code>
                <button type="button" class="secondary-button" @click="copyInvite"><Check v-if="copied" :size="14" /><Copy v-else :size="14" />{{ copied ? t('已复制') : t('复制邀请码') }}</button>
              </div>
              <p v-else class="account-note" style="margin-top: 10px">{{ t('邀请码生成中，请稍后刷新。') }}</p>
            </section>

            <section class="account-card">
              <div class="account-card-head"><h2>{{ t('快捷入口') }}</h2></div>
              <div class="account-links">
                <RouterLink class="account-link" to="/library"><LayoutGrid :size="16" />{{ t('我的库') }}</RouterLink>
                <RouterLink class="account-link" to="/gallery"><Images :size="16" />{{ t('作品广场') }}</RouterLink>
                <RouterLink class="account-link" to="/"><Sparkles :size="16" />{{ t('继续创作') }}</RouterLink>
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>

    <ProfileDialog v-if="editing && user" :user="user" :can-upload="account?.mediaStorage === 'oss'" :save="saveProfile" @close="editing = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ArrowLeft, Check, CircleAlert, CircleCheck, Copy, Images, LayoutGrid, LogOut, Pencil, RefreshCw, Sparkles } from 'lucide-vue-next';
import BrandLogo from '../components/BrandLogo.vue';
import AccountAvatar from '../components/AccountAvatar.vue';
import ProfileDialog from '../components/ProfileDialog.vue';
import { accountRequest, type AccountState } from '../lib/account';
import { flushStorage, initializeStorage, syncGuestRecords } from '../lib/storage';
import { profileDisplayName } from '../lib/profile';
import { t } from '../lib/i18n';

const account = ref<AccountState | null>(null);
const error = ref('');
const busy = ref(false);
const syncing = ref(false);
const syncNote = ref('');
const failures = ref<string[]>([]);
const copied = ref(false);
const editing = ref(false);
const profileNote = ref('');
const user = computed(() => account.value?.user || null);
const prices = computed(() => account.value?.prices);
const name = computed(() => user.value ? profileDisplayName(user.value) : t('访客'));
const chatLimit = computed(() => account.value?.chatLimit ?? 100);

async function load() {
  error.value = '';
  try {
    account.value = await initializeStorage();
    if (account.value.user) void sync(account.value.user.id);
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : t('账号服务暂不可用。');
  }
}
async function sync(userId: string) {
  syncing.value = true;
  syncNote.value = '';
  try {
    const report = await syncGuestRecords(userId);
    failures.value = report.failures;
    if (!report.failures.length) syncNote.value = t('本地数据与云端附件已同步。');
  } catch (failure) {
    failures.value = [failure instanceof Error ? failure.message : t('请重试。')];
  } finally {
    syncing.value = false;
  }
}
async function copyInvite() {
  if (!account.value?.inviteCode) return;
  try {
    await navigator.clipboard.writeText(account.value.inviteCode);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 1600);
  } catch { /* 剪贴板不可用时仍可手动选中邀请码。 */ }
}
async function logout() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await flushStorage();
    await accountRequest('logout');
    window.location.assign('/');
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : t('账号操作失败，请重试。');
    busy.value = false;
  }
}
async function saveProfile(input: { name: string; avatar: string | null }) {
  profileNote.value = '';
  const state = await accountRequest('profile', input);
  account.value = state;
  editing.value = false;
  profileNote.value = t('个人资料已更新。');
}
onMounted(load);
</script>
