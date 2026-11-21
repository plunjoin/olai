<template>
  <section class="adm-card">
    <div class="adm-card-head">
      <div class="adm-card-title">{{ t('操作日志') }}</div>
      <form class="adm-form-inline" @submit.prevent="searchLogs">
        <input v-model="input" class="adm-input" :placeholder="t('搜索操作、管理员或目标')" :aria-label="t('搜索日志')" />
        <button type="submit" class="adm-btn adm-btn-sm">{{ t('搜索') }}</button>
      </form>
    </div>
    <div v-if="error" class="adm-feedback" data-tone="error" role="alert">{{ error }} <button type="button" class="adm-btn adm-btn-sm" @click="load">{{ t('重试') }}</button></div>
    <p v-if="loading && !data" class="adm-note"><span class="adm-spinner" /> {{ t('加载中…') }}</p>
    <div v-if="data?.logs.length" class="adm-table-wrap">
      <table class="adm-table">
        <thead><tr><th>{{ t('时间') }}</th><th>{{ t('管理员') }}</th><th>{{ t('操作') }}</th><th>{{ t('目标') }}</th><th>{{ t('详情') }}</th><th>IP</th></tr></thead>
        <tbody><tr v-for="row in data.logs" :key="row.id"><td class="muted">{{ adminWhen(row.createdAt) }}</td><td>{{ row.adminEmail }}</td><td>{{ ADMIN_ACTIONS[row.action] || row.action }}</td><td class="adm-mono muted">{{ row.target }}</td><td class="muted" style="max-width: 280px; word-break: break-all">{{ row.detail }}</td><td class="adm-mono muted">{{ row.ip }}</td></tr></tbody>
      </table>
    </div>
    <div v-else-if="data" class="adm-empty">{{ t('暂无操作日志。') }}</div>
    <div class="adm-pagination">
      <button type="button" class="adm-btn adm-btn-sm" :disabled="page <= 1" @click="page = Math.max(1, page - 1)">{{ t('上一页') }}</button>
      <span>{{ t('第 {page} 页 · 共 {n} 条', { page, n: data?.total ?? '—' }) }}</span>
      <button type="button" class="adm-btn adm-btn-sm" :disabled="!data?.nextPage" @click="page = data?.nextPage ?? page">{{ t('下一页') }}</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { ADMIN_ACTIONS, adminApi, adminWhen, errorMessage } from '../../lib/admin';
import { t } from '../../lib/i18n';

interface LogsData {
  logs: { id: string; adminEmail: string; action: string; target: string; detail: string; ip: string; createdAt: number }[];
  total: number; nextPage: number | null;
}
const data = ref<LogsData | null>(null);
const error = ref('');
const loading = ref(true);
const page = ref(1);
const input = ref('');
const query = ref('');
async function load() {
  loading.value = true;
  try { data.value = await adminApi<LogsData>(`/api/admin/logs?page=${page.value}&q=${encodeURIComponent(query.value)}`); error.value = ''; }
  catch (failure) { error.value = errorMessage(failure, '加载失败。'); }
  finally { loading.value = false; }
}
function searchLogs() { page.value = 1; query.value = input.value.trim(); void load(); }
watch(page, load);
onMounted(load);
</script>
