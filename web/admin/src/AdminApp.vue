<template>
  <div v-if="checking" class="adm-shell admin-gate"><span class="adm-spinner" /> {{ t('正在验证管理员身份…') }}</div>
  <AdminLogin v-else-if="!admin" :initial-error="error" :notice="notice" @signed-in="signedIn" />
  <AdminPanel v-else :email="admin.email" :name="admin.name" @signed-out="signedOut" />
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import AdminLogin from './components/admin/AdminLogin.vue';
import AdminPanel from './components/admin/AdminPanel.vue';
import { t } from './lib/i18n';

// The console has its own cookie and account table. A portal session is not
// consulted here, and this app never links back into the portal.
interface AdminSession { id: string; email: string; name?: string | null }
const checking = ref(true);
const admin = ref<AdminSession | null>(null);
const error = ref('');
const notice = ref('');

async function check() {
  checking.value = true;
  error.value = '';
  try {
    const response = await fetch('/api/admin/session', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (response.status === 401) {
      admin.value = null;
      return;
    }
    const state = await response.json().catch(() => ({}));
    if (!response.ok || !state?.admin?.email) {
      error.value = t(String(state?.error?.message || '无法连接服务端，请稍后重试。'));
      admin.value = null;
      return;
    }
    admin.value = state.admin as AdminSession;
    if (/\/login\/?$/i.test(window.location.pathname)) {
      const target = window.location.pathname.replace(/\/login\/?$/i, '');
      if (target) window.history.replaceState({}, '', target + window.location.search);
    }
  } catch {
    error.value = t('无法连接服务端，请稍后重试。');
    admin.value = null;
  } finally {
    checking.value = false;
  }
}

function signedIn(next: AdminSession) {
  admin.value = next;
  error.value = '';
  notice.value = '';
}

function signedOut() {
  admin.value = null;
  error.value = '';
  notice.value = t('已退出后台登录。');
}

onMounted(check);
</script>
