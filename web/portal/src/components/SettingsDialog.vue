<template>
  <AppDialog labelled-by="settings-title" class-name="settings-modal" @close="emit('close')">
    <div class="settings-dialog">
      <div class="modal-heading">
        <div class="settings-heading-brand"><BrandLogo :size="44" /><h2 id="settings-title">{{ t('创作偏好') }}</h2></div>
        <button class="icon-button" :aria-label="t('关闭设置')" @click="emit('close')"><X :size="20" /></button>
      </div>
      <div class="settings-scroll">
        <div class="settings-section">
          <h3>{{ t('创作服务') }}</h3>
          <p class="muted">{{ t('连接由服务端统一管理，无需在浏览器配置。') }}</p>
          <button class="secondary-button" :disabled="loading" @click="checkConnection">{{ loading ? t('正在检查…') : t('检查连接') }}</button>
        </div>
        <div class="settings-section">
          <h3>{{ t('对话偏好') }}</h3>
          <label class="field-label range-label">
            {{ t('创造性') }} <span>{{ draft.temperature.toFixed(1) }}</span>
            <input v-model.number="draft.temperature" type="range" min="0" max="2" step="0.1" />
          </label>
        </div>

        <MemoryPanel :cloud="cloud" />

        <div class="settings-section">
          <h3><Languages :size="16" />{{ t('语言') }}</h3>
          <p class="muted">{{ t('默认跟随设备语言，也可以固定为某一种。') }}</p>
          <div class="language-options" role="radiogroup" :aria-label="t('语言')">
            <button v-for="option in languageOptions" :key="option.value" type="button" role="radio" :aria-checked="preference === option.value" class="language-option" :class="{ 'is-selected': preference === option.value }" @click="chooseLanguage(option.value)">
              <span>{{ option.label }}</span>
              <Check v-if="preference === option.value" :size="15" />
            </button>
          </div>
        </div>
        <div class="privacy-note">
          <ShieldCheck :size="20" />
          <div>
            <strong>{{ t('留住每一步灵感') }}</strong>
            <p>{{ t('会话、作品与关联歌词保存在{target}，可随时下载。', { target: cloud ? t('你的账号') : t('当前浏览器') }) }}</p>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="secondary-button" @click="emit('close')">{{ t('取消') }}</button>
        <button class="primary-button" @click="emit('save', draft)"><Check :size="16" />{{ t('保存设置') }}</button>
      </div>
    </div>
  </AppDialog>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { Check, Languages, ShieldCheck, X } from 'lucide-vue-next';
import AppDialog from './AppDialog.vue';
import BrandLogo from './BrandLogo.vue';
import MemoryPanel from './MemoryPanel.vue';
import type { Settings } from '../lib/types';
import { getLocalePreference, LOCALES, matchLocale, setLocalePreference, t, type LocalePreference } from '../lib/i18n';
import { loadStatus, invalidateStatus } from '../lib/status';
import { notify } from '../composables/ui';

const props = withDefaults(defineProps<{ initial: Settings; cloud?: boolean; loading?: boolean }>(), { cloud: false, loading: false });
const emit = defineEmits<{ close: []; save: [settings: Settings] }>();
const draft = ref<Settings>({ ...props.initial });
const preference = ref<LocalePreference>(getLocalePreference());
const deviceTags = navigator.languages?.length ? [...navigator.languages] : [navigator.language];
const deviceLabel = LOCALES.find(item => item.code === matchLocale(deviceTags))?.label ?? '';
const languageOptions: { value: LocalePreference; label: string }[] = [
  { value: 'auto', label: t('跟随设备（{language}）', { language: deviceLabel }) },
  ...LOCALES.map(item => ({ value: item.code as LocalePreference, label: item.label })),
];
function chooseLanguage(value: LocalePreference) {
  preference.value = value;
  setLocalePreference(value);
}
async function checkConnection() {
  invalidateStatus();
  const status = await loadStatus();
  notify(status.ready ? t('创作服务已连接。') : t('创作服务尚未就绪，请联系服务提供方。'));
}
</script>
