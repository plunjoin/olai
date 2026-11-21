<template>
  <svg class="audio-progress-ring" :class="className" viewBox="0 0 100 100" aria-hidden="true">
    <circle class="ring-track" cx="50" cy="50" :r="radius" />
    <circle
      class="ring-value"
      cx="50"
      cy="50"
      :r="radius"
      :stroke-dasharray="circumference"
      :stroke-dashoffset="circumference * (1 - value / 100)"
    />
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{ progress: number; className?: string }>(), { className: '' });
const radius = 46;
const circumference = 2 * Math.PI * radius;
const value = computed(() => Math.min(100, Math.max(0, props.progress)));
</script>
