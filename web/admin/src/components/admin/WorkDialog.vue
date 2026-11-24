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
          <template v-if="kind === 'music'">
            <label class="adm-field">
              <span>{{ t('专辑封面（选填）') }}</span>
              <input class="adm-input adm-work-file" type="file" accept="image/*" :disabled="busy" @change="onCover" />
              <small class="adm-note">{{ t('图片文件，不超过 8 MB；会显示在广场音乐卡片和详情里。') }}</small>
            </label>
            <label class="adm-field">
              <span>{{ t('歌词（选填）') }}</span>
              <textarea v-model="lyrics" class="adm-textarea" maxlength="64000" rows="5" :disabled="busy" :placeholder="t('纯文本歌词，显示在广场详情并支持下载 TXT。')" aria-label="歌词（选填）" />
            </label>
            <div class="adm-field">
              <span>{{ t('LRC 时间轴歌词（选填）') }}</span>
              <textarea v-model="lrc" class="adm-textarea" maxlength="64000" rows="5" :disabled="busy" :placeholder="t('[00:12.00]第一句歌词')" aria-label="LRC 时间轴歌词（选填）" />
              <input class="adm-input adm-work-file" type="file" accept=".lrc,.txt,text/plain" :disabled="busy" aria-label="选择 LRC 文件" @change="onLrcFile" />
              <small class="adm-note">{{ t('可以直接粘贴，也可以选择 .lrc 文件自动填入。') }}</small>
            </div>
          </template>
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
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
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
const cover = ref<File | null>(null);
const lyrics = ref('');
const lrc = ref('');

const kindOptions = computed(() => (['image', 'video', 'music'] as const).map(value => ({
  value, label: MODEL_KIND_NAMES[value] || value,
})));
const visibilityOptions = computed(() => [
  { value: 'public', label: t('公开') },
  { value: 'private', label: t('私密') },
]);
const accept = computed(() => (kind.value === 'image' ? 'image/*' : kind.value === 'video' ? 'video/*' : 'audio/*'));

// The music-only block unmounts when the kind moves away, which leaves the
// file input visually empty while the chosen file would still be submitted.
// Reset the music extras whenever music is no longer selected.
watch(kind, value => {
  if (value === 'music' || editing) return;
  cover.value = null;
  lyrics.value = '';
  lrc.value = '';
});

function close() { if (!busy.value) emit('close'); }
function onFile(event: Event) {
  const input = event.target as HTMLInputElement;
  file.value = input.files?.[0] || null;
}
const MAX_COVER_BYTES = 8 * 1024 * 1024;
function onCover(event: Event) {
  const input = event.target as HTMLInputElement;
  const selected = input.files?.[0] || null;
  if (selected?.type && !selected.type.startsWith('image/')) {
    message.value = { tone: 'error', text: t('封面需要是图片文件。') };
    input.value = '';
    cover.value = null;
    return;
  }
  if (selected && selected.size > MAX_COVER_BYTES) {
    message.value = { tone: 'error', text: t('封面文件不能超过 8 MB。') };
    input.value = '';
    cover.value = null;
    return;
  }
  cover.value = selected;
}
async function onLrcFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const selected = input.files?.[0];
  input.value = '';
  if (!selected) return;
  if (selected.size > 256 * 1024) {
    message.value = { tone: 'error', text: t('LRC 文件不能超过 256 KB。') };
    return;
  }
  const text = await selected.text();
  if ([...text].length > 64000) {
    message.value = { tone: 'error', text: t('LRC 歌词不能超过 64000 个字符。') };
    return;
  }
  lrc.value = text;
  message.value = null;
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
  if (kind.value === 'music') {
    if ([...lyrics.value].length > 64000) {
      message.value = { tone: 'error', text: t('歌词不能超过 64000 个字符。') };
      return;
    }
    if ([...lrc.value].length > 64000) {
      message.value = { tone: 'error', text: t('LRC 歌词不能超过 64000 个字符。') };
      return;
    }
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
      if (kind.value === 'music') {
        if (cover.value) form.set('cover', cover.value);
        if (lyrics.value.trim()) form.set('lyrics', lyrics.value);
        if (lrc.value.trim()) form.set('lrc', lrc.value);
      }
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
