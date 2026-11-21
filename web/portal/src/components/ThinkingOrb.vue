<template>
  <div class="thinking-orb-container" role="status">
    <BrandLogo :size="size" />
    <span class="thinking-orb-label">{{ label }}</span>
    <span class="thinking-dots" aria-hidden="true"><i /><i /><i /></span>
  </div>
</template>

<script setup lang="ts">
import BrandLogo from './BrandLogo.vue';
import { t } from '../lib/i18n';

withDefaults(defineProps<{ size?: number; label?: string }>(), { size: 28, label: t('小o 正在思考…') });
</script>
