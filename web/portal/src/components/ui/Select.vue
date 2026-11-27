<template>
  <LibrarySelect
    :model-value="modelValue"
    :options="options"
    :aria-label="ariaLabel"
    :aria-labelledby="ariaLabelledby"
    :placeholder="placeholder"
    :class-name="className"
    :menu-class-name="menuClassName"
    :disabled="disabled"
    :title="title"
    :max-height="maxHeight"
    :classes="studioClasses"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template v-if="slots.value" #value="slotProps">
      <slot name="value" :option="slotProps.option" />
    </template>
  </LibrarySelect>
</template>

<script setup lang="ts">
import { useSlots } from 'vue';
import { Select as LibrarySelect } from 'familiar-vue/select';
import type { SelectClasses } from 'familiar-vue/select';
import type { SelectOption } from './select';

// The studio's stylesheet already paints `.sel`, `.sel-trigger` and the rest.
// Naming those classes here keeps that look; the behaviour comes from the library.
const slots = useSlots();
const studioClasses: SelectClasses = {
  root: 'sel',
  trigger: 'sel-trigger',
  value: 'sel-value',
  chevron: 'sel-chevron',
  menu: 'sel-menu',
  option: 'sel-option',
  optionIcon: 'sel-option-icon',
  optionLabel: 'sel-option-label',
  check: 'sel-check',
};

withDefaults(defineProps<{
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
</script>
