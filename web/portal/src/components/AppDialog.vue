<template>
  <Teleport to="body">
    <dialog ref="dialogRef" class="app-dialog" :class="className" :aria-labelledby="labelledBy" :aria-describedby="describedBy" @keydown.esc.stop @cancel.prevent="close">
      <slot />
    </dialog>
  </Teleport>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { lockBodyScroll } from '../lib/scrollLock';

const props = withDefaults(defineProps<{ labelledBy: string; describedBy?: string; className?: string; closeOnBackdrop?: boolean }>(), {
  describedBy: undefined, className: '', closeOnBackdrop: true,
});
const emit = defineEmits<{ close: [] }>();
const dialogRef = ref<HTMLDialogElement | null>(null);
let previous: HTMLElement | null = null;
let releaseScroll: (() => void) | null = null;

function close() { emit('close'); }
function onPointer(event: MouseEvent) {
  if (!props.closeOnBackdrop) return;
  const dialog = dialogRef.value;
  if (!dialog || event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
}
onMounted(() => {
  previous = document.activeElement as HTMLElement | null;
  releaseScroll = lockBodyScroll();
  dialogRef.value?.showModal();
  dialogRef.value?.querySelector<HTMLElement>('[data-dialog-focus]')?.focus();
});
onBeforeUnmount(() => {
  dialogRef.value?.close();
  releaseScroll?.();
  releaseScroll = null;
  if (previous?.isConnected) previous.focus();
});
</script>
