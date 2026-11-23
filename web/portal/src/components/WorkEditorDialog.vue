<template>
  <AppDialog labelled-by="work-editor-title" class-name="work-editor-dialog" :close-on-backdrop="!saving" @close="close">
    <div class="work-editor-inner">
      <div class="modal-heading">
        <div>
          <h2 id="work-editor-title">{{ t('编辑作品信息') }}</h2>
          <p class="tag-editor-sub">{{ t('名称会显示在作品广场和我的库中，描述会作为作品提示词公开展示。') }}</p>
        </div>
        <button type="button" class="icon-button" :aria-label="t('关闭弹窗')" :disabled="saving" @click="close"><X :size="18" /></button>
      </div>

      <div class="tag-editor-body work-editor-body">
        <p v-if="error" class="auth-error" role="alert">{{ error }}</p>

        <label class="work-editor-field">
          <span>{{ t('作品名称') }}</span>
          <input
            v-model="title"
            data-dialog-focus
            maxlength="80"
            :disabled="saving"
            :placeholder="titleFallback"
            @input="error = ''"
          />
          <small>{{ t('留空时自动使用提示词的第一行。') }}</small>
        </label>

        <label class="work-editor-field">
          <span>{{ t('作品描述') }}</span>
          <textarea
            v-model="prompt"
            rows="6"
            maxlength="16000"
            :disabled="saving"
            :placeholder="t('这件作品的想法、画面或氛围…')"
            @input="error = ''"
          />
        </label>
      </div>

      <div class="modal-footer">
        <button type="button" class="secondary-button" :disabled="saving" @click="close">{{ t('取消') }}</button>
        <button type="button" class="primary-button" :disabled="saving || !changed" @click="save">
          {{ saving ? t('保存中…') : t('保存修改') }}
        </button>
      </div>
    </div>
  </AppDialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { X } from 'lucide-vue-next';
import AppDialog from './AppDialog.vue';
import { notify } from '../composables/ui';
import { galleryTitle } from '../lib/galleryDetail';
import { t } from '../lib/i18n';
import { put } from '../lib/storage';
import type { Asset, WorkMetaChange } from '../lib/types';

const props = defineProps<{
  asset: Asset;
  /** Overrides local storage: the plaza saves through the owner meta endpoint. */
  save?: (updated: Asset, change: WorkMetaChange) => Promise<Partial<Asset> | void>;
}>();
const emit = defineEmits<{ close: []; saved: [asset: Asset] }>();

// Only an explicit title is edited. Falling back to the displayed name here
// would freeze a derived prompt line as the work's real name on any save.
const initialTitle = props.asset.title?.trim() || '';
const initialPrompt = props.asset.prompt || '';
const titleFallback = galleryTitle(props.asset);
const title = ref(initialTitle);
const prompt = ref(initialPrompt);
const saving = ref(false);
const error = ref('');
const titleChanged = computed(() => title.value.trim() !== initialTitle);
const promptChanged = computed(() => prompt.value !== initialPrompt);
const changed = computed(() => titleChanged.value || promptChanged.value);

function close() { if (!saving.value) emit('close'); }

async function save() {
  if (saving.value || !changed.value) return;
  saving.value = true;
  error.value = '';
  try {
    const updated = { ...props.asset, prompt: prompt.value } as Asset;
    if (titleChanged.value) updated.title = title.value.trim();
    let saved = updated;
    if (props.save) {
      const patch = await props.save(updated, { title: titleChanged.value, prompt: promptChanged.value });
      if (patch) saved = { ...updated, ...patch } as Asset;
    } else {
      await put('assets', updated);
    }
    notify(t('作品信息已保存。'));
    emit('saved', saved);
    emit('close');
  } catch (failure) {
    error.value = failure instanceof Error ? t(failure.message) : t('作品信息保存失败，请稍后重试。');
  } finally {
    saving.value = false;
  }
}
</script>
