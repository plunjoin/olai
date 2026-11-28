<template>
  <div class="plaza-shell profile-shell">
    <div v-if="toastText" class="toast" role="status">
      <CircleAlert :size="17" /><span>{{ toastText }}</span>
      <button :aria-label="t('关闭通知')" @click="clearToast"><X :size="15" /></button>
    </div>
    <DialogHost />
    <PlazaRail :user="user" :short-film="shortFilm" />
    <div class="plaza-main">
      <header class="profile-bar">
        <RouterLink to="/" class="profile-back"><ArrowLeft :size="16" />{{ t('作品广场') }}</RouterLink>
        <RouterLink v-if="user" to="/messages" class="profile-messages">{{ t('私信') }}</RouterLink>
        <RouterLink v-else to="/login" class="profile-messages">{{ t('登录') }}</RouterLink>
      </header>

      <main class="profile-main">
        <p v-if="loading" class="profile-status">{{ t('正在打开账号中心…') }}</p>

        <div v-else-if="error && !account" class="account-error" role="alert">
          <CircleAlert :size="17" /><span>{{ t(error) }}</span>
          <button type="button" class="secondary-button" @click="load">{{ t('重新加载') }}</button>
        </div>

        <div v-else-if="account && !user" class="account-error" role="alert">
          <CircleAlert :size="17" /><span>{{ t('登录状态已失效，请重新登录。') }}</span>
          <a class="secondary-button" href="/login?next=%2Faccount">{{ t('去登录') }}</a>
        </div>

        <template v-else-if="account && user">
          <section class="profile-hero">
            <div class="profile-banner" :style="bannerStyle" aria-hidden="true" />
            <div class="profile-hero-body">
              <div class="profile-hero-avatar">
                <AccountAvatar :name="name" :avatar="user.avatar" :size="112" />
              </div>

              <div class="profile-identity">
                <h1 class="profile-name">{{ name }}<span class="account-badge">{{ t('已登录') }}</span></h1>
                <p class="profile-handle">{{ user.email }}</p>
                <p class="profile-bio">{{ t('管理你的账号、积分与每日额度。') }}</p>
                <p v-if="profileNote" class="profile-joined" role="status"><CircleCheck :size="13" />{{ profileNote }}</p>
              </div>

              <div class="profile-hero-side">
                <dl class="profile-stats">
                  <div class="profile-stat">
                    <dd>{{ account.points ?? 0 }}</dd>
                    <dt>{{ t('积分余额') }}</dt>
                  </div>
                  <div class="profile-stat">
                    <dd>{{ account.generationLimit }}</dd>
                    <dt>{{ t('图片 / 视频 / 音乐') }}</dt>
                  </div>
                  <div class="profile-stat">
                    <dd>{{ chatLimit }}</dd>
                    <dt>{{ t('对话') }}</dt>
                  </div>
                </dl>

                <div class="profile-actions">
                  <button type="button" class="primary-button" :disabled="busy" @click="profileNote = ''; editing = true">
                    <Pencil :size="15" />{{ t('编辑资料') }}
                  </button>
                  <button type="button" class="outline-button" @click="editingBanner = true">
                    <ImageUp :size="15" />{{ t('编辑封面') }}
                  </button>
                  <button type="button" class="text-button" :disabled="busy" @click="logout">
                    <LogOut :size="15" />{{ busy ? t('请稍候…') : t('退出登录') }}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <div class="profile-content">
            <p v-if="error" class="profile-notice" role="alert">{{ t(error) }}</p>

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
                  <div class="account-card-head"><h2>{{ t('个人主页与隐私') }}</h2><span>{{ t('游客也可访问你的主页') }}</span></div>
                  <p class="account-note">{{ t('主页地址、简介和下面的开关决定别人能看到什么。关闭后对应内容不再出现，也不会提示已隐藏。') }}</p>
                  <label class="account-privacy-field">{{ t('主页地址') }}<input v-model="privacy.handle" maxlength="20" :aria-label="t('主页地址')" placeholder="river" /></label>
                  <label class="account-privacy-field">{{ t('简介') }}<textarea v-model="privacy.bio" maxlength="160" :aria-label="t('简介')" /></label>
                  <label class="account-privacy-field">{{ t('个人网址') }}<input v-model="privacy.website" maxlength="200" :aria-label="t('个人网址')" placeholder="https://" /></label>
                  <div class="account-privacy-switches">
                    <label><input v-model="privacy.showWorks" type="checkbox" />{{ t('公开作品') }}</label>
                    <label><input v-model="privacy.showFavorites" type="checkbox" />{{ t('公开收藏') }}</label>
                    <label><input v-model="privacy.showBio" type="checkbox" />{{ t('公开简介与网址') }}</label>
                    <label><input v-model="privacy.showJoined" type="checkbox" />{{ t('公开加入时间') }}</label>
                    <label><input v-model="privacy.showFollows" type="checkbox" />{{ t('公开关注数') }}</label>
                    <label><input v-model="privacy.allowMessages" type="checkbox" />{{ t('允许私信') }}</label>
                  </div>
                  <div class="account-sync-actions">
                    <button type="button" class="secondary-button" :disabled="privacyBusy" @click="savePrivacy">{{ privacyBusy ? t('保存中…') : t('保存隐私设置') }}</button>
                    <RouterLink v-if="privacy.handle" class="secondary-button" :to="`/u/${privacy.handle}`">{{ t('查看我的主页') }}</RouterLink>
                  </div>
                  <p v-if="privacyNote" class="account-status" role="status">{{ privacyNote }}</p>
                </section>

                <section class="account-card">
                  <div class="account-card-head"><h2>{{ t('快捷入口') }}</h2></div>
                  <div class="account-links">
                    <RouterLink class="account-link" to="/library"><LayoutGrid :size="16" />{{ t('我的库') }}</RouterLink>
                    <RouterLink class="account-link" to="/messages"><Images :size="16" />{{ t('私信') }}</RouterLink>
                    <RouterLink class="account-link" to="/gallery"><Images :size="16" />{{ t('作品广场') }}</RouterLink>
                    <RouterLink class="account-link" to="/"><Sparkles :size="16" />{{ t('继续创作') }}</RouterLink>
                  </div>
                </section>
              </div>
            </div>

            <MemoryPanel :cloud="Boolean(user)" variant="account" />
          </div>
        </template>
      </main>
    </div>

    <ProfileDialog v-if="editing && user" :user="user" :can-upload="account?.mediaStorage === 'oss'" :save="saveProfile" @close="editing = false" />
    <BannerEditor
      v-if="editingBanner && user"
      :value="privacy.banner"
      :can-upload="account?.mediaStorage === 'oss'"
      :user-id="user.id"
      :save="saveBanner"
      @close="editingBanner = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ArrowLeft, Check, CircleAlert, CircleCheck, Copy, Images, ImageUp, LayoutGrid, LogOut, Pencil, RefreshCw, Sparkles, X } from 'lucide-vue-next';
import AccountAvatar from '../components/AccountAvatar.vue';
import BannerEditor from '../components/BannerEditor.vue';
import DialogHost from '../components/DialogHost.vue';
import MemoryPanel from '../components/MemoryPanel.vue';
import ProfileDialog from '../components/ProfileDialog.vue';
import PlazaRail from '../components/plaza/PlazaRail.vue';
import { accountRequest, type AccountState } from '../lib/account';
import { flushStorage, initializeStorage, syncGuestRecords } from '../lib/storage';
import { avatarTheme, bannerTheme, profileDisplayName, uploadedBannerURL } from '../lib/profile';
import { t } from '../lib/i18n';
import { getMyProfile, saveMyProfile, type PrivacySettings } from '../lib/people';
import { clearToast, toastText } from '../composables/ui';

const account = ref<AccountState | null>(null);
const privacy = ref<PrivacySettings>({ handle: '', bio: '', website: '', showWorks: true, showFavorites: false, showBio: true, showJoined: true, showFollows: true, allowMessages: true, banner: '' });
const privacyBusy = ref(false);
const privacyNote = ref('');
const error = ref('');
const busy = ref(false);
const syncing = ref(false);
const syncNote = ref('');
const failures = ref<string[]>([]);
const copied = ref(false);
const editing = ref(false);
const editingBanner = ref(false);
const profileNote = ref('');
const loading = ref(true);
const user = computed(() => account.value?.user || null);
const prices = computed(() => account.value?.prices);
const name = computed(() => user.value ? profileDisplayName(user.value) : t('访客'));
const chatLimit = computed(() => account.value?.chatLimit ?? 100);
const shortFilm = computed(() => Boolean(account.value?.shortFilm));
// 封面与个人主页同一套规则：上传的图片、预设色，都没有时用头像的配色兜底。
const bannerStyle = computed(() => {
  const uploaded = uploadedBannerURL(privacy.value.banner);
  if (uploaded) return { backgroundImage: `url("${uploaded}")` };
  const theme = bannerTheme(privacy.value.banner);
  if (theme) return { backgroundImage: theme.background };
  const avatar = avatarTheme(user.value?.avatar);
  if (avatar) return { backgroundImage: avatar.background };
  return {};
});

async function load() {
  error.value = '';
  loading.value = true;
  try {
    account.value = await initializeStorage();
    if (account.value.user) {
      void sync(account.value.user.id);
      privacy.value = (await getMyProfile()).profile;
    }
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : t('账号服务暂不可用。');
  } finally {
    loading.value = false;
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
async function savePrivacy() {
  privacyBusy.value = true;
  privacyNote.value = '';
  try {
    privacy.value = (await saveMyProfile(privacy.value)).profile;
    privacyNote.value = t('隐私设置已保存。');
  } catch (failure) {
    privacyNote.value = failure instanceof Error ? failure.message : t('隐私设置暂不可用，请稍后重试。');
  } finally {
    privacyBusy.value = false;
  }
}
/** 只提交封面一项，其余隐私开关保持不变。 */
async function saveBanner(banner: string) {
  const saved = (await saveMyProfile({ banner })).profile;
  privacy.value = { ...privacy.value, banner: saved.banner ?? '' };
  editingBanner.value = false;
  privacyNote.value = t('封面已保存。');
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
