<template>
  <AppDialog labelled-by="banner-title" class-name="banner-dialog" @close="close">
    <div class="banner-dialog-inner">
      <div class="modal-heading">
        <div>
          <h2 id="banner-title">{{ t('编辑封面') }}</h2>
          <p class="banner-dialog-sub">{{ t('封面会显示在你主页头像的上方。') }}</p>
        </div>
        <button type="button" class="icon-button" :aria-label="t('关闭弹窗')" :disabled="busy" @click="close"><X :size="18" /></button>
      </div>

      <form @submit.prevent="submit">
        <div class="banner-dialog-body">
          <p v-if="error" class="auth-error" role="alert">{{ error }}</p>

          <div class="banner-preview" :style="previewStyle">
            <span class="banner-preview-label">{{ t('预览') }}</span>
          </div>

          <div class="banner-field">
            <span class="field-label">{{ t('预设封面') }}</span>
            <div class="banner-swatches" role="radiogroup" :aria-label="t('预设封面')">
              <button
                v-for="theme in BANNER_THEMES"
                :key="theme.id"
                type="button"
                role="radio"
                :aria-checked="value === theme.id"
                :aria-label="t(theme.label)"
                :title="t(theme.label)"
                class="banner-swatch"
                :class="{ 'is-selected': value === theme.id }"
                :style="{ background: theme.background }"
                :disabled="busy"
                @click="select(theme.id)"
              />
            </div>
          </div>

          <div class="banner-field">
            <span class="field-label">{{ t('上传封面') }}</span>
            <div class="banner-upload">
              <template v-if="canUpload">
                <input ref="fileInput" class="banner-upload-input" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="upload" />
                <button type="button" class="secondary-button banner-upload-button" :disabled="busy" @click="fileInput?.click()">
                  <LoaderCircle v-if="uploading" :size="15" class="auth-spin" /><Upload v-else :size="15" />
                  {{ uploading ? t('上传中…') : t('上传封面') }}
                </button>
                <span class="banner-dialog-hint">{{ t('支持 PNG、JPG、WebP，上传后自动裁剪为宽幅封面。') }}</span>
              </template>
              <span v-else class="banner-dialog-hint">{{ t('当前部署未启用对象存储，暂不支持上传封面。') }}</span>
            </div>
            <p v-if="storedUpload" class="banner-upload-note">
              {{ t('上传的封面') }}
              <button type="button" class="banner-upload-clear" :disabled="busy" @click="select(storedUpload)">{{ t('使用上传的封面') }}</button>
            </p>
          </div>
        </div>

        <div class="modal-footer">
          <button type="button" class="secondary-button" :disabled="busy" @click="clear">{{ t('移除封面') }}</button>
          <button type="button" class="secondary-button" :disabled="busy" @click="close">{{ t('取消') }}</button>
          <button type="submit" class="primary-button" :disabled="busy || !changed">{{ busy ? t('保存中…') : t('保存封面') }}</button>
        </div>
      </form>
    </div>
  </AppDialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { LoaderCircle, Upload, X } from 'lucide-vue-next';
import AppDialog from './AppDialog.vue';
import { t } from '../lib/i18n';
import { uploadMedia } from '../lib/mediaStorage';
import { BANNER_THEMES, bannerTheme, bannerUploadValue, uploadedBannerID, uploadedBannerURL } from '../lib/profile';
import { bannerFileError, wideBannerBlob } from '../lib/profileImage';

const props = defineProps<{
  /** 当前封面：预设色 id 或 upload:<uuid>。 */
  value: string;
  canUpload: boolean;
  userId: string;
  save: (banner: string) => Promise<void>;
}>();
const emit = defineEmits<{ close: [] }>();

const initial = props.value || '';
const value = ref(initial);
const busy = ref(false);
const uploading = ref(false);
const error = ref('');
const fileInput = ref<HTMLInputElement | null>(null);
const storedUpload = ref<string | null>(uploadedBannerID(initial));
const changed = computed(() => value.value !== initial);
const previewStyle = computed(() => {
  const url = uploadedBannerURL(value.value);
  if (url) return { backgroundImage: `url("${url}")` };
  const theme = bannerTheme(value.value);
  if (theme) return { backgroundImage: theme.background };
  return {};
});

function close() { if (!busy.value) emit('close'); }
function select(next: string) { value.value = next; error.value = ''; }
function clear() { value.value = ''; error.value = ''; }

async function upload(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || busy.value) return;
  const invalid = bannerFileError(file);
  if (invalid) {
    error.value = invalid === 'type' ? t('请选择 PNG、JPG 或 WebP 图片。') : t('图片大小不能超过 10 MB。');
    return;
  }
  uploading.value = true;
  error.value = '';
  try {
    let blob: Blob;
    try { blob = await wideBannerBlob(file); }
    catch { throw new Error(t('图片处理失败，请换一张试试。')); }
    const uploaded = bannerUploadValue(await uploadMedia(blob, 'banner', props.userId));
    if (!uploaded) throw new Error(t('封面上传失败，请重试。'));
    storedUpload.value = uploaded;
    value.value = uploaded;
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : t('封面上传失败，请重试。');
  } finally {
    uploading.value = false;
  }
}

async function submit() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await props.save(value.value);
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : t('封面上传失败，请重试。');
    busy.value = false;
  }
}
</script>
