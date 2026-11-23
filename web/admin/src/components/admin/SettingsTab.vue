<template>
  <div class="adm-stack">
  <SiteUpdatePanel />
  <section class="adm-card">
    <div class="adm-card-head">
      <div><div class="adm-card-title">{{ t('系统设置') }}</div><div class="adm-card-sub">{{ t('配置保存在主数据库中（默认 SQLite）并立即生效；.env 只在首次启动时导入一次，之后以这里的值为准。') }}</div></div>
      <span class="adm-badge">{{ t('{n} 项待保存', { n: touched.size }) }}</span>
    </div>
    <p v-if="message" class="adm-feedback" :data-tone="message.tone" role="status">{{ message.text }}</p>
    <div v-if="error" class="adm-feedback" data-tone="error" role="alert">{{ error }} <button type="button" class="adm-btn adm-btn-sm" @click="load">{{ t('重试') }}</button></div>
    <p class="adm-note" style="margin-bottom: 8px">{{ t('主机、端口、DATABASE_URL 与 SETUP_TOKEN 等启动变量仍由 ') }}<span class="adm-mono">.env</span>{{ t(' 控制；密钥类配置只显示是否已设置，留空表示保持原值。') }}</p>
    <p v-if="loading && !data" class="adm-note"><span class="adm-spinner" /> {{ t('加载中…') }}</p>
    <template v-if="data">
      <div v-for="group in data.groups" :key="group" class="adm-setting-group">
        <template v-if="settingsIn(group).length">
          <h3>{{ t(group) }}</h3>
          <div v-for="item in settingsIn(group)" :key="item.key" class="adm-setting">
            <div>
              <div class="adm-setting-label">
                {{ t(item.label) }}
                <span class="adm-badge" :data-tone="item.source === 'database' ? 'info' : undefined">{{ SOURCE_LABEL[item.source] }}</span>
                <button v-if="item.source === 'database'" type="button" class="adm-btn adm-btn-sm" :disabled="busy" @click="reset(item.key)">{{ t('恢复默认') }}</button>
                <span v-if="touched.has(item.key)" class="adm-badge" data-tone="warn">{{ t('未保存') }}</span>
              </div>
              <div class="adm-setting-help">{{ t(item.help || item.key) }}{{ item.restart ? t(' · 修改后需要重新构建前端') : '' }}</div>
            </div>
            <div class="adm-setting-control">
              <Select
                v-if="item.type === 'bool'"
                class-name="adm-select"
                :aria-label="t(item.label)"
                :model-value="currentValue(item) === 'true' ? 'true' : 'false'"
                :options="[{ value: 'true', label: t('开启') }, { value: 'false', label: tIn('admin', '关闭') }]"
                @update:model-value="change(item.key, $event)"
              />
              <Select
                v-else-if="item.type === 'enum'"
                class-name="adm-select"
                :aria-label="t(item.label)"
                :model-value="currentValue(item)"
                :options="(item.choices ?? []).map(choice => ({ value: choice, label: choice }))"
                @update:model-value="change(item.key, $event)"
              />
              <Select
                v-else-if="item.options?.length"
                class-name="adm-select"
                :aria-label="t(item.label)"
                :model-value="currentValue(item)"
                :options="selectOptions(item)"
                @update:model-value="change(item.key, $event)"
              />
              <input v-else-if="item.type === 'secret' || item.secret" class="adm-input" type="password" autocomplete="new-password" :placeholder="item.configured ? t('已配置，留空表示不修改') : t('未配置')" :value="draft[item.key] ?? ''" @input="change(item.key, ($event.target as HTMLInputElement).value)" />
              <input v-else-if="item.type === 'int'" class="adm-input" type="number" :min="item.min" :max="item.max" :value="currentValue(item)" @input="change(item.key, ($event.target as HTMLInputElement).value)" />
              <textarea v-else-if="item.multiline" class="adm-textarea" :value="currentValue(item)" :maxlength="item.max" @input="change(item.key, ($event.target as HTMLTextAreaElement).value)" />
              <input v-else class="adm-input" :value="currentValue(item)" :maxlength="item.max" @input="change(item.key, ($event.target as HTMLInputElement).value)" />
            </div>
          </div>
        </template>
      </div>
    </template>
    <div class="adm-settings-bar">
      <span class="adm-note">{{ t('保存后本进程立即生效；多实例部署最多 10 秒同步。') }}</span>
      <div class="adm-form-inline">
        <button type="button" class="adm-btn" :disabled="busy || !touched.size" @click="discard">{{ t('放弃修改') }}</button>
        <button type="button" class="adm-btn adm-btn-primary" :disabled="busy || !touched.size" @click="save">{{ busy ? t('保存中…') : t('保存修改') }}</button>
      </div>
    </div>
  </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import Select from '../ui/Select.vue';
import SiteUpdatePanel from './SiteUpdatePanel.vue';
import { adminApi, errorMessage, type FeedbackMessage } from '../../lib/admin';
import { DEFAULT_ADMIN_PATH } from '../../lib/adminPath';
import { t, tIn } from '../../lib/i18n';

interface SettingOption { value: string; label: string }
interface SettingItem {
  key: string; group: string; label: string; help?: string;
  type: 'int' | 'bool' | 'text' | 'csv' | 'url' | 'enum' | 'secret' | 'link' | 'version';
  default: string; min?: number; max?: number; choices?: string[];
  secret?: boolean; restart?: boolean; multiline?: boolean;
  value?: string; configured: boolean; source: 'database' | 'env' | 'default';
  options?: SettingOption[];
}
interface SettingsData { groups: string[]; settings: SettingItem[] }
const SOURCE_LABEL = { database: t('后台配置'), env: '.env', default: t('默认值') } as const;
const data = ref<SettingsData | null>(null);
const error = ref('');
const loading = ref(true);
const draft = ref<Record<string, string>>({});
const touched = ref(new Set<string>());
const busy = ref(false);
const message = ref<FeedbackMessage>(null);
function settingsIn(group: string) { return (data.value?.settings ?? []).filter(item => item.group === group); }
function currentValue(item: SettingItem) { return draft.value[item.key] ?? item.value ?? item.default; }
// Model defaults keep an explicit "built-in" option, and a stored upstream ID
// that is no longer in the catalog stays visible instead of looking cleared.
function selectOptions(item: SettingItem) {
  const options: SettingOption[] = [{ value: '', label: t('内置默认') }, ...(item.options ?? [])];
  const current = currentValue(item);
  if (current && !options.some(option => option.value === current)) {
    options.push({ value: current, label: t('{value}（当前值）', { value: current }) });
  }
  return options;
}
function change(key: string, value: string) {
  draft.value = { ...draft.value, [key]: value };
  const next = new Set(touched.value);
  next.add(key);
  touched.value = next;
}
async function load() {
  loading.value = true;
  try {
    data.value = await adminApi<SettingsData>('/api/admin/settings');
    draft.value = {}; touched.value = new Set(); error.value = '';
  } catch (failure) { error.value = errorMessage(failure, '加载失败。'); }
  finally { loading.value = false; }
}
function discard() { draft.value = {}; touched.value = new Set(); message.value = null; }
async function save() {
  if (!data.value) return;
  const values: Record<string, string> = {};
  for (const key of touched.value) {
    const def = data.value.settings.find(item => item.key === key);
    if (!def) continue;
    const value = draft.value[key] ?? '';
    if ((def.secret || def.type === 'secret') && !value.trim()) continue;
    values[key] = value;
  }
  if (!Object.keys(values).length) { message.value = { tone: 'error', text: t('没有需要保存的修改。') }; return; }
  busy.value = true; message.value = null;
  const nextEntry = values.ADMIN_PATH?.trim();
  try {
    await adminApi('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ values }) });
    message.value = { tone: 'ok', text: nextEntry
      ? t('已保存 {n} 项配置。新的后台入口是 {path}，原入口已失效，请保存好该地址。', { n: Object.keys(values).length, path: nextEntry })
      : t('已保存 {n} 项配置，立即生效。', { n: Object.keys(values).length }) };
    touched.value = new Set(); draft.value = {};
    if (nextEntry) { window.location.replace(nextEntry); return; }
    await load();
  } catch (failure) { message.value = { tone: 'error', text: errorMessage(failure, '保存失败。') }; }
  finally { busy.value = false; }
}
async function reset(key: string) {
  if (!window.confirm(t('恢复为 .env 或内置默认值？'))) return;
  busy.value = true; message.value = null;
  try {
    await adminApi('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ reset: [key] }) });
    message.value = { tone: 'ok', text: t('已恢复默认配置。') };
    if (key === 'ADMIN_PATH') { window.location.replace(DEFAULT_ADMIN_PATH); return; }
    const next = new Set(touched.value); next.delete(key); touched.value = next;
    const nextDraft = { ...draft.value }; delete nextDraft[key]; draft.value = nextDraft;
    await load();
  } catch (failure) { message.value = { tone: 'error', text: errorMessage(failure, '恢复失败。') }; }
  finally { busy.value = false; }
}
onMounted(load);
</script>
