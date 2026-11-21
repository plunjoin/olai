<template>
  <AppDialog v-if="dialogRequest" labelled-by="action-title" described-by="action-description" class-name="action-dialog" @close="resolveDialog(null)">
    <button class="icon-button dialog-close" :aria-label="t('关闭弹窗')" @click="resolveDialog(null)"><X :size="18" /></button>
    <div class="dialog-emblem" :class="dialogRequest.kind"><BrandLogo :size="58" /></div>
    <h2 id="action-title">{{ dialogRequest.title }}</h2>
    <p id="action-description">{{ dialogRequest.description }}</p>
    <form @submit.prevent="submit">
      <label v-if="dialogRequest.kind === 'prompt'" class="field-label">
        {{ t('会话名称') }}
        <input v-model="dialogValue" data-dialog-focus maxlength="100" @focus="selectAll" />
      </label>
      <div class="action-dialog-footer">
        <button type="button" class="secondary-button" :data-dialog-focus="dialogRequest.kind === 'confirm' ? true : undefined" @click="resolveDialog(null)">{{ t('取消') }}</button>
        <button type="submit" :class="dialogRequest.danger ? 'danger-button' : 'primary-button'" :disabled="dialogRequest.kind === 'prompt' && !dialogValue.trim()">
          <Trash2 v-if="dialogRequest.danger" :size="16" /><Check v-else :size="16" />
          {{ dialogRequest.kind === 'confirm' ? dialogRequest.confirmLabel : t('保存名称') }}
        </button>
      </div>
    </form>
  </AppDialog>
</template>

<script setup lang="ts">
import { Check, Trash2, X } from 'lucide-vue-next';
import AppDialog from './AppDialog.vue';
import BrandLogo from './BrandLogo.vue';
import { dialogRequest, dialogValue, resolveDialog } from '../composables/dialog';
import { t } from '../lib/i18n';

function submit() {
  if (!dialogRequest.value) return;
  resolveDialog(dialogRequest.value.kind === 'confirm' ? true : dialogValue.value.trim());
}
function selectAll(event: Event) { (event.target as HTMLInputElement).select(); }
</script>
