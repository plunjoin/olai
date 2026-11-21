import type { Component } from 'vue';

/** One option in the shared custom Select. */
export interface SelectOption {
  value: string;
  label: string;
  /** 键盘输入检索用的纯文本，默认取 label。 */
  text?: string;
  disabled?: boolean;
  icon?: Component;
}
