<template>
  <section class="adm-card">
    <div class="adm-card-head">
      <div>
        <div class="adm-card-title">{{ t('作品举报') }}</div>
        <div class="adm-card-sub">{{ t('处理作品广场中的举报；隐藏后作品会立即从广场、收藏与公开媒体中移除。') }}</div>
      </div>
      <div class="adm-form-inline">
        <Select v-model="status" :options="statusOptions" :aria-label="t('筛选举报状态')" />
        <button type="button" class="adm-btn adm-btn-sm" :disabled="loading" @click="load">{{ t('刷新') }}</button>
      </div>
    </div>

    <p v-if="message" class="adm-feedback" :data-tone="message.tone" role="status">{{ message.text }}</p>
    <div v-if="error" class="adm-feedback" data-tone="error" role="alert">{{ error }} <button type="button" class="adm-btn adm-btn-sm" @click="load">{{ t('重试') }}</button></div>
    <p v-if="loading && !data" class="adm-note"><span class="adm-spinner" /> {{ t('加载中…') }}</p>

    <div v-if="data?.reports.length" class="adm-table-wrap">
      <table class="adm-table">
        <thead><tr><th>{{ t('时间') }}</th><th>{{ t('作品') }}</th><th>{{ t('举报人') }}</th><th>{{ t('原因') }}</th><th>{{ t('状态') }}</th><th>{{ t('操作') }}</th></tr></thead>
        <tbody>
          <tr v-for="row in data.reports" :key="row.id">
            <td class="muted adm-report-time">{{ adminWhen(row.createdAt) }}</td>
            <td class="adm-report-work">
              <strong :title="row.work.prompt">{{ row.work.prompt || t('作品已删除或无法读取') }}</strong>
              <small>{{ kindName(row.work.kind) }} · {{ row.work.ownerEmail || t('未知账号') }}</small>
              <span v-if="row.work.hidden" class="adm-badge" data-tone="danger">{{ t('已隐藏') }}</span>
              <span v-if="row.work.status && row.work.status !== 'completed'" class="adm-badge" data-tone="warn">{{ t('未完成') }}</span>
            </td>
            <td>
              <span>{{ row.reporterEmail || t('游客') }}</span>
            </td>
            <td class="adm-report-reason">
              <strong>{{ REPORT_REASONS[row.reason] || row.reason }}</strong>
              <small v-if="row.detail" :title="row.detail">{{ row.detail }}</small>
            </td>
            <td>
              <span class="adm-badge" :data-tone="statusTone(row.status)">{{ REPORT_STATUS[row.status] || row.status }}</span>
              <small v-if="row.handledBy" class="adm-report-handler">{{ row.handledBy }}</small>
            </td>
            <td>
              <div class="adm-report-actions">
                <button v-if="row.status === 'open'" type="button" class="adm-btn adm-btn-sm" :disabled="busy === row.id" @click="act(row, 'resolve')">{{ t('标记已处理') }}</button>
                <button v-if="row.status === 'open'" type="button" class="adm-btn adm-btn-sm" :disabled="busy === row.id" @click="act(row, 'dismiss')">{{ t('忽略') }}</button>
                <button v-if="row.work.hidden" type="button" class="adm-btn adm-btn-sm" :disabled="busy === row.id" @click="act(row, 'unhide')">{{ t('恢复显示') }}</button>
                <button v-else type="button" class="adm-btn adm-btn-sm adm-btn-danger" :disabled="busy === row.id" @click="act(row, 'hide')">{{ t('隐藏作品') }}</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else-if="data" class="adm-empty">{{ t('当前筛选下没有举报记录。') }}</div>

    <div v-if="data" class="adm-pagination">
      <button type="button" class="adm-btn adm-btn-sm" :disabled="page <= 1" @click="page = Math.max(1, page - 1)">{{ t('上一页') }}</button>
      <span>{{ t('第 {page} 页 · 共 {n} 条', { page, n: data.total }) }}</span>
      <button type="button" class="adm-btn adm-btn-sm" :disabled="!data.nextPage" @click="page = data.nextPage ?? page">{{ t('下一页') }}</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import Select from '../ui/Select.vue';
import { adminApi, adminWhen, errorMessage, MODEL_KIND_NAMES, REPORT_REASONS, REPORT_STATUS, type FeedbackMessage } from '../../lib/admin';
import { t } from '../../lib/i18n';

interface WorkInfo {
  recordKey: string; assetId: string; hidden: boolean; exists: boolean;
  ownerEmail?: string; userId?: string; kind?: string; prompt?: string; status?: string;
}
interface ReportRow {
  id: string; recordKey: string; reason: string; detail: string; status: string;
  reporterEmail: string; reporterId: string; createdAt: number;
  handledAt: number | null; handledBy: string; work: WorkInfo;
}
interface ReportsData { reports: ReportRow[]; total: number; open: number; nextPage: number | null }

const data = ref<ReportsData | null>(null);
const error = ref('');
const loading = ref(true);
const page = ref(1);
const status = ref('open');
const message = ref<FeedbackMessage>(null);
const busy = ref('');
const statusOptions = computed(() => [
  { value: 'open', label: t('待处理（{n}）', { n: data.value?.open ?? 0 }) },
  { value: 'resolved', label: t('已处理') },
  { value: 'dismissed', label: t('已忽略') },
  { value: 'all', label: t('全部') },
]);

function kindName(kind?: string) {
  return (kind && MODEL_KIND_NAMES[kind]) || '—';
}
function statusTone(value: string) {
  if (value === 'open') return 'warn';
  if (value === 'resolved') return 'ok';
  return 'info';
}
async function load() {
  loading.value = true;
  message.value = null;
  try {
    data.value = await adminApi<ReportsData>(`/api/admin/reports?page=${page.value}&status=${encodeURIComponent(status.value)}`);
    error.value = '';
  } catch (failure) {
    error.value = errorMessage(failure, '加载失败。');
  } finally {
    loading.value = false;
  }
}
async function act(row: ReportRow, action: 'resolve' | 'dismiss' | 'hide' | 'unhide') {
  if (busy.value) return;
  if (action === 'hide' && !window.confirm(t('隐藏后该作品会立即从作品广场、收藏和公开媒体中消失，但作者仍可在自己的库中看到。确认隐藏？'))) return;
  busy.value = row.id;
  message.value = null;
  try {
    await adminApi(`/api/admin/reports/${encodeURIComponent(row.id)}`, { method: 'POST', body: JSON.stringify({ action }) });
    message.value = {
      tone: 'ok',
      text: action === 'hide' ? t('作品已隐藏，相关举报已标记为已处理。')
        : action === 'unhide' ? t('作品已恢复显示。')
        : action === 'resolve' ? t('举报已标记为已处理。') : t('举报已忽略。'),
    };
    await load();
  } catch (failure) {
    message.value = { tone: 'error', text: errorMessage(failure, '操作失败。') };
  } finally {
    busy.value = '';
  }
}
watch(page, load);
watch(status, () => {
  if (page.value !== 1) page.value = 1;
  else void load();
});
onMounted(load);
</script>
