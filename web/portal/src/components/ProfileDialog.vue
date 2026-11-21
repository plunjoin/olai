<template>
  <AppDialog labelled-by="profile-title" class-name="profile-dialog" @close="close">
    <div class="profile-dialog-inner">
      <div class="modal-heading">
        <div>
          <h2 id="profile-title">{{ t('编辑个人资料') }}</h2>
          <p class="profile-dialog-sub">{{ t('修改昵称和头像，展示在工作台与账号中心。') }}</p>
        </div>
        <button type="button" class="icon-button" :aria-label="t('关闭弹窗')" :disabled="modalBusy" @click="close"><X :size="18" /></button>
      </div>
      <form @submit.prevent="submit">
        <div class="profile-dialog-body">
          <p v-if="error" class="auth-error" role="alert">{{ error }}</p>
          <div class="profile-avatar-field">
            <span class="field-label">{{ t('头像') }}</span>
            <div class="profile-avatar-options" role="radiogroup" :aria-label="t('头像')">
              <button type="button" role="radio" :aria-checked="avatar === 'brand'" :aria-label="t('默认头像')" class="profile-avatar-option" :class="{ 'is-selected': avatar === 'brand' }" :disabled="modalBusy" @click="selectAvatar('brand')">
                <AccountAvatar class-name="profile-avatar-swatch" :name="previewName" :size="30" />
              </button>
              <button v-if="storedUpload" type="button" role="radio" :aria-checked="avatar === storedUpload" :aria-label="t('上传的头像')" class="profile-avatar-option" :class="{ 'is-selected': avatar === storedUpload }" :disabled="modalBusy" @click="selectAvatar(storedUpload)">
                <AccountAvatar class-name="profile-avatar-swatch" :name="previewName" :avatar="storedUpload" :size="30" />
              </button>
              <button v-for="theme in AVATAR_THEMES" :key="theme.id" type="button" role="radio" :aria-checked="avatar === theme.id" :aria-label="t(theme.label)" class="profile-avatar-option" :class="{ 'is-selected': avatar === theme.id }" :disabled="modalBusy" @click="selectAvatar(theme.id)">
                <AccountAvatar class-name="profile-avatar-swatch" :name="previewName" :avatar="theme.id" :size="30" />
              </button>
            </div>
            <div class="profile-avatar-upload">
              <template v-if="canUpload">
                <input ref="fileInput" class="profile-upload-input" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="uploadAvatar" />
                <button type="button" class="secondary-button profile-upload-button" :disabled="modalBusy" @click="fileInput?.click()">
                  <LoaderCircle v-if="uploading" :size="15" class="auth-spin" /><Upload v-else :size="15" />
                  {{ uploading ? t('上传中…') : t('上传图片') }}
                </button>
                <span class="profile-dialog-hint">{{ t('支持 PNG、JPG、WebP，上传后自动裁剪为正方形。') }}</span>
              </template>
              <span v-else class="profile-dialog-hint">{{ t('当前部署未启用对象存储，暂不支持上传头像。') }}</span>
            </div>
          </div>
          <label class="field-label profile-name-field">
            <span class="profile-name-label">
              {{ t('昵称') }}
              <span class="profile-name-count">{{ profileNameLength(normalized) }}/{{ PROFILE_NAME_MAX }}</span>
            </span>
            <input v-model="name" data-dialog-focus :maxlength="PROFILE_NAME_MAX * 2" :placeholder="user.email.split('@')[0]" :disabled="modalBusy" @input="error = ''" />
          </label>
          <p class="profile-dialog-hint">{{ t('昵称会显示在工作台与账号中心，最多 24 个字符；留空时显示邮箱前缀。') }}</p>
          <p class="profile-dialog-email">{{ t('登录邮箱：{email}', { email: user.email }) }}</p>
        </div>
        <div class="modal-footer">
          <button type="button" class="secondary-button" :disabled="modalBusy" @click="close">{{ t('取消') }}</button>
          <button type="submit" class="primary-button" :disabled="modalBusy || !changed || !validProfileName(normalized)">
            {{ busy ? t('保存中…') : t('保存资料') }}
          </button>
        </div>
      </form>
    </div>
  </AppDialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { LoaderCircle, Upload, X } from 'lucide-vue-next';
import AppDialog from './AppDialog.vue';
import AccountAvatar from './AccountAvatar.vue';
import type { Account } from '../lib/account';
import { t } from '../lib/i18n';
import { uploadMedia } from '../lib/mediaStorage';
import { AVATAR_THEMES, avatarTheme, avatarUploadValue, normalizeProfileName, PROFILE_NAME_MAX, profileNameLength, uploadedAvatarID, validProfileName } from '../lib/profile';
import { avatarFileError, squareAvatarBlob } from '../lib/profileImage';

const props = defineProps<{ user: Account; canUpload: boolean; save: (input: { name: string; avatar: string | null }) => Promise<void> }>();
const emit = defineEmits<{ close: [] }>();

const initialUpload = uploadedAvatarID(props.user.avatar);
const name = ref(props.user.name || '');
const avatar = ref(avatarTheme(props.user.avatar)?.id || initialUpload || 'brand');
const storedUpload = ref<string | null>(initialUpload);
const busy = ref(false);
const uploading = ref(false);
const error = ref('');
const fileInput = ref<HTMLInputElement | null>(null);
const normalized = computed(() => normalizeProfileName(name.value));
const initialName = normalizeProfileName(props.user.name);
const initialAvatar = avatarTheme(props.user.avatar)?.id || initialUpload || 'brand';
const changed = computed(() => normalized.value !== initialName || avatar.value !== initialAvatar);
const previewName = computed(() => normalized.value || props.user.email);
const modalBusy = computed(() => busy.value || uploading.value);

function close() { if (!modalBusy.value) emit('close'); }
function selectAvatar(value: string) { avatar.value = value; error.value = ''; }

async function uploadAvatar(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || modalBusy.value) return;
  const invalid = avatarFileError(file);
  if (invalid) {
    error.value = invalid === 'type' ? t('请选择 PNG、JPG 或 WebP 图片。') : t('图片大小不能超过 10 MB。');
    return;
  }
  uploading.value = true;
  error.value = '';
  try {
    let blob: Blob;
    try { blob = await squareAvatarBlob(file); }
    catch { throw new Error(t('图片处理失败，请换一张试试。')); }
    const value = avatarUploadValue(await uploadMedia(blob, 'avatar', props.user.id));
    if (!value) throw new Error(t('头像上传失败，请重试。'));
    storedUpload.value = value;
    avatar.value = value;
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : t('头像上传失败，请重试。');
  } finally {
    uploading.value = false;
  }
}

async function submit() {
  if (modalBusy.value) return;
  if (!validProfileName(normalized.value)) { error.value = t('昵称不能超过 24 个字符。'); return; }
  busy.value = true;
  error.value = '';
  try {
    await props.save({ name: normalized.value, avatar: avatar.value === 'brand' ? null : avatar.value });
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : t('账号操作失败，请重试。');
    busy.value = false;
  }
}
</script>
