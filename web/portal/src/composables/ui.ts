import { ref } from 'vue';

export const toastText = ref('');
let timer: ReturnType<typeof setTimeout> | undefined;

export function notify(text: string, timeout = 5000) {
  toastText.value = text;
  clearTimeout(timer);
  timer = setTimeout(() => { toastText.value = ''; }, timeout);
}

export function clearToast() {
  clearTimeout(timer);
  toastText.value = '';
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
