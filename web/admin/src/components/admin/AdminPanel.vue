<template>
  <div class="adm-shell">
    <header class="adm-header">
      <div class="adm-brand"><span class="adm-brand-mark">O</span><span>{{ t('Olai 管理后台') }}<small>ADMIN CONSOLE</small></span></div>
      <div class="adm-header-right">
        <span v-if="version" class="adm-build" :title="t('服务端当前版本')">{{ version === 'dev' ? 'dev' : `v${version}` }}</span>
        <span>{{ email }}</span>
        <button type="button" class="adm-btn adm-btn-sm" @click="passwordOpen = true">{{ t('修改密码') }}</button>
        <button type="button" class="adm-btn adm-btn-sm" :disabled="busy" @click="logout">{{ t('退出登录') }}</button>
      </div>
    </header>
    <PasswordDialog v-if="passwordOpen" @close="passwordOpen = false" />
    <nav class="adm-tabs" role="tablist" :aria-label="t('管理后台分区')">
      <button v-for="[key, label] in TABS" :key="key" type="button" role="tab" class="adm-tab" :aria-selected="tab === key" @click="tab = key">{{ label }}</button>
    </nav>
    <main class="adm-main">
      <OverviewTab v-if="tab === 'overview'" />
      <UsersTab v-else-if="tab === 'users'" />
      <InvitesTab v-else-if="tab === 'invites'" />
      <ContentTab v-else-if="tab === 'content'" />
      <ReportsTab v-else-if="tab === 'reports'" />
      <ModelsTab v-else-if="tab === 'models'" />
      <SettingsTab v-else-if="tab === 'settings'" />
      <LogsTab v-else-if="tab === 'logs'" />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import OverviewTab from './OverviewTab.vue';
import UsersTab from './UsersTab.vue';
import InvitesTab from './InvitesTab.vue';
import ContentTab from './ContentTab.vue';
import ReportsTab from './ReportsTab.vue';
import ModelsTab from './ModelsTab.vue';
import SettingsTab from './SettingsTab.vue';
import LogsTab from './LogsTab.vue';
import PasswordDialog from './PasswordDialog.vue';
import { t } from '../../lib/i18n';

defineProps<{ email: string; name?: string | null; version?: string }>();
const emit = defineEmits<{ signedOut: [] }>();
type Tab = 'overview' | 'users' | 'invites' | 'content' | 'reports' | 'models' | 'settings' | 'logs';
const TABS: [Tab, string][] = [
  ['overview', t('概览')], ['users', t('用户')], ['invites', t('邀请')], ['content', t('生成与媒体')],
  ['reports', t('举报')], ['models', t('模型与定价')], ['settings', t('系统设置')], ['logs', t('操作日志')],
];
const tab = ref<Tab>('overview');
const passwordOpen = ref(false);
const busy = ref(false);

async function logout() {
  if (busy.value) return;
  busy.value = true;
  try {
    await fetch('/api/admin/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' } });
  } catch {
    // The login screen is still the right place to land; the stale cookie is
    // rejected by the server once it expires or on the next password change.
  } finally {
    busy.value = false;
    emit('signedOut');
  }
}
</script>
