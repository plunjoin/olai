export const IMAGE_RATIOS = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '4:5', '5:4', '21:9'];
export function normalizeRatio(value: string): string {
  if (value === 'auto') return value;
  const match = value.trim().match(/^(\d{1,4}(?:\.\d{1,2})?)\s*[:：/]\s*(\d{1,4}(?:\.\d{1,2})?)$/);
  if (!match || Number(match[1]) <= 0 || Number(match[2]) <= 0) throw new Error('请填写有效比例，例如 16:9 或 2.35:1。');
  return `${Number(match[1])}:${Number(match[2])}`;
}
export function imageDimensions(ratio: string, quality: string): string | undefined {
  if (ratio === 'auto') return undefined;
  const [w, h] = normalizeRatio(ratio).split(':').map(Number);
  const edge = quality === '4K' ? 4096 : quality === '2K' ? 2048 : 1024;
  return `${Math.max(1, Math.round(edge * Math.min(1, w / h)))}x${Math.max(1, Math.round(edge * Math.min(1, h / w)))}`;
}
