<template>
  <Dialog
    :labelled-by="labelledBy"
    :described-by="describedBy"
    :class-name="['app-dialog', className]"
    :close-on-backdrop="closeOnBackdrop"
    :lock-scroll="false"
    unstyled
    @close="emit('close')"
  >
    <slot />
  </Dialog>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import { Dialog } from 'familiar-vue/dialog';
import { lockBodyScroll } from '../lib/scrollLock';

// The library dialog brings its own scroll lock, but the studio counts every
// overlay — the player and the plaza detail included — on one shared lock.
// This wrapper keeps that count and asks the library not to lock on its own.
withDefaults(defineProps<{ labelledBy: string; describedBy?: string; className?: string; closeOnBackdrop?: boolean }>(), {
  describedBy: undefined, className: '', closeOnBackdrop: true,
});
const emit = defineEmits<{ close: [] }>();

let releaseScroll: (() => void) | null = null;
onMounted(() => { releaseScroll = lockBodyScroll(); });
onBeforeUnmount(() => { releaseScroll?.(); releaseScroll = null; });
</script>
