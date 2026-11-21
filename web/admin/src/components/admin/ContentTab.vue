<template>
  <div class="adm-stack">
    <section class="adm-card">
      <div class="adm-card-head">
        <div><div class="adm-card-title">{{ t('生成消耗与作品') }}</div><div class="adm-card-sub">{{ t('仅统计登录账号；游客生成不写入积分账本。') }}</div></div>
        <span v-if="generations" class="adm-badge" data-tone="info">{{ t('{gen} 次生成 · {points} 积分 · {records} 条作品', { gen: generations.totals.generations, points: generations.totals.points, records: generations.totals.records }) }}</span>
      </div>
      <div v-if="generationError" class="adm-feedback" data-tone="error" role="alert">{{ generationError }} <button type="button" class="adm-btn adm-btn-sm" @click="loadGenerations">{{ t('重试') }}</button></div>
      <p v-if="generationLoading && !generations" class="adm-note"><span class="adm-spinner" /> {{ t('加载中…') }}</p>
      <div v-if="generations?.spends.length" class="adm-table-wrap">
        <table class="adm-table">
          <thead><tr><th>{{ t('时间') }}</th><th>{{ t('账号') }}</th><th class="num">{{ t('消耗') }}</th><th>{{ t('生成编号') }}</th></tr></thead>
          <tbody><tr v-for="row in generations.spends" :key="row.id"><td class="muted">{{ adminWhen(row.createdAt) }}</td><td>{{ row.email }}</td><td class="num">{{ -row.delta }}</td><td class="adm-mono muted">{{ row.refId }}</td></tr></tbody>
        </table>
      </div>
      <div v-else-if="generations" class="adm-empty">{{ t('暂无生成消耗记录。') }}</div>
      <div v-if="generations" class="adm-pagination">
        <button type="button" class="adm-btn adm-btn-sm" :disabled="generationPage <= 1" @click="generationPage = Math.max(1, generationPage - 1)">{{ t('上一页') }}</button>
        <span>{{ t('第 {page} 页', { page: generationPage }) }}</span>
        <button type="button" class="adm-btn adm-btn-sm" :disabled="!generations.nextPage" @click="generationPage = generations.nextPage ?? generationPage">{{ t('下一页') }}</button>
      </div>
      <template v-if="generations?.records.length">
        <div class="adm-card-head" style="margin-top: 20px"><div class="adm-card-title">{{ t('最近作品记录') }}</div></div>
        <div class="adm-table-wrap">
          <table class="adm-table">
            <thead><tr><th>{{ t('账号') }}</th><th>{{ t('作品编号') }}</th><th>{{ t('更新时间') }}</th></tr></thead>
            <tbody><tr v-for="row in generations.records" :key="row.key"><td>{{ row.email }}</td><td class="adm-mono">{{ row.recordId }}</td><td class="muted">{{ adminWhen(row.updatedAt) }}</td></tr></tbody>
          </table>
        </div>
      </template>
    </section>

    <section class="adm-card">
      <div class="adm-card-head">
        <div><div class="adm-card-title">{{ t('媒体对象') }}</div><div class="adm-card-sub">{{ t('共 {n} 个 · 占用 {size}', { n: media?.total ?? '—', size: adminBytes(media?.bytes ?? 0) }) }}</div></div>
        <form class="adm-form-inline" @submit.prevent="searchMedia">
          <input v-model="mediaInput" class="adm-input" :placeholder="t('搜索账号、类型或媒体 ID')" :aria-label="t('搜索媒体')" />
          <button type="submit" class="adm-btn adm-btn-sm">{{ t('搜索') }}</button>
        </form>
      </div>
      <p v-if="mediaMessage" class="adm-feedback" :data-tone="mediaMessage.tone" role="status">{{ mediaMessage.text }}</p>
      <div v-if="mediaError" class="adm-feedback" data-tone="error" role="alert">{{ mediaError }} <button type="button" class="adm-btn adm-btn-sm" @click="loadMedia">{{ t('重试') }}</button></div>
      <p v-if="mediaLoading && !media" class="adm-note"><span class="adm-spinner" /> {{ t('加载中…') }}</p>
      <div v-if="media?.media.length" class="adm-table-wrap">
        <table class="adm-table">
          <thead><tr><th>{{ t('媒体 ID') }}</th><th>{{ t('归属') }}</th><th>{{ t('类型') }}</th><th class="num">{{ t('大小') }}</th><th>{{ t('时间') }}</th><th /></tr></thead>
          <tbody>
            <tr v-for="row in media.media" :key="row.id">
              <td class="adm-mono">{{ row.id.slice(0, 8) }}…</td>
              <td>{{ row.ownerEmail || row.owner }}</td>
              <td class="muted">{{ row.mime }}</td>
              <td class="num">{{ adminBytes(row.size) }}</td>
              <td class="muted">{{ adminWhen(row.createdAt) }}</td>
              <td><button type="button" class="adm-btn adm-btn-sm adm-btn-danger" :disabled="busy === row.id" @click="removeMedia(row.id)">{{ t('删除') }}</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else-if="media" class="adm-empty">{{ t('没有匹配的媒体对象。') }}</div>
      <div v-if="media" class="adm-pagination">
        <button type="button" class="adm-btn adm-btn-sm" :disabled="mediaPage <= 1" @click="mediaPage = Math.max(1, mediaPage - 1)">{{ t('上一页') }}</button>
        <span>{{ t('第 {page} 页', { page: mediaPage }) }}</span>
        <button type="button" class="adm-btn adm-btn-sm" :disabled="!media.nextPage" @click="mediaPage = media.nextPage ?? mediaPage">{{ t('下一页') }}</button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { adminApi, adminBytes, adminWhen, errorMessage, type FeedbackMessage } from '../../lib/admin';
import { t } from '../../lib/i18n';

interface GenerationsData {
  spends: { id: string; email: string; delta: number; refId: string; createdAt: number }[];
  totals: { generations: number; points: number; records: number };
  records: { key: string; email: string; recordId: string; updatedAt: number }[];
  nextPage: number | null;
}
interface MediaData {
  media: { id: string; owner: string; ownerEmail: string; mime: string; size: number; createdAt: number }[];
  total: number; bytes: number; nextPage: number | null;
}
const generations = ref<GenerationsData | null>(null);
const media = ref<MediaData | null>(null);
const generationError = ref('');
const mediaError = ref('');
const generationLoading = ref(true);
const mediaLoading = ref(true);
const generationPage = ref(1);
const mediaPage = ref(1);
const mediaInput = ref('');
const mediaQuery = ref('');
const mediaMessage = ref<FeedbackMessage>(null);
const busy = ref('');
async function loadGenerations() {
  generationLoading.value = true;
  try { generations.value = await adminApi<GenerationsData>(`/api/admin/generations?page=${generationPage.value}`); generationError.value = ''; }
  catch (failure) { generationError.value = errorMessage(failure, '加载失败。'); }
  finally { generationLoading.value = false; }
}
async function loadMedia() {
  mediaLoading.value = true;
  try { media.value = await adminApi<MediaData>(`/api/admin/media?page=${mediaPage.value}&q=${encodeURIComponent(mediaQuery.value)}`); mediaError.value = ''; }
  catch (failure) { mediaError.value = errorMessage(failure, '加载失败。'); }
  finally { mediaLoading.value = false; }
}
function searchMedia() { mediaPage.value = 1; mediaQuery.value = mediaInput.value.trim(); void loadMedia(); }
async function removeMedia(id: string) {
  if (!window.confirm(t('删除后对象存储中的文件也会被移除，作品中的引用将无法再打开。确认删除？'))) return;
  busy.value = id; mediaMessage.value = null;
  try {
    await adminApi(`/api/admin/media/${encodeURIComponent(id)}`, { method: 'DELETE' });
    mediaMessage.value = { tone: 'ok', text: t('媒体已删除。') };
    await loadMedia();
  } catch (failure) { mediaMessage.value = { tone: 'error', text: errorMessage(failure, '删除失败。') }; }
  finally { busy.value = ''; }
}
watch(generationPage, loadGenerations);
watch(mediaPage, loadMedia);
onMounted(() => { void loadGenerations(); void loadMedia(); });
</script>
