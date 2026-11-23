<template>
  <div class="adm-dialog-backdrop" role="presentation" @click.self="close">
    <form class="adm-dialog adm-work-dialog" role="dialog" aria-modal="true" aria-labelledby="adm-work-title" @submit.prevent="submit">
      <h2 id="adm-work-title">{{ editing ? t('编辑作品信息') : t('发布作品') }}</h2>
      <p class="adm-note">{{ editing ? t('修改名称、描述或可见性；作品文件不会被替换。') : t('作为 Olai 官方账号发布一件作品，发布后会出现在作品广场。') }}</p>

      <p v-if="message" class="adm-feedback" :data-tone="message.tone" role="status">
        {{ message.text }}
        <button v-if="editing && !detailReady && !loading" type="button" class="adm-btn adm-btn-sm" @click="loadDetail">{{ t('重试') }}</button>
      </p>
      <p v-if="loading" class="adm-note"><span class="adm-spinner" /> {{ t('加载中…') }}</p>

      <template v-else>
        <div class="adm-work-grid">
          <label class="adm-field">
            <span>{{ t('作品类型') }}</span>
            <Select v-model="kind" :options="kindOptions" :disabled="editing || busy" :aria-label="t('作品类型')" />
          </label>
          <label class="adm-field">
            <span>{{ t('可见性') }}</span>
            <Select v-model="visibility" :options="visibilityOptions" :disabled="busy" :aria-label="t('可见性')" />
          </label>
        </div>

        <label class="adm-field">
          <span>{{ t('作品名称') }}</span>
          <input v-model="title" class="adm-input" maxlength="80" required :disabled="busy" :placeholder="t('给作品起一个名字')" />
          <small class="adm-note">{{ t('最多 80 个字符。') }}</small>
        </label>

        <label class="adm-field">
          <span>{{ t('作品描述') }}</span>
          <textarea v-model="prompt" class="adm-textarea" maxlength="16000" rows="5" :disabled="busy" :placeholder="t('这件作品的想法、画面或氛围…')" />
        </label>

        <template v-if="!editing">
          <label class="adm-field">
            <span>{{ t('标签（选填）') }}</span>
            <input v-model="tags" class="adm-input" :disabled="busy" :placeholder="t('用逗号分隔，最多 8 个')" />
          </label>
          <label class="adm-field">
            <span>{{ t('作品文件') }}</span>
            <input class="adm-input adm-work-file" type="file" :accept="accept" required :disabled="busy" @change="onFile" />
            <small class="adm-note">{{ t('图像、视频或音频文件；未启用云存储时不超过 32 MB。') }}</small>
          </label>
        </template>
      </template>

      <div class="adm-dialog-actions">
        <button type="button" class="adm-btn" :disabled="busy" @click="close">{{ t('取消') }}</button>
        <button type="submit" class="adm-btn adm-btn-primary" :disabled="busy || loading || (editing && !detailReady)">
          {{ busy ? t('保存中…') : editing ? t('保存修改') : t('发布作品') }}
        </button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import Select from '../ui/Select.vue';
import { adminApi, errorMessage, MODEL_KIND_NAMES, type AdminWork, type FeedbackMessage } from '../../lib/admin';
import { t } from '../../lib/i18n';

const props = defineProps<{ work?: AdminWork | null }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const editing = Boolean(props.work);
const loading = ref(editing);
const detailReady = ref(!editing);
const busy = ref(false);
const message = ref<FeedbackMessage>(null);
const kind = ref(props.work?.kind || 'image');
const visibility = ref(props.work?.visibility === 'private' ? 'private' : 'public');
const title = ref(props.work?.displayTitle || props.work?.title || '');
const prompt = ref('');
const tags = ref('');
const file = ref<File | null>(null);

const kindOptions = computed(() => (['image', 'video', 'music'] as const).map(value => ({
  value, label: MODEL_KIND_NAMES[value] || value,
})));
const visibilityOptions = computed(() => [
  { value: 'public', label: t('公开') },
  { value: 'private', label: t('私密') },
]);
const accept = computed(() => (kind.value === 'image' ? 'image/*' : kind.value === 'video' ? 'video/*' : 'audio/*'));

function close() { if (!busy.value) emit('close'); }
function onFile(event: Event) {
  const input = event.target as HTMLInputElement;
  file.value = input.files?.[0] || null;
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close();
}

async function loadDetail() {
  if (!props.work) return;
  loading.value = true;
  message.value = null;
  try {
    const detail = await adminApi<AdminWork>(`/api/admin/works/${encodeURIComponent(props.work.id)}`);
    title.value = detail.displayTitle || detail.title || title.value;
    prompt.value = detail.prompt || '';
    kind.value = detail.kind || kind.value;
    visibility.value = detail.visibility === 'private' ? 'private' : 'public';
    detailReady.value = true;
  } catch (failure) {
    // Without the real description, saving would overwrite it with an empty
    // string, so the dialog stays read-only until the retry succeeds.
    detailReady.value = false;
    message.value = { tone: 'error', text: errorMessage(failure, '作品信息加载失败。') };
  } finally {
    loading.value = false;
  }
}
onMounted(async () => {
  window.addEventListener('keydown', onKeydown);
  if (!props.work) return;
  await loadDetail();
});
onUnmounted(() => window.removeEventListener('keydown', onKeydown));

async function submit() {
  if (busy.value || loading.value) return;
  if (props.work && !detailReady.value) {
    message.value = { tone: 'error', text: t('作品信息尚未加载完成，请重试。') };
    return;
  }
  message.value = null;
  const name = title.value.trim();
  if (!name) {
    message.value = { tone: 'error', text: t('请填写作品名称。') };
    return;
  }
  if (name.length > 80) {
    message.value = { tone: 'error', text: t('作品名称不能超过 80 个字符。') };
    return;
  }
  if (prompt.value.length > 16000) {
    message.value = { tone: 'error', text: t('作品描述不能超过 16000 个字符。') };
    return;
  }
  busy.value = true;
  try {
    if (props.work) {
      await adminApi(`/api/admin/works/${encodeURIComponent(props.work.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ title: name, prompt: prompt.value, visibility: visibility.value }),
      });
    } else {
      if (!file.value) {
        message.value = { tone: 'error', text: t('请选择要发布的作品文件。') };
        return;
      }
      const form = new FormData();
      form.set('kind', kind.value);
      form.set('visibility', visibility.value);
      form.set('title', name);
      form.set('prompt', prompt.value);
      form.set('tags', tags.value);
      form.set('file', file.value);
      await adminApi('/api/admin/works', { method: 'POST', body: form });
    }
    emit('saved');
    emit('close');
  } catch (failure) {
    message.value = { tone: 'error', text: errorMessage(failure, '保存失败，请稍后重试。') };
  } finally {
    busy.value = false;
  }
}
</script>
