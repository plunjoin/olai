<template>
  <section :class="variant === 'account' ? 'account-card account-memory' : 'settings-section memory-section'">
    <div v-if="variant === 'account'" class="account-card-head">
      <h2><Brain :size="16" />{{ t('长期记忆') }}</h2>
      <span v-if="cloud">{{ memoryState.memories.length }} / {{ memoryState.limit }}</span>
    </div>
    <h3 v-else>
      <Brain :size="16" />{{ t('长期记忆') }}
      <span v-if="cloud" class="memory-count">{{ memoryState.memories.length }} / {{ memoryState.limit }}</span>
    </h3>
    <p :class="variant === 'account' ? 'account-note' : 'muted'">{{ t('记住你的称呼、偏好和长期目标，让小o在之后的对话里更懂你。') }}</p>

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
  </section>

  <AppDialog v-if="clearRequested && cloud && variant === 'account'" labelled-by="clear-memory-title" described-by="clear-memory-description" class-name="action-dialog" @close="clearRequested = false">
    <button class="icon-button dialog-close" :aria-label="t('关闭弹窗')" @click="clearRequested = false"><X :size="18" /></button>
    <div class="dialog-emblem danger"><BrandLogo :size="58" /></div>
    <h2 id="clear-memory-title">{{ t('清空全部记忆？') }}</h2>
    <p id="clear-memory-description">{{ t('所有记忆会从账号中删除，之后对话将不再使用它们。此操作无法撤销。') }}</p>
    <div class="action-dialog-footer">
      <button type="button" class="secondary-button" :data-dialog-focus="true" @click="clearRequested = false">{{ t('取消') }}</button>
      <button type="button" class="danger-button" :disabled="memoryBusy" @click="confirmClear"><Trash2 :size="16" />{{ t('清空全部记忆') }}</button>
    </div>
  </AppDialog>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Brain, LockKeyhole, Pencil, Sparkles, Trash2, X } from 'lucide-vue-next';
import AppDialog from './AppDialog.vue';
import BrandLogo from './BrandLogo.vue';
import { clearMemories, createMemory, deleteMemory, loadMemoryState, saveMemorySettings, updateMemory, type MemoryItem } from '../lib/memory';
import { memoryState } from '../composables/memory';
import { notify } from '../composables/ui';
import { t } from '../lib/i18n';

const props = withDefaults(defineProps<{ cloud?: boolean; variant?: 'settings' | 'account' }>(), {
  cloud: false,
  variant: 'settings',
});

const memoryLoading = ref(false);
const memoryLoaded = ref(false);
const memoryBusy = ref(false);
const addingMemory = ref(false);
const memoryError = ref('');
const newMemory = ref('');
const editingId = ref('');
const editingText = ref('');
const clearRequested = ref(false);

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
  if (props.variant === 'account') {
    clearRequested.value = true;
    return;
  }
  if (!window.confirm(t('所有记忆会从账号中删除，之后对话将不再使用它们。此操作无法撤销。'))) return;
  await confirmClear();
}

async function confirmClear() {
  clearRequested.value = false;
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
