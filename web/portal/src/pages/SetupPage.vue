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
        <div class="auth-card setup-card">
          <p class="auth-kicker">{{ t('首次部署') }}</p>
          <h1>{{ t('初始化 Olai') }}</h1>
          <p class="auth-sub">{{ t('创建第一个后台管理员账号，完成站点初始化。') }}</p>

          <p v-if="loading" class="auth-hint" role="status"><LoaderCircle :size="15" class="auth-spin" />{{ t('正在检查安装状态…') }}</p>
          <template v-else-if="required">
            <form @submit.prevent="submit">
              <p v-if="error" class="auth-error" role="alert"><CircleAlert :size="15" /><span>{{ error }}</span></p>

              <section class="setup-section">
                <h2>{{ t('管理员账号') }}</h2>
                <p class="auth-hint">{{ t('后台管理员账号与门户账号相互独立；请分别保管密码。') }}</p>
                <label class="auth-field">
                  <span class="auth-label">{{ t('邮箱') }}</span>
                  <input v-model="email" type="email" name="email" autocomplete="username" required maxlength="254" :disabled="busy" />
                </label>
                <label class="auth-field">
                  <span class="auth-label">{{ t('昵称（可选）') }}</span>
                  <input v-model="name" type="text" name="name" autocomplete="nickname" maxlength="24" :disabled="busy" />
                </label>
                <label class="auth-field">
                  <span class="auth-label">{{ t('密码') }}</span>
                  <input v-model="password" type="password" name="new-password" autocomplete="new-password" required minlength="8" maxlength="128" :disabled="busy" />
                </label>
                <label class="auth-field">
                  <span class="auth-label">{{ t('确认密码') }}</span>
                  <input v-model="confirmation" type="password" name="confirm-password" autocomplete="new-password" required minlength="8" maxlength="128" :disabled="busy" />
                </label>
              </section>

              <section class="setup-section">
                <h2>{{ t('站点') }}</h2>
                <label class="auth-field">
                  <span class="auth-label">{{ t('公开站点地址（可选）') }}</span>
                  <input v-model="siteOrigin" type="url" name="site-origin" autocomplete="url" maxlength="254" :disabled="busy" placeholder="https://olai.example.com" />
                </label>
                <p class="auth-hint">{{ t('反向代理部署时填写；本地开发或直接访问可留空。') }}</p>
              </section>

              <section class="setup-section">
                <h2>{{ t('运行环境') }}</h2>
                <dl class="setup-runtime">
                  <div><dt>{{ t('配置与数据库') }}</dt><dd>{{ databaseLabel }}</dd></div>
                  <div><dt>Redis</dt><dd>{{ t('当前版本未使用 Redis；会话与限流保存在主数据库。') }}</dd></div>
                </dl>
                <p class="auth-hint">{{ t('基础配置与账号保存在当前数据库（{database}）；数据库类型在启动前通过 DATABASE_URL 选择，运行中不能切换。', { database: databaseLabel }) }}</p>
              </section>

              <label v-if="tokenRequired" class="auth-field">
                <span class="auth-label">{{ t('安装令牌') }}</span>
                <input v-model="token" type="password" name="setup-token" autocomplete="off" required :disabled="busy" />
              </label>
              <p v-if="tokenRequired" class="auth-hint">{{ t('安装令牌由部署者在环境变量 SETUP_TOKEN 中设置。') }}</p>

              <button class="primary-button auth-submit" type="submit" :disabled="busy">
                <ShieldCheck :size="16" />{{ busy ? t('正在初始化…') : t('完成初始化') }}
              </button>
            </form>
          </template>
          <p v-else-if="error" class="auth-error" role="alert"><CircleAlert :size="15" /><span>{{ error }}</span></p>
          <p v-else class="auth-hint">{{ t('站点已完成初始化，正在返回首页…') }}</p>
        </div>
        <p class="auth-legal">{{ t('初始化完成后，请使用该账号登录管理后台。') }}</p>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ArrowLeft, CircleAlert, LoaderCircle, ShieldCheck } from 'lucide-vue-next';
import AuthShowcase from '../components/AuthShowcase.vue';
import BrandLogo from '../components/BrandLogo.vue';
import { t } from '../lib/i18n';

interface SetupStatus {
  required?: boolean;
  tokenRequired?: boolean;
  database?: 'sqlite' | 'postgresql';
}

const loading = ref(true);
const required = ref(false);
const tokenRequired = ref(false);
const database = ref('');
const email = ref('');
const name = ref('');
const password = ref('');
const confirmation = ref('');
const siteOrigin = ref('');
const token = ref('');
const error = ref('');
const busy = ref(false);
const databaseLabel = computed(() => database.value === 'postgresql' ? 'PostgreSQL' : 'SQLite');

function failureMessage(failure: unknown, fallback: string) {
  return failure instanceof Error ? failure.message : t(fallback);
}

onMounted(async () => {
  try {
    const response = await fetch('/api/setup/status', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    const data = await response.json().catch(() => ({})) as SetupStatus & { error?: { message?: string } };
    if (!response.ok) throw new Error(t(data?.error?.message || '无法读取安装状态。'));
    if (!data.required) {
      window.location.replace('/');
      return;
    }
    required.value = true;
    tokenRequired.value = data.tokenRequired === true;
    database.value = data.database === 'postgresql' ? 'postgresql' : 'sqlite';
  } catch (failure) {
    error.value = failureMessage(failure, '无法读取安装状态。');
  } finally {
    loading.value = false;
  }
});

async function submit() {
  if (busy.value) return;
  error.value = '';
  if (!email.value.trim()) {
    error.value = t('请输入有效的邮箱地址。');
    return;
  }
  if (password.value.length < 8 || password.value.length > 128) {
    error.value = t('请输入 8–128 位密码。');
    return;
  }
  if (password.value !== confirmation.value) {
    error.value = t('两次输入的密码不一致。');
    return;
  }
  if (tokenRequired.value && !token.value.trim()) {
    error.value = t('请输入安装令牌。');
    return;
  }
  busy.value = true;
  try {
    const response = await fetch('/api/setup', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        email: email.value.trim(),
        password: password.value,
        name: name.value.trim(),
        siteOrigin: siteOrigin.value.trim(),
        token: token.value.trim(),
      }),
    });
    const data = await response.json().catch(() => ({})) as { adminPath?: string; loginPath?: string; error?: { message?: string } };
    if (!response.ok) throw new Error(t(data?.error?.message || '初始化失败，请稍后重试。'));
    window.location.replace(data.loginPath || data.adminPath || '/admin');
  } catch (failure) {
    error.value = failureMessage(failure, '初始化失败，请稍后重试。');
    busy.value = false;
  }
}
</script>
