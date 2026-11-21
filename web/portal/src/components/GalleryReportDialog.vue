<template>
  <AppDialog labelled-by="report-title" described-by="report-sub" class-name="report-dialog" @close="emit('close')">
    <form class="report-dialog-inner" @submit.prevent="submit">
      <div class="modal-heading">
        <div class="report-heading">
          <span class="report-emblem"><Flag :size="18" /></span>
          <div>
            <h2 id="report-title">{{ t('举报作品') }}</h2>
            <p id="report-sub" class="report-sub">{{ t('请选择举报原因，管理员会尽快核实处理。') }}</p>
          </div>
        </div>
        <button type="button" class="icon-button" :aria-label="t('关闭举报')" @click="emit('close')"><X :size="19" /></button>
      </div>

      <div class="report-body">
        <p class="report-work" :title="galleryTitle(asset)">{{ t('举报对象：{title}', { title: galleryTitle(asset) }) }}</p>
        <div class="report-reasons" role="radiogroup" :aria-label="t('举报原因')">
          <label v-for="option in reasons" :key="option.value" class="report-reason" :class="{ 'is-selected': reason === option.value }">
            <input v-model="reason" type="radio" name="report-reason" :value="option.value" />
            <span>
              <strong>{{ option.label }}</strong>
              <small>{{ option.hint }}</small>
            </span>
            <Check v-if="reason === option.value" :size="16" />
          </label>
        </div>
        <label class="field-label report-detail">
          <span>{{ t('补充说明（选填）') }}</span>
          <textarea v-model="detail" rows="3" maxlength="500" :placeholder="t('请描述具体问题，便于我们核实。')" />
        </label>
        <p v-if="error" class="report-error" role="alert">{{ error }}</p>
      </div>

      <div class="modal-footer">
        <button type="button" class="secondary-button" @click="emit('close')">{{ t('取消') }}</button>
        <button type="submit" class="primary-button" :disabled="busy || !reason">
          {{ busy ? t('正在提交…') : t('提交举报') }}
        </button>
      </div>
    </form>
  </AppDialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { Check, Flag, X } from 'lucide-vue-next';
import AppDialog from './AppDialog.vue';
import { reportGalleryWork } from '../lib/gallery';
import { galleryTitle } from '../lib/galleryDetail';
import { t } from '../lib/i18n';
import type { Asset } from '../lib/types';
import { notify } from '../composables/ui';

const props = defineProps<{ asset: Asset }>();
const emit = defineEmits<{ close: [] }>();
const reasons = computed(() => [
  { value: 'inappropriate', label: t('不当内容'), hint: t('色情、暴力、仇恨或令人不适的内容') },
  { value: 'copyright', label: t('侵权内容'), hint: t('未经授权使用了我的作品、肖像或素材') },
  { value: 'spam', label: t('垃圾或误导内容'), hint: t('广告、诈骗或与作品描述不符') },
  { value: 'other', label: t('其他问题'), hint: t('其他需要管理员核实的情况') },
]);
const reason = ref('');
const detail = ref('');
const error = ref('');
const busy = ref(false);

async function submit() {
  if (busy.value || !reason.value || !props.asset.id) return;
  if (reason.value === 'other' && !detail.value.trim()) {
    error.value = t('请补充说明具体问题。');
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    await reportGalleryWork(props.asset.id, reason.value, detail.value.trim());
    notify(t('举报已提交，感谢你的反馈。'));
    emit('close');
  } catch (failure) {
    error.value = failure instanceof Error ? t(failure.message) : t('举报提交失败，请稍后重试。');
  } finally {
    busy.value = false;
  }
}
</script>
