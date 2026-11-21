<template>
  <div class="adm-stack">
    <div v-if="error" class="adm-feedback" data-tone="error" role="alert">{{ error }} <button type="button" class="adm-btn adm-btn-sm" @click="load">{{ t('重试') }}</button></div>
    <p v-if="loading && !data" class="adm-note"><span class="adm-spinner" /> {{ t('加载中…') }}</p>
    <template v-if="data">
      <div class="adm-stats">
        <div v-for="stat in stats" :key="stat.label" class="adm-stat">
          <div class="adm-stat-value">{{ stat.value.toLocaleString(intlLocale()) }}</div>
          <div class="adm-stat-label">{{ stat.label }}</div>
          <div v-if="stat.hint" class="adm-stat-hint">{{ stat.hint }}</div>
        </div>
      </div>
      <section class="adm-card">
        <div class="adm-card-head">
          <div><div class="adm-card-title">{{ t('近 14 天积分消耗') }}</div><div class="adm-card-sub">{{ t('柱高表示当日生成消耗的积分；游客生成不计入积分账本。') }}</div></div>
          <span class="adm-badge" data-tone="info">{{ t('作品记录 {n}', { n: data.records }) }}</span>
        </div>
        <div v-if="data.series.some(row => row.points > 0)" class="adm-chart" role="img" :aria-label="t('近 14 天积分消耗柱状图')">
          <div v-for="row in data.series" :key="row.day" class="adm-bar-wrap" :title="t('{day}：{points} 积分 / {count} 次', { day: row.day, points: row.points, count: row.generations })">
            <div class="adm-bar" :data-empty="row.points === 0" :style="{ height: `${Math.max(2, row.points / peak * 118)}px` }" />
            <span class="adm-bar-label">{{ row.day.slice(5) }}</span>
          </div>
        </div>
        <div v-else class="adm-empty">{{ t('最近 14 天还没有登录账号的生成消耗。') }}</div>
      </section>
      <section class="adm-card">
        <div class="adm-card-head"><div class="adm-card-title">{{ t('最新账号') }}</div></div>
        <div v-if="!data.recentUsers.length" class="adm-empty">{{ t('暂无账号。') }}</div>
        <div v-else class="adm-table-wrap">
          <table class="adm-table">
            <thead><tr><th>{{ t('邮箱') }}</th><th>{{ t('注册时间') }}</th><th class="num">{{ t('积分') }}</th></tr></thead>
            <tbody><tr v-for="row in data.recentUsers" :key="row.id"><td>{{ row.email }}</td><td class="muted">{{ adminWhen(row.createdAt) }}</td><td class="num">{{ row.balance }}</td></tr></tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { adminApi, adminBytes, adminWhen, errorMessage } from '../../lib/admin';
import { intlLocale, t } from '../../lib/i18n';

interface OverviewData {
  users: { total: number; today: number; week: number };
  points: { circulating: number; issued: number; spent: number };
  today: { generations: number; points: number };
  invites: { total: number; rewarded: number };
  media: { count: number; bytes: number };
  records: number;
  reports: { open: number };
  series: { day: string; points: number; generations: number }[];
  recentUsers: { id: string; email: string; createdAt: number; balance: number }[];
}
const data = ref<OverviewData | null>(null);
const error = ref('');
const loading = ref(true);
const peak = computed(() => Math.max(1, ...(data.value?.series ?? []).map(row => row.points)));
const stats = computed(() => {
  const value = data.value;
  if (!value) return [];
  return [
    { label: t('账号总数'), value: value.users.total, hint: t('今日 +{today} · 近 7 天 +{week}', { today: value.users.today, week: value.users.week }) },
    { label: t('流通积分'), value: value.points.circulating, hint: t('累计发放 {issued}', { issued: value.points.issued }) },
    { label: t('今日消耗'), value: value.today.points, hint: t('{n} 次生成', { n: value.today.generations }) },
    { label: t('累计消耗'), value: value.points.spent, hint: t('登录账号的积分扣费') },
    { label: t('邀请关系'), value: value.invites.total, hint: t('已发放 {n}', { n: value.invites.rewarded }) },
    { label: t('媒体对象'), value: value.media.count, hint: adminBytes(value.media.bytes) },
    { label: t('待处理举报'), value: value.reports?.open ?? 0, hint: t('在举报页处理') },
  ];
});
async function load() {
  loading.value = true;
  try { data.value = await adminApi<OverviewData>('/api/admin/overview'); error.value = ''; }
  catch (failure) { error.value = errorMessage(failure, '加载失败。'); }
  finally { loading.value = false; }
}
onMounted(load);
</script>
