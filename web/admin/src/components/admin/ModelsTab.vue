<template>
  <div class="adm-stack">
    <section class="adm-card">
      <div class="adm-card-head">
        <div>
          <div class="adm-card-title">{{ t('模型定价') }}</div>
          <div class="adm-card-sub">{{ t('从模型网关同步后，可为每个模型单独设置别名与积分价格；每次同步都以网关返回的列表为准，网关中已不存在的模型会被删除。用户只会看到别名与价格，上游模型 ID 不会下发到浏览器。') }}</div>
        </div>
        <div class="adm-form-inline">
          <button type="button" class="adm-btn" :disabled="Boolean(busy)" @click="sync">{{ busy === 'sync' ? t('同步中…') : t('同步网关') }}</button>
          <button type="button" class="adm-btn adm-btn-primary" :disabled="Boolean(busy) || !dirty" @click="save">{{ busy === 'save' ? t('保存中…') : t('保存修改') }}</button>
        </div>
      </div>
      <p v-if="message" class="adm-feedback" :data-tone="message.tone" role="status">{{ message.text }}</p>
      <div v-if="error" class="adm-feedback" data-tone="error" role="alert">{{ error }} <button type="button" class="adm-btn adm-btn-sm" @click="load">{{ t('重试') }}</button></div>
      <p v-if="loading && !data" class="adm-note"><span class="adm-spinner" /> {{ t('加载中…') }}</p>
      <div v-if="!loading && !draft.length" class="adm-empty">{{ t('还没有模型目录。点击“同步网关”从上游拉取，或在下方手动添加。') }}</div>
      <div v-if="draft.length" class="adm-toolbar">
        <Select
          v-model="kindFilter"
          class-name="adm-select"
          :aria-label="t('按类型筛选模型')"
          :options="[{ value: 'all', label: `${t('全部类型')} (${draft.length})` }, ...(data?.kinds ?? []).map(kind => ({ value: kind, label: `${MODEL_KIND_NAMES[kind] ?? kind} (${kindCounts[kind] ?? 0})` }))]"
        />
        <input v-model="search" class="adm-input" :placeholder="t('搜索别名或上游模型 ID')" :aria-label="t('搜索模型')" />
        <span class="adm-card-sub">{{ t('显示 {shown} / {total} 个模型', { shown: visibleRows.length, total: draft.length }) }}</span>
      </div>
      <div v-if="draft.length && !visibleRows.length" class="adm-empty">{{ t('没有匹配的模型。') }}</div>
      <div v-if="visibleRows.length" class="adm-table-wrap">
        <table class="adm-table adm-models">
          <thead><tr><th>{{ t('启用') }}</th><th>{{ t('别名') }}</th><th>{{ t('类型') }}</th><th>{{ t('支持档位') }}</th><th>{{ t('积分价格') }}</th><th>{{ t('上游显示名') }}</th><th>{{ t('上游模型 ID') }}</th></tr></thead>
          <tbody>
            <tr v-for="{ row, index } in visibleRows" :key="row.upstreamId">
              <td><input type="checkbox" class="adm-check" :checked="row.enabled" :aria-label="t('启用 {name}', { name: row.alias })" @change="patch(index, { enabled: ($event.target as HTMLInputElement).checked })" /></td>
              <td><input class="adm-input" :value="row.alias" maxlength="60" :aria-label="t('模型别名')" @input="patch(index, { alias: ($event.target as HTMLInputElement).value })" /></td>
              <td>
                <Select
                  :model-value="row.kind"
                  class-name="adm-select"
                  :aria-label="t('模型类型')"
                  :options="(data?.kinds ?? []).map(kind => ({ value: kind, label: MODEL_KIND_NAMES[kind] ?? kind }))"
                  @update:model-value="changeKind(index, $event)"
                />
              </td>
              <td>
                <div v-if="row.kind === 'image' || row.kind === 'video'" class="adm-tier-options">
                  <label v-for="tier in MODEL_TIERS[row.kind]" :key="tier" class="adm-tier-option">
                    <input
                      type="checkbox"
                      class="adm-check"
                      :checked="row.tiers.includes(tier)"
                      :disabled="row.tiers.length === 1 && row.tiers.includes(tier)"
                      :aria-label="t('支持 {tier}', { tier: tierLabel(tier) })"
                      @change="toggleTier(index, tier, ($event.target as HTMLInputElement).checked)"
                    />
                    <span>{{ tierLabel(tier) }}</span>
                  </label>
                </div>
                <span v-else class="muted">—</span>
              </td>
              <td><ModelPriceFields :row="row" @change="(group, key, value) => changePrice(index, group, key, value)" /></td>
              <td class="muted">{{ row.displayName || '—' }}</td>
              <td class="adm-mono muted">{{ row.upstreamId }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="adm-card-head" style="margin-top: 20px"><div class="adm-card-title">{{ t('手动添加模型') }}</div></div>
      <form class="adm-form-inline" @submit.prevent="add">
        <input v-model="addition.upstreamId" class="adm-input" maxlength="200" :placeholder="t('上游模型 ID')" :aria-label="t('上游模型 ID')" />
        <input v-model="addition.alias" class="adm-input" maxlength="60" :placeholder="t('显示别名')" :aria-label="t('显示别名')" />
        <Select
          v-model="addition.kind"
          class-name="adm-select"
          :aria-label="t('模型类型')"
          :options="(data?.kinds ?? ['chat', 'image', 'video', 'music']).map(kind => ({ value: kind, label: MODEL_KIND_NAMES[kind] ?? kind }))"
        />
        <button type="submit" class="adm-btn">{{ t('添加') }}</button>
      </form>
      <p class="adm-note">{{ t('新增模型默认沿用当前全局档位价；保存后立即生效。停用的模型不再出现在用户端，但仍保留价格配置。手动添加的模型如果不在网关返回列表中，下次同步时会被移除。') }}</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import ModelPriceFields from './ModelPriceFields.vue';
import Select from '../ui/Select.vue';
import { adminApi, errorMessage, MODEL_KIND_NAMES, type FeedbackMessage } from '../../lib/admin';
import type { ModelPrices } from '../../lib/types';
import { t } from '../../lib/i18n';

type ModelKindName = 'chat' | 'image' | 'video' | 'music';
interface AdminModel {
  publicId: string; upstreamId: string; displayName: string | null; alias: string; kind: ModelKindName;
  enabled: boolean; prices: ModelPrices; tiers?: string[];
  updatedAt: number;
}
interface ModelsData { kinds: ModelKindName[]; defaults: Record<string, ModelPrices>; models: AdminModel[] }
type ModelDraft = Pick<AdminModel, 'upstreamId' | 'displayName' | 'alias' | 'kind' | 'enabled' | 'prices'> & { tiers: string[] };
const MODEL_TIERS: Record<ModelKindName, string[]> = {
  chat: [], image: ['1K', '2K', '4K'], video: ['360p', '720p', '1080p', '4k'], music: [],
};
const tierLabel = (tier: string) => tier === '4k' ? '4K' : tier;
function priceBucket(prices: ModelPrices, kind: ModelKindName) {
  return ((prices as Record<string, Record<string, number>>)[kind] ?? {});
}
const data = ref<ModelsData | null>(null);
const draft = ref<ModelDraft[]>([]);
const dirty = ref(false);
const busy = ref('');
const message = ref<FeedbackMessage>(null);
const error = ref('');
const loading = ref(true);
const addition = ref<{ upstreamId: string; alias: string; kind: ModelKindName }>({ upstreamId: '', alias: '', kind: 'chat' });
const kindFilter = ref<'all' | ModelKindName>('all');
const search = ref('');
const kindCounts = computed(() => {
  const counts: Record<string, number> = {};
  for (const row of draft.value) counts[row.kind] = (counts[row.kind] ?? 0) + 1;
  return counts;
});
const visibleRows = computed(() => {
  const needle = search.value.trim().toLowerCase();
  return draft.value
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => kindFilter.value === 'all' || row.kind === kindFilter.value)
    .filter(({ row }) => !needle || [row.alias, row.upstreamId, row.displayName ?? ''].some(value => value.toLowerCase().includes(needle)));
});
async function load() {
  loading.value = true;
  try {
    data.value = await adminApi<ModelsData>('/api/admin/models');
    draft.value = (data.value.models ?? []).map(({ upstreamId, displayName, alias, kind, enabled, prices, tiers }) => ({
      upstreamId, displayName, alias, kind, enabled, prices,
      tiers: tiers?.length ? [...tiers] : [...MODEL_TIERS[kind]],
    }));
    dirty.value = false;
    error.value = '';
  } catch (failure) { error.value = errorMessage(failure, '加载失败。'); }
  finally { loading.value = false; }
}
function patch(index: number, update: Partial<ModelDraft>) {
  draft.value = draft.value.map((row, i) => i === index ? { ...row, ...update } : row);
  dirty.value = true;
}
function changeKind(index: number, kind: string) {
  const next = kind as ModelKindName;
  patch(index, { kind: next, tiers: [...MODEL_TIERS[next]], prices: data.value?.defaults?.[next] ?? {} });
}
function toggleTier(index: number, tier: string, checked: boolean) {
  const row = draft.value[index];
  if (!row) return;
  const next = checked ? [...row.tiers, tier] : row.tiers.filter(value => value !== tier);
  const tiers = MODEL_TIERS[row.kind].filter(value => next.includes(value));
  if (!tiers.length) {
    message.value = { tone: 'error', text: t('每个模型至少需要支持一个档位。') };
    return;
  }
  // Prices are stored for every tier so switching support back on keeps the
  // previous values; fill gaps with the global defaults.
  const defaults = priceBucket(data.value?.defaults?.[row.kind] ?? {}, row.kind);
  const bucket = { ...priceBucket(row.prices, row.kind) };
  for (const value of MODEL_TIERS[row.kind]) {
    if (bucket[value] === undefined) bucket[value] = defaults[value] ?? 0;
  }
  patch(index, { tiers, prices: { ...row.prices, [row.kind]: bucket } });
}
function changePrice(index: number, group: string, key: string, value: number) {
  const row = draft.value[index];
  if (!row) return;
  const prices = row.prices as Record<string, Record<string, number>>;
  const number = Number.isFinite(value) ? value : 0;
  // Chat prices support two decimals; every other price stays a whole point.
  const normalized = group === 'chat' ? Math.round(number * 100) / 100 : Math.trunc(number);
  patch(index, {
    prices: {
      ...row.prices,
      [group]: { ...(prices[group] ?? {}), [key]: Math.max(0, Math.min(1000000, normalized)) },
    },
  });
}
async function save() {
  busy.value = 'save'; message.value = null;
  try {
    await adminApi('/api/admin/models', { method: 'PUT', body: JSON.stringify({ models: draft.value }) });
    dirty.value = false;
    message.value = { tone: 'ok', text: t('模型列表已保存。') };
    await load();
  } catch (failure) { message.value = { tone: 'error', text: errorMessage(failure, '保存失败。') }; }
  finally { busy.value = ''; }
}
async function sync() {
  if (!window.confirm(t('同步会以网关返回的列表为准：网关中已不存在的模型会被删除，未保存的修改会丢失。继续？'))) return;
  busy.value = 'sync'; message.value = null;
  try {
    const result = await adminApi<ModelsData & { sync: { added: number; removed: number; updated: number; upstream: number } }>('/api/admin/models', { method: 'POST' });
    message.value = { tone: 'ok', text: t('已同步 {n} 个上游模型，新增 {added} 个，移除 {removed} 个。', { n: result.sync.upstream, added: result.sync.added, removed: result.sync.removed }) };
    await load();
  } catch (failure) { message.value = { tone: 'error', text: errorMessage(failure, '同步失败。') }; }
  finally { busy.value = ''; }
}
function add() {
  const upstreamId = addition.value.upstreamId.trim();
  const alias = addition.value.alias.trim();
  if (!upstreamId || !alias) { message.value = { tone: 'error', text: t('请填写上游模型 ID 与别名。') }; return; }
  if (draft.value.some(row => row.upstreamId === upstreamId)) { message.value = { tone: 'error', text: t('该模型已在列表中。') }; return; }
  draft.value = [...draft.value, {
    upstreamId, displayName: null, alias, kind: addition.value.kind, enabled: true,
    prices: data.value?.defaults?.[addition.value.kind] ?? {},
    tiers: [...MODEL_TIERS[addition.value.kind]],
  }];
  addition.value = { upstreamId: '', alias: '', kind: 'chat' };
  dirty.value = true; message.value = null;
}
watch(search, () => {});
onMounted(load);
</script>
