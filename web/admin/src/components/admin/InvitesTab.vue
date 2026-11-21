<template>
  <div class="adm-stack">
    <div v-if="error" class="adm-feedback" data-tone="error" role="alert">{{ error }} <button type="button" class="adm-btn adm-btn-sm" @click="load">{{ t('重试') }}</button></div>
    <p v-if="loading && !data" class="adm-note"><span class="adm-spinner" /> {{ t('加载中…') }}</p>
    <template v-if="data">
      <section class="adm-card">
        <div class="adm-card-head"><div class="adm-card-title">{{ t('邀请排行榜') }}</div><span class="adm-card-sub">{{ t('共 {n} 条邀请关系', { n: data.total }) }}</span></div>
        <div v-if="data.top.length" class="adm-table-wrap">
          <table class="adm-table">
            <thead><tr><th>{{ t('邀请人') }}</th><th class="num">{{ t('邀请人数') }}</th><th class="num">{{ t('已发放奖励') }}</th></tr></thead>
            <tbody><tr v-for="row in data.top" :key="row.inviterId"><td>{{ row.email || row.inviterId }}</td><td class="num">{{ row.total }}</td><td class="num">{{ row.rewarded }}</td></tr></tbody>
          </table>
        </div>
        <div v-else class="adm-empty">{{ t('还没有邀请记录。') }}</div>
      </section>
      <section class="adm-card">
        <div class="adm-card-head"><div class="adm-card-title">{{ t('邀请明细') }}</div></div>
        <div v-if="data.invites.length" class="adm-table-wrap">
          <table class="adm-table">
            <thead><tr><th>{{ t('邀请人') }}</th><th>{{ t('被邀请人') }}</th><th>{{ t('邀请码') }}</th><th>{{ t('时间') }}</th><th>{{ t('状态') }}</th></tr></thead>
            <tbody><tr v-for="row in data.invites" :key="row.id"><td>{{ row.inviterEmail || '—' }}</td><td>{{ row.inviteeEmail || '—' }}</td><td class="adm-mono">{{ row.code }}</td><td class="muted">{{ adminWhen(row.createdAt) }}</td><td><span class="adm-badge" :data-tone="row.rewardedAt ? 'ok' : 'warn'">{{ row.rewardedAt ? t('已发放') : t('待首次生成') }}</span></td></tr></tbody>
          </table>
        </div>
        <div v-else class="adm-empty">{{ t('还没有邀请记录。') }}</div>
        <div class="adm-pagination">
          <button type="button" class="adm-btn adm-btn-sm" :disabled="page <= 1" @click="page = Math.max(1, page - 1)">{{ t('上一页') }}</button>
          <span>{{ t('第 {page} 页 · 共 {n} 条', { page, n: data.total }) }}</span>
          <button type="button" class="adm-btn adm-btn-sm" :disabled="!data.nextPage" @click="page = data.nextPage ?? page">{{ t('下一页') }}</button>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { adminApi, adminWhen, errorMessage } from '../../lib/admin';
import { t } from '../../lib/i18n';

interface InvitesData {
  invites: { id: string; code: string; createdAt: number; rewardedAt: number | null; inviterEmail: string; inviteeEmail: string }[];
  top: { inviterId: string; email: string; total: number; rewarded: number }[];
  total: number; nextPage: number | null;
}
const data = ref<InvitesData | null>(null);
const error = ref('');
const loading = ref(true);
const page = ref(1);
async function load() {
  loading.value = true;
  try { data.value = await adminApi<InvitesData>(`/api/admin/invites?page=${page.value}`); error.value = ''; }
  catch (failure) { error.value = errorMessage(failure, '加载失败。'); }
  finally { loading.value = false; }
}
watch(page, load);
onMounted(load);
</script>
