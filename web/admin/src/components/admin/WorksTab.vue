<template>
  <section class="adm-card">
    <div class="adm-card-head">
      <div>
        <div class="adm-card-title">{{ t('作品管理') }}</div>
        <div class="adm-card-sub">{{ t('查看全部作品；可以发布官方作品，也可以修改、隐藏或删除任意作品。') }}</div>
      </div>
      <div class="adm-form-inline">
        <button type="button" class="adm-btn adm-btn-sm adm-btn-primary" @click="openCreate">{{ t('发布作品') }}</button>
      </div>
    </div>

    <form class="adm-form-inline adm-work-filters" @submit.prevent="applySearch">
      <input v-model="queryInput" class="adm-input" :placeholder="t('搜索作品名称、编号或作者邮箱')" :aria-label="t('搜索作品')" />
      <Select v-model="kind" :options="kindOptions" :aria-label="t('作品类型')" />
      <Select v-model="visibility" :options="visibilityOptions" :aria-label="t('可见性')" />
      <Select v-model="hidden" :options="hiddenOptions" :aria-label="t('显示状态')" />
      <button type="submit" class="adm-btn adm-btn-sm">{{ t('搜索') }}</button>
    </form>

    <p v-if="message" class="adm-feedback" :data-tone="message.tone" role="status">{{ message.text }}</p>
    <div v-if="error" class="adm-feedback" data-tone="error" role="alert">{{ error }} <button type="button" class="adm-btn adm-btn-sm" @click="load">{{ t('重试') }}</button></div>
    <p v-if="loading && !data" class="adm-note"><span class="adm-spinner" /> {{ t('加载中…') }}</p>

    <div v-if="data?.works.length" class="adm-table-wrap">
      <table class="adm-table">
        <thead><tr><th>{{ t('作品') }}</th><th>{{ t('类型') }}</th><th>{{ t('作者') }}</th><th>{{ t('可见性') }}</th><th>{{ t('状态') }}</th><th>{{ t('更新时间') }}</th><th>{{ t('操作') }}</th></tr></thead>
        <tbody>
          <tr v-for="row in data.works" :key="row.id">
            <td class="adm-work-cell">
              <strong :title="row.title">{{ row.title || t('未命名作品') }}</strong>
              <small class="adm-mono">{{ row.recordId }}</small>
            </td>
            <td>{{ kindName(row.kind) }}</td>
            <td>
              <span>{{ row.email || t('未知账号') }}</span>
              <span v-if="row.system" class="adm-badge" data-tone="info">{{ t('官方作品') }}</span>
            </td>
            <td><span class="adm-badge" :data-tone="row.visibility === 'private' ? 'warn' : 'ok'">{{ row.visibility === 'private' ? t('私密') : t('公开') }}</span></td>
            <td><span v-if="row.hidden" class="adm-badge" data-tone="danger">{{ t('已隐藏') }}</span><span v-else class="adm-badge" data-tone="ok">{{ t('正常') }}</span></td>
            <td class="muted">{{ adminWhen(row.updatedAt) }}</td>
            <td>
              <div class="adm-report-actions">
                <button type="button" class="adm-btn adm-btn-sm" :disabled="busy === row.id" @click="openEdit(row)">{{ t('编辑') }}</button>
                <button v-if="row.hidden" type="button" class="adm-btn adm-btn-sm" :disabled="busy === row.id" @click="toggleHidden(row)">{{ t('恢复显示') }}</button>
                <button v-else type="button" class="adm-btn adm-btn-sm" :disabled="busy === row.id" @click="toggleHidden(row)">{{ t('隐藏') }}</button>
                <button type="button" class="adm-btn adm-btn-sm adm-btn-danger" :disabled="busy === row.id" @click="remove(row)">{{ t('删除') }}</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else-if="data" class="adm-empty">{{ filtered || data.total ? t('当前筛选下没有匹配的作品。') : t('还没有作品，发布第一件吧。') }}</div>

    <div v-if="data" class="adm-pagination">
      <button type="button" class="adm-btn adm-btn-sm" :disabled="page <= 1" @click="goPage(page - 1)">{{ t('上一页') }}</button>
      <span>{{ t('第 {page} 页 · 共 {n} 条', { page, n: data.total }) }}</span>
      <button type="button" class="adm-btn adm-btn-sm" :disabled="!data.nextPage" @click="goPage(data.nextPage ?? page)">{{ t('下一页') }}</button>
    </div>

    <WorkDialog v-if="dialogOpen" :work="editing" @close="dialogOpen = false" @saved="onSaved" />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import Select from '../ui/Select.vue';
import WorkDialog from './WorkDialog.vue';
import { adminApi, adminWhen, errorMessage, MODEL_KIND_NAMES, type AdminWork, type FeedbackMessage } from '../../lib/admin';
import { t } from '../../lib/i18n';

interface WorksData { works: AdminWork[]; total: number; nextPage: number | null }

const data = ref<WorksData | null>(null);
const error = ref('');
const loading = ref(true);
const page = ref(1);
const query = ref('');
const queryInput = ref('');
const kind = ref('all');
const visibility = ref('all');
const hidden = ref('all');
const message = ref<FeedbackMessage>(null);
const busy = ref('');
const dialogOpen = ref(false);
const editing = ref<AdminWork | null>(null);

const kindOptions = computed(() => [
  { value: 'all', label: t('全部类型') },
  { value: 'image', label: MODEL_KIND_NAMES.image },
  { value: 'video', label: MODEL_KIND_NAMES.video },
  { value: 'music', label: MODEL_KIND_NAMES.music },
]);
const visibilityOptions = computed(() => [
  { value: 'all', label: t('全部可见性') },
  { value: 'public', label: t('公开') },
  { value: 'private', label: t('私密') },
]);
const hiddenOptions = computed(() => [
  { value: 'all', label: t('全部状态') },
  { value: 'visible', label: t('正常') },
  { value: 'hidden', label: t('已隐藏') },
]);
const filtered = computed(() => Boolean(query.value || kind.value !== 'all' || visibility.value !== 'all' || hidden.value !== 'all'));

function kindName(kindValue: string) {
  return MODEL_KIND_NAMES[kindValue] || '—';
}
function applySearch() {
  query.value = queryInput.value.trim();
  page.value = 1;
  void load();
}
function goPage(next: number) {
  if (next === page.value) return;
  page.value = next;
  void load();
}
async function load() {
  loading.value = true;
  message.value = null;
  const params = new URLSearchParams({ page: String(page.value) });
  if (query.value) params.set('q', query.value);
  if (kind.value !== 'all') params.set('kind', kind.value);
  if (visibility.value !== 'all') params.set('visibility', visibility.value);
  if (hidden.value !== 'all') params.set('hidden', hidden.value);
  try {
    data.value = await adminApi<WorksData>(`/api/admin/works?${params.toString()}`);
    error.value = '';
  } catch (failure) {
    error.value = errorMessage(failure, '加载失败。');
  } finally {
    loading.value = false;
  }
}
function openCreate() {
  editing.value = null;
  dialogOpen.value = true;
}
function openEdit(row: AdminWork) {
  editing.value = row;
  dialogOpen.value = true;
}
async function onSaved() {
  const created = !editing.value;
  // New works sort to the top, so jump back to the first page where they show.
  if (created) page.value = 1;
  await load();
  message.value = { tone: 'ok', text: created ? t('作品已发布。') : t('作品已更新。') };
}
async function toggleHidden(row: AdminWork) {
  if (busy.value) return;
  if (!row.hidden && !window.confirm(t('隐藏后该作品会立即从作品广场、收藏和公开媒体中消失，但作者仍可在自己的库中看到。确认隐藏？'))) return;
  busy.value = row.id;
  message.value = null;
  try {
    await adminApi(`/api/admin/works/${encodeURIComponent(row.id)}`, {
      method: 'PUT',
      body: JSON.stringify({ hidden: !row.hidden }),
    });
    await load();
    // The row may have just left the active status filter; do not strand the
    // admin on an empty page while matching works sit on the previous one.
    if (data.value && !data.value.works.length && page.value > 1) {
      page.value -= 1;
      await load();
    }
    message.value = { tone: 'ok', text: row.hidden ? t('作品已恢复显示。') : t('作品已隐藏。') };
  } catch (failure) {
    message.value = { tone: 'error', text: errorMessage(failure, '操作失败。') };
  } finally {
    busy.value = '';
  }
}
async function remove(row: AdminWork) {
  if (busy.value) return;
  if (!window.confirm(t('删除作品后无法恢复，作品会立即从广场消失。确认删除？'))) return;
  busy.value = row.id;
  message.value = null;
  try {
    await adminApi(`/api/admin/works/${encodeURIComponent(row.id)}`, { method: 'DELETE' });
    if (data.value?.works.length === 1 && page.value > 1) page.value -= 1;
    await load();
    message.value = { tone: 'ok', text: t('作品已删除。') };
  } catch (failure) {
    message.value = { tone: 'error', text: errorMessage(failure, '删除失败。') };
  } finally {
    busy.value = '';
  }
}

watch([kind, visibility, hidden], () => {
  page.value = 1;
  void load();
});
onMounted(load);
</script>
