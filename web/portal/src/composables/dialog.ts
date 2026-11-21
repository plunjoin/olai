import { ref } from 'vue';

interface DialogRequest {
  title: string;
  description: string;
  value?: string;
  confirmLabel?: string;
  danger?: boolean;
  kind: 'confirm' | 'prompt';
}

export const dialogRequest = ref<DialogRequest | null>(null);
export const dialogValue = ref('');
let resolveCurrent: ((value: string | boolean | null) => void) | null = null;

function finish(result: string | boolean | null) {
  resolveCurrent?.(result);
  resolveCurrent = null;
  dialogRequest.value = null;
}

export function confirmAction(title: string, description: string, confirmLabel = '确认删除', danger = true): Promise<boolean> {
  return new Promise(resolve => {
    resolveCurrent?.(null);
    resolveCurrent = value => resolve(value === true);
    dialogValue.value = '';
    dialogRequest.value = { title, description, confirmLabel, danger, kind: 'confirm' };
  });
}

export function promptAction(title: string, description: string, initial = ''): Promise<string | null> {
  return new Promise(resolve => {
    resolveCurrent?.(null);
    resolveCurrent = value => resolve(typeof value === 'string' ? value : null);
    dialogValue.value = initial;
    dialogRequest.value = { title, description, value: initial, kind: 'prompt' };
  });
}

export function resolveDialog(result: string | boolean | null) { finish(result); }
