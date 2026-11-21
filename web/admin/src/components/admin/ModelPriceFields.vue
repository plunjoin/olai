<template>
  <div v-if="row.kind === 'image' || row.kind === 'video'" class="adm-price-grid">
    <label v-for="tier in tiers" :key="tier">
      <span>{{ tierLabel(tier) }}{{ row.kind === 'video' ? t(' / 秒') : '' }}</span>
      <input class="adm-input" type="number" min="0" max="1000000" step="1" :value="bucket[tier] ?? 0" :aria-label="t('{tier} 价格', { tier: tierLabel(tier) })" @change="change(tier, $event)" />
    </label>
  </div>
  <label v-else class="adm-price-unit">
    <span>{{ row.kind === 'music' ? t('每分钟') : t('每条消息') }}</span>
    <input class="adm-input" type="number" min="0" max="1000000" :step="row.kind === 'chat' ? 0.01 : 1" :value="bucket[unit] ?? 0" :aria-label="t('{kind}价格', { kind: row.kind === 'music' ? t('每分钟') : t('每条消息') })" @change="change(unit, $event)" />
  </label>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ModelPrices } from '../../lib/types';
import { t } from '../../lib/i18n';

interface Row { kind: 'chat' | 'image' | 'video' | 'music'; prices: ModelPrices; tiers?: string[] }
const props = defineProps<{ row: Row }>();
const emit = defineEmits<{ change: [group: string, key: string, value: number] }>();
const allTiers = computed(() => props.row.kind === 'image' ? ['1K', '2K', '4K'] : ['360p', '720p', '1080p', '4k']);
const tiers = computed(() => {
  const supported = props.row.tiers;
  return supported?.length ? allTiers.value.filter(tier => supported.includes(tier)) : allTiers.value;
});
const unit = computed(() => props.row.kind === 'music' ? 'perMinute' : 'perMessage');
const bucket = computed(() => ((props.row.prices as Record<string, Record<string, number>>)[props.row.kind] ?? {}));
const tierLabel = (tier: string) => tier === '4k' ? '4K' : tier;
function change(key: string, event: Event) {
  emit('change', props.row.kind, key, Number((event.target as HTMLInputElement).value));
}
</script>
