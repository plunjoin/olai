<template>
  <AppDialog labelled-by="settings-title" class-name="settings-modal" @close="emit('close')">
    <div class="settings-dialog">
      <div class="modal-heading">
        <div class="settings-heading-brand"><BrandLogo :size="44" /><h2 id="settings-title">{{ t('创作偏好') }}</h2></div>
        <button class="icon-button" :aria-label="t('关闭设置')" @click="emit('close')"><X :size="20" /></button>
      </div>
      <div class="settings-scroll">
        <div class="settings-section">
          <h3>{{ t('创作服务') }}</h3>
          <p class="muted">{{ t('连接由服务端统一管理，无需在浏览器配置。') }}</p>
          <button class="secondary-button" :disabled="loading" @click="checkConnection">{{ loading ? t('正在检查…') : t('检查连接') }}</button>
        </div>
        <div class="settings-section">
          <h3>{{ t('对话偏好') }}</h3>
          <label class="field-label range-label">
            {{ t('创造性') }} <span>{{ draft.temperature.toFixed(1) }}</span>
            <input v-model.number="draft.temperature" type="range" min="0" max="2" step="0.1" />
          </label>
        </div>

        <div class="settings-section memory-section">
          <h3>
            <Brain :size="16" />{{ t('长期记忆') }}
            <span v-if="cloud" class="memory-count">{{ memoryState.memories.length }} / {{ memoryState.limit }}</span>
          </h3>
          <p class="muted">{{ t('记住你的称呼、偏好和长期目标，让小o在之后的对话里更懂你。') }}</p>

          <div v-if="!cloud" class="memory-guest">
            <LockKeyhole :size="19" />
            <div class="memory-guest-copy">
              <strong>{{ t('登录后开启长期记忆') }}</strong>
              <p>{{ t('记忆保存在你的账号里，换设备也能继续使用。') }}</p>
            </div>
            <a class="secondary-button memory-login" href="/login?next=%2Fchat">{{ t('去登录') }}</a>
          </div>

          <template v-else>
            <div v-if="memoryLoading" class="memory-loading">{{ t('正在加载记忆…') }}</div>
            <div v-else-if="!memoryLoaded" class="memory-error" role="alert">
              <span>{{ memoryError }}</span>
              <button type="button" class="memory-retry" @click="loadMemories">{{ t('重试') }}</button>
            </div>
            <template v-else>
              <div v-if="memoryError" class="memory-error" role="alert">
                <span>{{ memoryError }}</span>
                <button type="button" class="memory-retry" @click="loadMemories">{{ t('重试') }}</button>
              </div>

              <label class="memory-toggle-row">
                <span class="memory-toggle-copy">
                  <strong>{{ t('在对话中使用记忆') }}</strong>
                  <small>{{ t('关闭后，记忆会保留，但不会加入对话。') }}</small>
                </span>
                <input class="memory-switch" type="checkbox" role="switch" :checked="memoryState.enabled" :disabled="memoryBusy" @change="setFlag('enabled', ($event.target as HTMLInputElement).checked)" />
              </label>
              <label class="memory-toggle-row" :class="{ 'is-disabled': !memoryState.enabled }">
                <span class="memory-toggle-copy">
                  <strong>{{ t('自动记住对话中的偏好') }}</strong>
                  <small>{{ t('开启后，每轮回答结束时会额外整理一次记忆。') }}</small>
                </span>
                <input class="memory-switch" type="checkbox" role="switch" :checked="memoryState.autoCapture" :disabled="memoryBusy || !memoryState.enabled" @change="setFlag('autoCapture', ($event.target as HTMLInputElement).checked)" />
              </label>

              <form class="memory-add" @submit.prevent="addMemory">
                <input v-model="newMemory" :maxlength="memoryState.maxLength" :placeholder="t('例如：更喜欢简洁、直接的回答')" :disabled="memoryBusy || memoryState.memories.length >= memoryState.limit" :aria-label="t('添加记忆')" />
                <button class="secondary-button" type="submit" :disabled="memoryBusy || !newMemory.trim() || memoryState.memories.length >= memoryState.limit">{{ addingMemory ? t('处理中…') : t('添加') }}</button>
              </form>
              <p v-if="memoryState.memories.length >= memoryState.limit" class="memory-hint">{{ t('记忆数量已达上限（{n} 条），请先删除不再需要的记忆。', { n: memoryState.limit }) }}</p>

              <ul v-if="memoryState.memories.length" class="memory-list">
                <li v-for="item in memoryState.memories" :key="item.id" class="memory-item" :class="{ 'is-editing': editingId === item.id }">
                  <template v-if="editingId === item.id">
                    <textarea v-model="editingText" :maxlength="memoryState.maxLength" rows="2" :aria-label="t('编辑记忆')"></textarea>
                    <div class="memory-edit-actions">
                      <span class="memory-edit-count">{{ editingText.length }} / {{ memoryState.maxLength }}</span>
                      <button type="button" class="secondary-button small" :disabled="memoryBusy" @click="cancelEdit">{{ t('取消') }}</button>
                      <button type="button" class="primary-button small" :disabled="memoryBusy || !editingText.trim()" @click="saveEdit(item)">{{ t('保存') }}</button>
                    </div>
                  </template>
                  <template v-else>
                    <div class="memory-item-body">
                      <p>{{ item.content }}</p>
                      <span class="memory-source" :class="item.source">{{ item.source === 'auto' ? t('自动记录') : t('手动添加') }}</span>
                    </div>
                    <div class="memory-item-actions">
                      <button type="button" class="icon-button" :aria-label="t('编辑记忆')" :title="t('编辑记忆')" :disabled="memoryBusy" @click="startEdit(item)"><Pencil :size="14" /></button>
                      <button type="button" class="icon-button danger-hover" :aria-label="t('删除记忆')" :title="t('删除记忆')" :disabled="memoryBusy" @click="removeMemory(item)"><Trash2 :size="14" /></button>
                    </div>
                  </template>
                </li>
              </ul>
              <div v-else class="memory-empty">
                <Sparkles :size="16" />
                <p>{{ t('还没有记忆。添加一条，或开启自动记录。') }}</p>
              </div>
              <button v-if="memoryState.memories.length" type="button" class="memory-clear" @click="clearAll">{{ t('清空全部记忆') }}</button>
              <p v-if="memoryState.memories.length" class="memory-save-hint">{{ t('记忆的修改会立即保存。') }}</p>
            </template>
          </template>
        </div>

        <div class="settings-section">
          <h3><Languages :size="16" />{{ t('语言') }}</h3>
          <p class="muted">{{ t('默认跟随设备语言，也可以固定为某一种。') }}</p>
          <div class="language-options" role="radiogroup" :aria-label="t('语言')">
            <button v-for="option in languageOptions" :key="option.value" type="button" role="radio" :aria-checked="preference === option.value" class="language-option" :class="{ 'is-selected': preference === option.value }" @click="chooseLanguage(option.value)">
              <span>{{ option.label }}</span>
              <Check v-if="preference === option.value" :size="15" />
            </button>
          </div>
        </div>
        <div class="privacy-note">
          <ShieldCheck :size="20" />
          <div>
            <strong>{{ t('留住每一步灵感') }}</strong>
            <p>{{ t('会话、作品与关联歌词保存在{target}，可随时下载。', { target: cloud ? t('你的账号') : t('当前浏览器') }) }}</p>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="secondary-button" @click="emit('close')">{{ t('取消') }}</button>
        <button class="primary-button" @click="emit('save', draft)"><Check :size="16" />{{ t('保存设置') }}</button>
      </div>
    </div>
  </AppDialog>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Brain, Check, Languages, LockKeyhole, Pencil, ShieldCheck, Sparkles, Trash2, X } from 'lucide-vue-next';
import AppDialog from './AppDialog.vue';
import BrandLogo from './BrandLogo.vue';
import type { Settings } from '../lib/types';
import { getLocalePreference, LOCALES, matchLocale, setLocalePreference, t, type LocalePreference } from '../lib/i18n';
import { loadStatus, invalidateStatus } from '../lib/status';
import { clearMemories, createMemory, deleteMemory, loadMemoryState, saveMemorySettings, updateMemory, type MemoryItem } from '../lib/memory';
import { memoryState } from '../composables/studio';
import { confirmAction } from '../composables/dialog';
import { notify } from '../composables/ui';

const props = withDefaults(defineProps<{ initial: Settings; cloud?: boolean; loading?: boolean }>(), { cloud: false, loading: false });
const emit = defineEmits<{ close: []; save: [settings: Settings] }>();
const draft = ref<Settings>({ ...props.initial });
const preference = ref<LocalePreference>(getLocalePreference());
const deviceTags = navigator.languages?.length ? [...navigator.languages] : [navigator.language];
const deviceLabel = LOCALES.find(item => item.code === matchLocale(deviceTags))?.label ?? '';
const languageOptions: { value: LocalePreference; label: string }[] = [
  { value: 'auto', label: t('跟随设备（{language}）', { language: deviceLabel }) },
  ...LOCALES.map(item => ({ value: item.code as LocalePreference, label: item.label })),
];
function chooseLanguage(value: LocalePreference) {
  preference.value = value;
  setLocalePreference(value);
}
async function checkConnection() {
  invalidateStatus();
  const status = await loadStatus();
  notify(status.ready ? t('创作服务已连接。') : t('创作服务尚未就绪，请联系服务提供方。'));
}

const memoryLoading = ref(false);
const memoryLoaded = ref(false);
const memoryBusy = ref(false);
const addingMemory = ref(false);
const memoryError = ref('');
const newMemory = ref('');
const editingId = ref('');
const editingText = ref('');

const memoryText = (error: unknown) => t(error instanceof Error ? error.message : '记忆操作失败，请重试。');

async function loadMemories() {
  if (!props.cloud) return;
  memoryLoading.value = true;
  memoryError.value = '';
  try {
    memoryState.value = await loadMemoryState();
    memoryLoaded.value = true;
  } catch (error) {
    memoryLoaded.value = false;
    memoryError.value = memoryText(error);
  } finally {
    memoryLoading.value = false;
  }
}

async function setFlag(key: 'enabled' | 'autoCapture', value: boolean) {
  if (memoryBusy.value) return;
  const previous = memoryState.value;
  const next = {
    enabled: key === 'enabled' ? value : previous.enabled,
    autoCapture: key === 'enabled' ? (value ? previous.autoCapture : false) : value,
  };
  memoryBusy.value = true;
  memoryError.value = '';
  memoryState.value = { ...previous, ...next };
  try {
    const saved = await saveMemorySettings(next.enabled, next.autoCapture);
    memoryState.value = { ...memoryState.value, ...saved };
    notify(t('记忆设置已保存'));
  } catch (error) {
    memoryState.value = previous;
    memoryError.value = memoryText(error);
  } finally {
    memoryBusy.value = false;
  }
}

async function addMemory() {
  const content = newMemory.value.trim();
  if (!content || memoryBusy.value || memoryState.value.memories.length >= memoryState.value.limit) return;
  memoryBusy.value = true;
  addingMemory.value = true;
  memoryError.value = '';
  try {
    const item = await createMemory(content);
    memoryState.value = { ...memoryState.value, memories: [...memoryState.value.memories, item] };
    newMemory.value = '';
    notify(t('已添加记忆'));
  } catch (error) {
    memoryError.value = memoryText(error);
  } finally {
    memoryBusy.value = false;
    addingMemory.value = false;
  }
}

function startEdit(item: MemoryItem) {
  editingId.value = item.id;
  editingText.value = item.content;
}

function cancelEdit() {
  editingId.value = '';
  editingText.value = '';
}

async function saveEdit(item: MemoryItem) {
  const content = editingText.value.trim();
  if (!content || memoryBusy.value) return;
  memoryBusy.value = true;
  memoryError.value = '';
  try {
    const updated = await updateMemory(item.id, content);
    memoryState.value = {
      ...memoryState.value,
      memories: memoryState.value.memories.map(entry => entry.id === item.id
        ? { ...entry, content: updated.content, updatedAt: updated.updatedAt }
        : entry),
    };
    cancelEdit();
    notify(t('记忆已更新'));
  } catch (error) {
    memoryError.value = memoryText(error);
  } finally {
    memoryBusy.value = false;
  }
}

async function removeMemory(item: MemoryItem) {
  if (memoryBusy.value) return;
  memoryBusy.value = true;
  memoryError.value = '';
  try {
    await deleteMemory(item.id);
    memoryState.value = { ...memoryState.value, memories: memoryState.value.memories.filter(entry => entry.id !== item.id) };
    if (editingId.value === item.id) cancelEdit();
    notify(t('已删除记忆'));
  } catch (error) {
    memoryError.value = memoryText(error);
  } finally {
    memoryBusy.value = false;
  }
}

async function clearAll() {
  if (memoryBusy.value || !memoryState.value.memories.length) return;
  if (!await confirmAction(t('清空全部记忆？'), t('所有记忆会从账号中删除，之后对话将不再使用它们。此操作无法撤销。'), t('清空全部记忆'))) return;
  memoryBusy.value = true;
  memoryError.value = '';
  try {
    await clearMemories();
    memoryState.value = { ...memoryState.value, memories: [] };
    cancelEdit();
    notify(t('已清空全部记忆'));
  } catch (error) {
    memoryError.value = memoryText(error);
  } finally {
    memoryBusy.value = false;
  }
}

onMounted(() => { if (props.cloud) void loadMemories(); });
</script>
