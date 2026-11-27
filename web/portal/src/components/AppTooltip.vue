<template>
  <Tooltip :path="route.fullPath" />
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router';
import { Tooltip } from 'familiar-vue/tooltip';

const route = useRoute();
</script>
