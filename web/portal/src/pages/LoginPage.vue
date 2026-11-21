<template>
  <div class="auth-page">
    <AuthShowcase />
    <main class="auth-main">
      <div class="auth-main-top">
        <span class="auth-mobile-brand">
          <a class="auth-brand" href="/" :aria-label="t('小o 首页')"><BrandLogo :size="34" /><span>Olai</span></a>
        </span>
        <a class="auth-back" href="/" :aria-label="t('返回工作台')"><ArrowLeft :size="15" /><span>{{ t('返回工作台') }}</span></a>
      </div>
      <div class="auth-card-wrap">
        <div class="auth-card">
          <h1>{{ title }}</h1>
          <p class="auth-sub">{{ subtitle }}</p>

          <div v-if="mode === 'login' || mode === 'register'" class="auth-tabs" role="tablist" :aria-label="t('登录或注册')">
            <button type="button" role="tab" class="auth-tab" :aria-selected="mode === 'login'" :disabled="busy" @click="switchMode('login')">{{ t('登录') }}</button>
            <button type="button" role="tab" class="auth-tab" :aria-selected="mode === 'register'" :disabled="busy" @click="switchMode('register')">{{ t('创建账号') }}</button>
          </div>

          <div v-if="mode === 'sent'" class="auth-sent">
            <p v-if="error" class="auth-error" role="alert"><CircleAlert :size="15" /><span>{{ t(error) }}</span></p>
            <p class="auth-hint">{{ t('没有收到？请检查垃圾箱，或重新发送邮件。') }}</p>
            <button class="primary-button auth-submit" type="button" :disabled="busy" @click="resend">
              <MailCheck :size="16" />{{ busy ? t('请稍候…') : t('重新发送邮件') }}
            </button>
          </div>
          <form v-else @submit.prevent="submit">
            <p v-if="error" class="auth-error" role="alert"><CircleAlert :size="15" /><span>{{ t(error) }}</span></p>
            <p v-if="notice" class="auth-notice" role="status"><CircleCheck :size="15" /><span>{{ t(notice) }}</span></p>

            <template v-if="githubLogin && (mode === 'login' || mode === 'register')">
              <a class="auth-github" :href="githubHref"><GithubIcon :size="16" />{{ t('使用 GitHub 登录') }}</a>
              <div class="auth-divider">{{ t('或使用邮箱') }}</div>
            </template>

            <label v-if="mode !== 'reset'" class="auth-field">
              <span class="auth-label">{{ t('邮箱') }}</span>
              <input v-model="email" type="email" name="email" autocomplete="username" required maxlength="254" :disabled="busy" />
            </label>
            <label v-if="mode !== 'forgot'" class="auth-field">
              <span class="auth-label">{{ mode === 'reset' ? t('新密码') : t('密码') }}</span>
              <span class="auth-input-wrap">
                <input v-model="password" :type="reveal ? 'text' : 'password'" name="password" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" required minlength="8" maxlength="128" :disabled="busy" />
                <button type="button" class="auth-eye" :aria-label="reveal ? t('隐藏密码') : t('显示密码')" :aria-pressed="reveal" @click="reveal = !reveal">
                  <EyeOff v-if="reveal" :size="16" /><Eye v-else :size="16" />
                </button>
              </span>
            </label>
            <p v-if="mode === 'login'" class="auth-switch auth-forgot">
              <button type="button" :disabled="busy" @click="switchMode('forgot')">{{ t('忘记密码？') }}</button>
            </p>
            <label v-if="mode === 'register' || mode === 'reset'" class="auth-field">
              <span class="auth-label">{{ t('确认密码') }}</span>
              <input v-model="confirmation" :type="reveal ? 'text' : 'password'" name="confirmation" autocomplete="new-password" required minlength="8" maxlength="128" :disabled="busy" />
            </label>
            <label v-if="mode === 'register'" class="auth-field">
              <span class="auth-label">{{ t('邀请码（可选）') }}</span>
              <input v-model="invite" type="text" name="invite" autocomplete="off" maxlength="12" :disabled="busy" :placeholder="t('8 位邀请码')" @input="invite = invite.toUpperCase()" />
            </label>

            <template v-if="mode === 'register'">
              <p v-if="githubLogin" class="auth-hint">{{ t('GitHub 登录会自动创建账号；该邮箱已有账号时直接关联。邀请码会一并带入。') }}</p>
              <p class="auth-hint">{{ t('注册后需要验证邮箱才能登录。每天按北京时间零点重置额度。歌曲封面使用图片额度。登录账号生成时按所选画质消耗积分。') }}</p>
            </template>

            <button class="primary-button auth-submit" type="submit" :disabled="busy">
              <LogIn v-if="mode === 'login'" :size="16" /><UserPlus v-else-if="mode === 'register'" :size="16" /><KeyRound v-else :size="16" />
              {{ busy ? t('请稍候…') : mode === 'login' ? t('登录') : mode === 'register' ? t('注册') : mode === 'reset' ? t('保存新密码') : t('发送重置邮件') }}
            </button>
          </form>

          <p class="auth-switch">
            <template v-if="mode === 'login'">{{ t('还没有账号？') }}<button type="button" :disabled="busy" @click="switchMode('register')">{{ t('创建账号') }}</button></template>
            <template v-else-if="mode === 'register'">{{ t('已有账号？') }}<button type="button" :disabled="busy" @click="switchMode('login')">{{ t('去登录') }}</button></template>
            <template v-else>{{ t('想起密码了？') }}<button type="button" :disabled="busy" @click="switchMode('login')">{{ t('去登录') }}</button></template>
          </p>
        </div>
        <p class="auth-legal">{{ t('同一浏览器内的游客记录会在登录后自动同步。') }}</p>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue';
import { ArrowLeft, CircleAlert, CircleCheck, Eye, EyeOff, KeyRound, LogIn, MailCheck, UserPlus } from 'lucide-vue-next';
import AuthShowcase from '../components/AuthShowcase.vue';
import BrandLogo from '../components/BrandLogo.vue';
import GithubIcon from '../components/GithubIcon.vue';
import { accountRequest } from '../lib/account';
import { flushStorage } from '../lib/storage';
import { safeNextPath } from '../lib/nextPath';
import { loadStatus } from '../lib/status';
import { t } from '../lib/i18n';

type Mode = 'login' | 'register' | 'forgot' | 'reset' | 'sent';
const GITHUB_ERRORS: Record<string, string> = {
  config: t('GitHub 登录尚未配置，请使用邮箱登录。'),
  denied: t('已取消 GitHub 授权。'),
  state: t('GitHub 登录会话已过期，请重试。'),
  network: t('暂时无法连接 GitHub，请稍后重试或联系管理员检查服务器网络代理。'),
  token: t('GitHub 授权失败，请重试。'),
  profile: t('无法读取 GitHub 账号信息，请重试。'),
  email: t('GitHub 账号没有可用的已验证邮箱，请先在 GitHub 验证邮箱。'),
  banned: t('此账号已被停用，请联系管理员。'),
  switch: t('当前已登录其他账号，请先退出后再用 GitHub 登录。'),
  failed: t('GitHub 登录失败，请重试。'),
};

const query = (name: string) => new URLSearchParams(window.location.search).get(name) || '';
const nextPath = () => safeNextPath(query('next'));
const githubError = () => {
  const code = query('github_error');
  if (!code) return '';
  return Object.hasOwn(GITHUB_ERRORS, code) ? GITHUB_ERRORS[code] : GITHUB_ERRORS.failed;
};

const bootstrap = inject<{ githubLogin?: boolean }>('bootstrap', {});
const mode = ref<Mode>(query('reset') ? 'reset' : 'login');
const email = ref('');
const password = ref('');
const confirmation = ref('');
const invite = ref(query('invite').toUpperCase());
const resetToken = ref(query('reset'));
const reveal = ref(false);
const busy = ref(Boolean(query('verify')));
const error = ref(githubError());
const notice = ref('');
const githubLogin = ref(bootstrap?.githubLogin === true);

const title = computed(() => ({
  login: t('欢迎回来'),
  register: t('开始你的创作'),
  forgot: t('重置密码'),
  reset: t('设置新密码'),
  sent: t('请查收邮件'),
}[mode.value]));
const subtitle = computed(() => mode.value === 'sent'
  ? (notice.value ? t(notice.value) : t('请到邮箱查收邮件，并留意垃圾箱。'))
  : ({
      login: t('登录后继续你的创作旅程。'),
      register: t('注册后即可保存并同步创作记录。'),
      forgot: t('输入注册邮箱，我们会发送重置链接。'),
      reset: t('请输入 8–128 位新密码。'),
      sent: '',
    }[mode.value]));
const githubHref = computed(() => `/api/auth/github${mode.value === 'register' && invite.value.trim() ? `?invite=${encodeURIComponent(invite.value.trim())}` : ''}`);

function switchMode(next: Mode, message = '') {
  mode.value = next;
  error.value = '';
  notice.value = message;
  if (next !== 'reset') resetToken.value = '';
  if (next !== 'register' && next !== 'login') password.value = '';
  confirmation.value = '';
}
function stripAuthParams() {
  const url = new URL(window.location.href);
  for (const name of ['github_error', 'verify', 'reset']) url.searchParams.delete(name);
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}
async function submit() {
  if (busy.value || mode.value === 'sent') return;
  if ((mode.value === 'register' || mode.value === 'reset') && password.value !== confirmation.value) {
    error.value = t('两次输入的密码不一致。');
    return;
  }
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    if (mode.value === 'forgot') {
      const state = await accountRequest('forgot', { email: email.value });
      busy.value = false;
      switchMode('sent', state.message || t('如果该邮箱已注册，我们已发送重置邮件。'));
      return;
    }
    if (mode.value === 'reset') {
      await flushStorage();
      const state = await accountRequest('reset', { token: resetToken.value, password: password.value });
      if (state.user) { window.location.assign(nextPath()); return; }
      busy.value = false;
      password.value = '';
      confirmation.value = '';
      reveal.value = false;
      switchMode('login', state.message || t('密码已重置，请使用新密码登录。'));
      return;
    }
    await flushStorage();
    const action = mode.value === 'register' ? 'register' : 'login';
    const state = await accountRequest(action, {
      email: email.value,
      password: password.value,
      ...(action === 'register' && invite.value.trim() ? { inviteCode: invite.value.trim() } : {}),
    });
    if (state.pendingVerification) {
      busy.value = false;
      switchMode('sent', state.message || t('验证邮件已发送，请查收后再登录。'));
      return;
    }
    window.location.assign(nextPath());
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : t('账号操作失败，请重试。');
    busy.value = false;
  }
}
async function resend() {
  if (busy.value || !email.value) { switchMode('login'); error.value = t('请输入有效邮箱。'); return; }
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const state = await accountRequest('resend', { email: email.value });
    notice.value = state.message || t('如果该邮箱需要验证，我们已发送验证邮件。');
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : t('账号操作失败，请重试。');
  } finally {
    busy.value = false;
  }
}
onMounted(async () => {
  void loadStatus().then(state => { githubLogin.value = state.githubLogin; });
  const verifyToken = query('verify');
  const reset = query('reset');
  const githubFailure = githubError();
  if (githubFailure || verifyToken || reset) stripAuthParams();
  if (githubFailure || reset) { busy.value = false; return; }
  if (verifyToken) {
    try {
      const state = await accountRequest('verify', { token: verifyToken });
      if (state.user) { await flushStorage(); window.location.replace(nextPath()); return; }
      busy.value = false;
      switchMode('login', state.message || t('邮箱已验证，请登录。'));
    } catch (failure) {
      busy.value = false;
      mode.value = 'login';
      error.value = failure instanceof Error ? failure.message : t('账号操作失败，请重试。');
    }
    return;
  }
  try {
    const state = await accountRequest('me');
    if (state.user) window.location.replace(nextPath());
  } catch { /* 表单仍可提交，提交时会给出具体原因。 */ }
});
</script>
