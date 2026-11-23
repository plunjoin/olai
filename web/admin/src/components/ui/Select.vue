<template>
  <span class="sel">
    <button
      ref="triggerRef"
      type="button"
      class="sel-trigger"
      :class="className"
      role="combobox"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="open ? listId : undefined"
      :aria-activedescendant="open && active >= 0 ? optionId(active) : undefined"
      :aria-label="ariaLabel"
      :aria-labelledby="ariaLabelledby"
      :title="title"
      :disabled="disabled"
      @click="toggle"
      @keydown="onKeydown"
    >
      <span class="sel-value"><slot name="value" :option="current">{{ current ? current.label : placeholder }}</slot></span>
      <ChevronDown :size="15" class="sel-chevron" aria-hidden="true" />
    </button>
  </span>
  <Teleport v-if="open && portalHost" :to="portalHost">
    <div
      ref="menuRef"
      :id="listId"
      role="listbox"
      :aria-label="ariaLabel"
      :aria-labelledby="ariaLabelledby"
      class="sel-menu"
      :class="menuClassName"
      :data-placement="position?.placement"
      :style="menuStyle"
      @keydown="onKeydown"
    >
      <div
        v-for="(option, index) in options"
        :id="optionId(index)"
        :key="`${option.value}-${index}`"
        role="option"
        :aria-selected="option.value === modelValue"
        :aria-disabled="option.disabled || undefined"
        :data-active="index === active || undefined"
        class="sel-option"
        :title="option.text ?? option.label"
        @mousedown.prevent
        @mouseenter="!option.disabled && (active = index)"
        @click="choose(index)"
      >
        <span v-if="option.icon" class="sel-option-icon"><component :is="option.icon" /></span>
        <span class="sel-option-label">{{ option.label }}</span>
        <Check v-if="option.value === modelValue" :size="14" class="sel-check" aria-hidden="true" />
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import { Check, ChevronDown } from 'lucide-vue-next';
import type { SelectOption } from './select';

const props = withDefaults(defineProps<{
  modelValue: string;
  options: SelectOption[];
  ariaLabel?: string;
  ariaLabelledby?: string;
  placeholder?: string;
  className?: string;
  menuClassName?: string;
  disabled?: boolean;
  title?: string;
  maxHeight?: number;
}>(), {
  ariaLabel: undefined,
  ariaLabelledby: undefined,
  placeholder: '',
  className: '',
  menuClassName: '',
  disabled: false,
  title: undefined,
  maxHeight: 320,
});
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

type Placement = 'top' | 'bottom';
interface MenuPosition { top: number; left: number; width: number; maxHeight: number; placement: Placement }

const MENU_GAP = 6;
const VIEWPORT_PAD = 8;

const triggerRef = ref<HTMLButtonElement | null>(null);
const menuRef = ref<HTMLDivElement | null>(null);
const open = ref(false);
const active = ref(-1);
const position = ref<MenuPosition | null>(null);
const portalHost = ref<HTMLElement | null>(null);
const typed = { text: '', at: 0 };
// 后台虽然是 SPA，仍用 useId 避免实例 id 随刷新变化；与 portal 保持一致。
const instanceId = `olai-sel-${useId()}`;
const listId = `${instanceId}-listbox`;
const optionId = (index: number) => `${instanceId}-option-${index}`;
const current = computed(() => props.options.find(option => option.value === props.modelValue));
const menuStyle = computed(() => position.value ? {
  top: `${position.value.top}px`,
  left: `${position.value.left}px`,
  width: `${position.value.width}px`,
  maxHeight: `${position.value.maxHeight}px`,
} : { top: '0px', left: '0px', visibility: 'hidden' as const });

function place() {
  const trigger = triggerRef.value;
  if (!trigger) return;
  const rect = trigger.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  if (rect.bottom < 0 || rect.top > viewportHeight) { open.value = false; return; }
  const width = Math.min(Math.max(rect.width, 200), Math.min(viewportWidth - VIEWPORT_PAD * 2, 360));
  const left = Math.max(VIEWPORT_PAD, Math.min(rect.left, viewportWidth - width - VIEWPORT_PAD));
  const wanted = Math.min(menuRef.value?.offsetHeight || props.maxHeight, props.maxHeight);
  const belowSpace = viewportHeight - rect.bottom - VIEWPORT_PAD;
  const aboveSpace = rect.top - VIEWPORT_PAD;
  const below = belowSpace >= wanted || belowSpace >= aboveSpace;
  const available = below ? belowSpace : aboveSpace;
  position.value = {
    top: below ? rect.bottom + MENU_GAP : Math.max(VIEWPORT_PAD, rect.top - Math.min(wanted, available) - MENU_GAP),
    left,
    width,
    maxHeight: Math.min(props.maxHeight, Math.max(96, available)),
    placement: below ? 'bottom' : 'top',
  };
}

async function show() {
  if (props.disabled) return;
  portalHost.value = (triggerRef.value?.closest('dialog[open]') as HTMLElement | null) ?? document.body;
  open.value = true;
  const selected = props.options.findIndex(option => option.value === props.modelValue && !option.disabled);
  active.value = selected >= 0 ? selected : props.options.findIndex(option => !option.disabled);
  await nextTick();
  place();
}
function toggle() { if (open.value) open.value = false; else void show(); }

function choose(index: number) {
  const option = props.options[index];
  if (!option || option.disabled) return;
  emit('update:modelValue', option.value);
  open.value = false;
  triggerRef.value?.focus();
}
function move(step: 1 | -1) {
  if (!props.options.length) return;
  let index = active.value < 0 ? (step > 0 ? -1 : 0) : active.value;
  for (let count = 0; count < props.options.length; count++) {
    index = (index + step + props.options.length) % props.options.length;
    if (!props.options[index].disabled) { active.value = index; return; }
  }
}
function jump(edge: 'first' | 'last') {
  const indexes = props.options.map((_, index) => edge === 'first' ? index : props.options.length - 1 - index);
  const target = indexes.find(index => !props.options[index].disabled);
  if (target !== undefined) active.value = target;
}
function typeahead(char: string) {
  const now = Date.now();
  if (now - typed.at > 600) typed.text = '';
  typed.text += char.toLowerCase();
  typed.at = now;
  for (let offset = 1; offset <= props.options.length; offset++) {
    const index = (active.value + offset + props.options.length * 2) % props.options.length;
    const option = props.options[index];
    if (option.disabled) continue;
    if ((option.text ?? option.label).toLowerCase().startsWith(typed.text)) { active.value = index; return; }
  }
}
function onKeydown(event: KeyboardEvent) {
  if (props.disabled) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (!open.value) void show(); else move(event.key === 'ArrowDown' ? 1 : -1);
    return;
  }
  if (event.key === 'Home' || event.key === 'End') {
    if (!open.value) return;
    event.preventDefault();
    jump(event.key === 'Home' ? 'first' : 'last');
    return;
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (!open.value) void show(); else if (active.value >= 0) choose(active.value);
    return;
  }
  if (event.key === 'Escape') {
    if (!open.value) return;
    event.preventDefault();
    event.stopPropagation();
    open.value = false;
    triggerRef.value?.focus();
    return;
  }
  if (event.key === 'Tab') {
    if (open.value) open.value = false;
    return;
  }
  if (open.value && event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) typeahead(event.key);
}

function onPointerDown(event: PointerEvent) {
  const target = event.target as Node;
  if (triggerRef.value?.contains(target) || menuRef.value?.contains(target)) return;
  open.value = false;
}
function onScroll(event: Event) {
  if (menuRef.value?.contains(event.target as Node)) return;
  place();
}
watch(open, value => {
  if (value) {
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
  } else {
    position.value = null;
    document.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', place);
  }
});
watch(active, index => {
  if (!open.value || index < 0) return;
  document.getElementById(optionId(index))?.scrollIntoView({ block: 'nearest' });
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown);
  window.removeEventListener('scroll', onScroll, true);
  window.removeEventListener('resize', place);
});
</script>
