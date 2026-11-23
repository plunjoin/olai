<template>
  <div
    v-if="text"
    ref="tooltipRef"
    class="app-tooltip"
    :class="{ 'is-visible': visible }"
    role="tooltip"
    aria-hidden="true"
  >
    {{ text }}
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

const SHOW_DELAY = 80;
const VIEWPORT_GAP = 8;
const TARGET_GAP = 10;

const route = useRoute();
const tooltipRef = ref<HTMLElement | null>(null);
const text = ref('');
const visible = ref(false);
let activeTarget: HTMLElement | null = null;
let showTimer: ReturnType<typeof setTimeout> | undefined;

function tooltipTarget(node: EventTarget | null) {
  if (!(node instanceof Element)) return null;
  const target = node.closest<HTMLElement>('[data-tip]');
  const label = target?.dataset.tip?.trim();
  if (!target || !label || target.getAttribute('aria-expanded') === 'true') return null;
  return target;
}

function hide() {
  if (showTimer) {
    clearTimeout(showTimer);
    showTimer = undefined;
  }
  activeTarget = null;
  visible.value = false;
  text.value = '';
}

function position() {
  const target = activeTarget;
  const tooltip = tooltipRef.value;
  if (!target || !tooltip) return;

  const anchor = target.getBoundingClientRect();
  const box = tooltip.getBoundingClientRect();
  let left = anchor.right + TARGET_GAP;

  if (left + box.width > window.innerWidth - VIEWPORT_GAP) {
    left = anchor.left - box.width - TARGET_GAP;
  }
  left = Math.min(Math.max(VIEWPORT_GAP, left), window.innerWidth - box.width - VIEWPORT_GAP);

  const center = anchor.top + anchor.height / 2;
  const top = Math.min(
    Math.max(VIEWPORT_GAP + box.height / 2, center),
    window.innerHeight - VIEWPORT_GAP - box.height / 2,
  );

  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(top)}px`;
}

async function show(target: HTMLElement, immediate = false) {
  const label = target.dataset.tip?.trim();
  if (!label) return;

  if (showTimer) {
    clearTimeout(showTimer);
    showTimer = undefined;
  }
  activeTarget = target;
  visible.value = false;
  text.value = label;

  if (!immediate) {
    showTimer = setTimeout(() => {
      showTimer = undefined;
      void show(target, true);
    }, SHOW_DELAY);
    return;
  }

  await nextTick();
  if (activeTarget !== target) return;
  position();
  visible.value = true;
}

function onPointerOver(event: PointerEvent) {
  if (event.pointerType === 'touch') return;
  const target = tooltipTarget(event.target);
  if (target) void show(target);
}

function onPointerOut(event: PointerEvent) {
  const target = tooltipTarget(event.target);
  if (!target || target !== activeTarget) return;
  if (event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) return;
  hide();
}

function onFocusIn(event: FocusEvent) {
  const target = tooltipTarget(event.target);
  if (target) void show(target, true);
}

function onFocusOut(event: FocusEvent) {
  const target = tooltipTarget(event.target);
  if (!target || target !== activeTarget) return;
  if (event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) return;
  hide();
}

function onViewportChange() {
  if (!activeTarget || !visible.value) return;
  const box = activeTarget.getBoundingClientRect();
  if (box.bottom < 0 || box.top > window.innerHeight || box.right < 0 || box.left > window.innerWidth) {
    hide();
    return;
  }
  position();
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') hide();
}

watch(() => route.fullPath, hide);

onMounted(() => {
  document.addEventListener('pointerover', onPointerOver);
  document.addEventListener('pointerout', onPointerOut);
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusout', onFocusOut);
  document.addEventListener('click', hide, true);
  document.addEventListener('keydown', onKeydown);
  window.addEventListener('scroll', onViewportChange, true);
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('blur', hide);
});

onBeforeUnmount(() => {
  if (showTimer) clearTimeout(showTimer);
  document.removeEventListener('pointerover', onPointerOver);
  document.removeEventListener('pointerout', onPointerOut);
  document.removeEventListener('focusin', onFocusIn);
  document.removeEventListener('focusout', onFocusOut);
  document.removeEventListener('click', hide, true);
  document.removeEventListener('keydown', onKeydown);
  window.removeEventListener('scroll', onViewportChange, true);
  window.removeEventListener('resize', onViewportChange);
  window.removeEventListener('blur', hide);
});
</script>

<style scoped>
.app-tooltip {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 2147483000;
  padding: 6px 9px;
  border-radius: 8px;
  background: #1e1c19;
  color: #fff;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.2;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transform: translateY(-50%);
  transition: opacity 0.12s ease;
}

.app-tooltip.is-visible {
  opacity: 1;
  visibility: visible;
}

@media (hover: none) {
  .app-tooltip {
    display: none;
  }
}
</style>
