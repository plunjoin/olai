<template>
  <img
    v-if="!interactive"
    src="/brand/olai-mascot.png"
    alt=""
    aria-hidden="true"
    width="590"
    height="500"
    class="companion"
    :class="[animated ? 'companion-float' : '', className]"
    :style="{ width: `${size}px` }"
    draggable="false"
  />
  <span
    v-else
    ref="wrapper"
    class="companion companion-interactive"
    :class="[animated ? 'companion-float' : '', className]"
    :style="{ width: `${size}px` }"
    role="img"
    :aria-label="t('小o，你的灵感伙伴')"
  >
    <img src="/brand/xiao-o-idle.png" alt="" width="590" height="500" draggable="false" />
    <svg viewBox="0 0 590 500" class="companion-face" aria-hidden="true">
      <g ref="gaze" class="companion-gaze">
        <g transform="translate(249.5 253) rotate(-13)">
          <g class="companion-eye" :class="{ 'is-blinking': blinking }"><rect x="-19" y="-31" width="38" height="62" rx="19" fill="#202957" /></g>
        </g>
        <g transform="translate(371.5 222) rotate(-13)">
          <g class="companion-eye" :class="{ 'is-blinking': blinking }"><rect x="-19" y="-31" width="38" height="62" rx="19" fill="#202957" /></g>
        </g>
      </g>
    </svg>
  </span>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { t } from '../lib/i18n';

const props = withDefaults(defineProps<{ size?: number; className?: string; animated?: boolean; interactive?: boolean }>(), {
  size: 140,
  className: '',
  animated: false,
  interactive: false,
});

const wrapper = ref<HTMLSpanElement | null>(null);
const gaze = ref<SVGGElement | null>(null);
const blinking = ref(false);

let frame = 0;
let blinkTimer: ReturnType<typeof setTimeout> | undefined;
let openTimer: ReturnType<typeof setTimeout> | undefined;
let motion: MediaQueryList | null = null;
let pointer: MediaQueryList | null = null;
let target = { x: 0, y: 0 };
let current = { x: 0, y: 0 };

function reset() {
  target = { x: 0, y: 0 };
  if (!frame && motion && !motion.matches && !document.hidden) frame = requestAnimationFrame(tick);
}

function move(event: PointerEvent) {
  if (!pointer?.matches || motion?.matches || event.pointerType === 'touch' || document.querySelector('dialog[open]')) return;
  const rect = wrapper.value?.getBoundingClientRect();
  if (!rect) return;
  target = {
    x: Math.max(-12, Math.min(12, (event.clientX - rect.left - rect.width / 2) / window.innerWidth * 30)),
    y: Math.max(-9, Math.min(9, (event.clientY - rect.top - rect.height / 2) / window.innerHeight * 23)),
  };
  if (!frame) frame = requestAnimationFrame(tick);
}

function tick() {
  current.x += (target.x - current.x) * 0.12;
  current.y += (target.y - current.y) * 0.12;
  gaze.value?.setAttribute('transform', `translate(${current.x.toFixed(2)} ${current.y.toFixed(2)})`);
  frame = Math.abs(target.x - current.x) + Math.abs(target.y - current.y) > 0.02 ? requestAnimationFrame(tick) : 0;
}

function blink() {
  blinkTimer = setTimeout(() => {
    if (!document.hidden) {
      blinking.value = true;
      openTimer = setTimeout(() => { blinking.value = false; }, 150);
    }
    blink();
  }, 2800 + Math.random() * 3500);
}

function configure() {
  cancelAnimationFrame(frame);
  clearTimeout(blinkTimer);
  clearTimeout(openTimer);
  frame = 0;
  target = { x: 0, y: 0 };
  current = { x: 0, y: 0 };
  blinking.value = false;
  gaze.value?.setAttribute('transform', 'translate(0 0)');
  if (motion && !motion.matches && !document.hidden) blink();
}

onMounted(() => {
  if (!props.interactive) return;
  motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  pointer = window.matchMedia('(pointer: fine)');
  configure();
  window.addEventListener('pointermove', move, { passive: true });
  document.documentElement.addEventListener('pointerleave', reset);
  window.addEventListener('blur', reset);
  motion.addEventListener('change', configure);
  pointer.addEventListener('change', configure);
  document.addEventListener('visibilitychange', configure);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(frame);
  clearTimeout(blinkTimer);
  clearTimeout(openTimer);
  window.removeEventListener('pointermove', move);
  document.documentElement.removeEventListener('pointerleave', reset);
  window.removeEventListener('blur', reset);
  motion?.removeEventListener('change', configure);
  pointer?.removeEventListener('change', configure);
  document.removeEventListener('visibilitychange', configure);
});
</script>
