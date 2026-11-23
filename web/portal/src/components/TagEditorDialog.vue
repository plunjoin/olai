<template>
  <AppDialog labelled-by="tag-editor-title" class-name="tag-editor-dialog" :close-on-backdrop="!saving" @close="close">
    <div class="tag-editor-inner">
      <div class="modal-heading">
        <div>
          <h2 id="tag-editor-title">{{ t('编辑标签') }}</h2>
          <p class="tag-editor-sub">{{ t('为作品添加标签，访客在广场点击标签即可快速检索同类作品。') }}</p>
        </div>
        <button type="button" class="icon-button" :aria-label="t('关闭弹窗')" :disabled="saving" @click="close"><X :size="18" /></button>
      </div>

      <div class="tag-editor-body">
        <p v-if="error" class="auth-error" role="alert">{{ error }}</p>

        <div v-if="tags.length" class="tag-editor-list" :aria-label="t('作品标签')">
          <span v-for="tag in tags" :key="tag" class="tag-editor-chip">
            <span>#{{ tag }}</span>
            <button type="button" :aria-label="t('移除标签：{tag}', { tag })" :disabled="saving" @click="removeTag(tag)"><X :size="12" /></button>
          </span>
        </div>
        <p v-else class="tag-editor-empty">{{ t('还没有标签，输入后按回车添加。') }}</p>

        <form class="tag-editor-add" @submit.prevent="addDraft">
          <input
            v-model="draft"
            data-dialog-focus
            :maxlength="MAX_WORK_TAG_LENGTH * 2"
            :disabled="saving || full"
            :placeholder="full ? t('标签数量已达上限') : t('输入标签后回车添加')"
            :aria-label="t('添加标签')"
            @input="error = ''"
          />
          <button type="submit" class="secondary-button" :disabled="saving || full || !draft.trim()">{{ t('添加') }}</button>
        </form>
        <p class="tag-editor-hint">{{ t('最多 {count} 个标签，每个最多 {length} 个字符。', { count: MAX_WORK_TAGS, length: MAX_WORK_TAG_LENGTH }) }}</p>

        <template v-if="availableSuggestions.length">
          <p class="tag-editor-suggest-title">{{ t('常用标签') }}</p>
          <div class="tag-editor-suggestions">
            <button v-for="tag in availableSuggestions" :key="tag" type="button" :disabled="saving || full" @click="addTag(tag)">#{{ tag }}</button>
          </div>
        </template>
      </div>

      <div class="modal-footer">
        <button type="button" class="secondary-button" :disabled="saving" @click="close">{{ t('取消') }}</button>
        <button type="button" class="primary-button" :disabled="saving || !changed" @click="save">
          {{ saving ? t('保存中…') : t('保存标签') }}
        </button>
      </div>
    </div>
  </AppDialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { X } from 'lucide-vue-next';
import AppDialog from './AppDialog.vue';
import { assets } from '../composables/studio';
import { notify } from '../composables/ui';
import { t } from '../lib/i18n';
import { put } from '../lib/storage';
import type { Asset } from '../lib/types';
import { MAX_WORK_TAGS, MAX_WORK_TAG_LENGTH, normalizeWorkTags } from '../lib/workTags';

const props = withDefaults(defineProps<{ asset: Asset; suggestions?: string[] }>(), { suggestions: () => [] });
const emit = defineEmits<{ close: []; saved: [asset: Asset] }>();

const tags = ref(normalizeWorkTags(props.asset.tags || []));
const draft = ref('');
const saving = ref(false);
const error = ref('');
const initial = normalizeWorkTags(props.asset.tags || []).join('\u0000');
const full = computed(() => tags.value.length >= MAX_WORK_TAGS);
const changed = computed(() => tags.value.join('\u0000') !== initial);
const availableSuggestions = computed(() => normalizeWorkTags(props.suggestions)
  .filter(tag => !tags.value.some(current => current.toLowerCase() === tag.toLowerCase()))
  .slice(0, 12));

function close() { if (!saving.value) emit('close'); }
function addTag(value: string) {
  if (full.value) return;
  tags.value = normalizeWorkTags([...tags.value, value]);
}
function addDraft() {
  if (full.value) return;
  const values = draft.value.split(/[,，]/);
  tags.value = normalizeWorkTags([...tags.value, ...values]);
  draft.value = '';
  error.value = '';
}
function removeTag(tag: string) {
  tags.value = tags.value.filter(item => item !== tag);
}

async function save() {
  if (saving.value || !changed.value) return;
  saving.value = true;
  error.value = '';
  try {
    // Merge into the live asset: the dialog's snapshot may predate a
    // publish/withdraw or a finished cover/lyric job, and this full-record
    // write must not revert either.
    const current = assets.value.find(item => item.id === props.asset.id) || props.asset;
    const updated = { ...current, tags: tags.value } as Asset;
    await put('assets', updated);
    notify(t('标签已保存。'));
    emit('saved', updated);
    emit('close');
  } catch (failure) {
    error.value = failure instanceof Error ? t(failure.message) : t('标签保存失败，请稍后重试。');
  } finally {
    saving.value = false;
  }
}
</script>
