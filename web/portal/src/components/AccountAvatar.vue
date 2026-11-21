<template>
  <span v-if="uploaded" class="account-avatar-media account-avatar-uploaded" :class="className" aria-hidden="true">
    <BrandLogo :size="size" />
    <img :src="uploaded" alt="" draggable="false" @error="hideImage" />
  </span>
  <span
    v-else
    class="account-avatar-media"
    :class="className"
    aria-hidden="true"
    :style="theme ? { background: theme.background, fontSize: `${Math.max(11, Math.round(size * 0.44))}px` } : undefined"
  >
    <template v-if="theme">{{ initial }}</template>
    <BrandLogo v-else :size="size" />
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import BrandLogo from './BrandLogo.vue';
import { avatarInitial, avatarTheme, uploadedAvatarURL } from '../lib/profile';

const props = withDefaults(defineProps<{ name: string; avatar?: string | null; size: number; className?: string }>(), { className: '' });
const uploaded = computed(() => uploadedAvatarURL(props.avatar));
const theme = computed(() => avatarTheme(props.avatar));
const initial = computed(() => avatarInitial(props.name));
function hideImage(event: Event) { (event.currentTarget as HTMLImageElement).hidden = true; }
</script>
