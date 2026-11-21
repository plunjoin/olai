<template>
  <section v-if="!embedded" class="generation-panel"><slot /></section>
  <Teleport v-else-if="host" :to="host">
    <div class="creation-parameters">
      <div class="parameters-heading"><h2>{{ t('创作参数') }}</h2></div>
      <p class="parameters-summary">{{ summary }}</p>
      <div class="parameters-scroll"><slot /></div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { t } from '../../lib/i18n';

withDefaults(defineProps<{ embedded?: boolean; host?: HTMLElement | null; summary: string }>(), {
  embedded: false,
  host: null,
});
</script>
