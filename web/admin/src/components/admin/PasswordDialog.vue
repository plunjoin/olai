<template>
  <div class="adm-dialog-backdrop" role="presentation" @click.self="close">
    <form class="adm-dialog" role="dialog" aria-modal="true" aria-labelledby="adm-password-title" @submit.prevent="submit">
      <h2 id="adm-password-title">{{ t('修改后台密码') }}</h2>
      <p class="adm-note">{{ t('修改后其他设备上的后台登录会立即失效；门户账号密码不受影响。') }}</p>

      <p v-if="message" class="adm-feedback" :data-tone="message.tone" role="status">{{ message.text }}</p>

      <label class="adm-field">
        <span>{{ t('当前密码') }}</span>
        <input ref="currentInput" v-model="current" class="adm-input" type="password" name="current-password" autocomplete="current-password" required minlength="8" maxlength="128" :disabled="busy" />
      </label>
      <label class="adm-field">
        <span>{{ t('新密码') }}</span>
        <input v-model="next" class="adm-input" type="password" name="new-password" autocomplete="new-password" required minlength="8" maxlength="128" :disabled="busy" />
      </label>
      <label class="adm-field">
        <span>{{ t('确认新密码') }}</span>
        <input v-model="confirmation" class="adm-input" type="password" name="confirm-password" autocomplete="new-password" required minlength="8" maxlength="128" :disabled="busy" />
      </label>

      <div class="adm-dialog-actions">
        <button type="button" class="adm-btn" :disabled="busy" @click="close">{{ t('完成') }}</button>
        <button type="submit" class="adm-btn adm-btn-primary" :disabled="busy">{{ busy ? t('保存中…') : t('保存新密码') }}</button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { t } from '../../lib/i18n';

const emit = defineEmits<{ close: [] }>();
const current = ref('');
const next = ref('');
const confirmation = ref('');
const currentInput = ref<HTMLInputElement | null>(null);
const busy = ref(false);
const message = ref<{ tone: 'ok' | 'error'; text: string } | null>(null);

function close() {
  if (!busy.value) emit('close');
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close();
}

async function submit() {
  if (busy.value) return;
  message.value = null;
  if (next.value.length < 8 || next.value.length > 128) {
    message.value = { tone: 'error', text: t('请输入 8–128 位新密码。') };
    return;
  }
  if (next.value !== confirmation.value) {
    message.value = { tone: 'error', text: t('两次输入的新密码不一致。') };
    return;
  }
  busy.value = true;
  try {
    const response = await fetch('/api/admin/auth/password', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ currentPassword: current.value, password: next.value }),
    });
    if (response.status === 401) {
      window.location.reload();
      return;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(t(data?.error?.message || '保存失败，请稍后重试。'));
    current.value = '';
    next.value = '';
    confirmation.value = '';
    message.value = { tone: 'ok', text: t('密码已更新，其他后台会话已失效。') };
  } catch (failure) {
    message.value = { tone: 'error', text: failure instanceof Error ? failure.message : t('无法连接服务端，请稍后重试。') };
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  currentInput.value?.focus();
  window.addEventListener('keydown', onKeydown);
});
onUnmounted(() => window.removeEventListener('keydown', onKeydown));
</script>
