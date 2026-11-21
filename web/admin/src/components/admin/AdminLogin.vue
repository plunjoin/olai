<template>
  <div class="adm-login-page">
    <form class="adm-login-card" @submit.prevent="submit">
      <div class="adm-login-brand">
        <span class="adm-brand-mark">O</span>
        <span>{{ t('Olai 管理后台') }}<small>ADMIN CONSOLE</small></span>
      </div>
      <h1>{{ t('登录管理后台') }}</h1>
      <p class="adm-login-sub">{{ t('使用后台管理员账号登录；后台账号与门户账号相互独立。') }}</p>

      <p v-if="notice" class="adm-feedback" data-tone="ok" role="status">{{ notice }}</p>
      <p v-if="error" class="adm-feedback" data-tone="error" role="alert">{{ error }}</p>

      <div class="adm-login-fields">
        <label class="adm-field">
          <span>{{ t('管理员邮箱') }}</span>
          <input v-model="email" class="adm-input" type="email" name="email" autocomplete="username" required maxlength="254" :disabled="busy" @input="error = ''" />
        </label>
        <label class="adm-field">
          <span>{{ t('密码') }}</span>
          <input v-model="password" class="adm-input" type="password" name="password" autocomplete="current-password" required minlength="8" maxlength="128" :disabled="busy" @input="error = ''" />
        </label>
      </div>

      <button class="adm-btn adm-btn-primary adm-login-submit" type="submit" :disabled="busy">
        {{ busy ? t('登录中…') : t('登录') }}
      </button>
      <p class="adm-note">{{ t('连续登录失败会临时限制该 IP。忘记密码请联系部署者使用 admin-passwd 重置。') }}</p>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { t } from '../../lib/i18n';

interface AdminSession { id: string; email: string; name?: string | null }
const props = defineProps<{ initialError?: string; notice?: string }>();
const emit = defineEmits<{ signedIn: [admin: AdminSession] }>();

const email = ref('');
const password = ref('');
const error = ref(props.initialError || '');
const busy = ref(false);

watch(() => props.initialError, value => { if (value) error.value = t(value); });

async function submit() {
  if (busy.value) return;
  error.value = '';
  if (!email.value.trim() || !password.value) {
    error.value = t('请输入管理员邮箱和密码。');
    return;
  }
  busy.value = true;
  try {
    const response = await fetch('/api/admin/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email: email.value.trim(), password: password.value }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.admin?.email) {
      throw new Error(t(data?.error?.message || '邮箱或密码不正确。'));
    }
    emit('signedIn', data.admin as AdminSession);
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : t('无法连接服务端，请稍后重试。');
  } finally {
    busy.value = false;
  }
}
</script>
