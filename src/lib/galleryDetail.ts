import type { Asset, MediaKind } from './types';

const KIND_LABELS: Record<MediaKind, string> = { image: '图像', video: '视频', music: '音乐' };
const MODEL_LABELS: Record<MediaKind, string> = {
  image: 'Olai Image Engine',
  video: 'Olai Video Engine',
  music: 'Olai Music Engine',
};

export interface GalleryParameter { label: string; value: string }

export function galleryKindLabel(kind: MediaKind): string {
  return KIND_LABELS[kind] ?? '作品';
}

export function galleryModelLabel(kind: MediaKind): string {
  return MODEL_LABELS[kind] ?? 'Olai Engine';
}

/** The public gallery shows a short, human title; the full prompt lives in the detail panel. */
export function galleryTitle(asset: Asset): string {
  if (asset.kind === 'music' && asset.song?.title?.trim()) return asset.song.title.trim().slice(0, 80);
  const line = asset.prompt.trim().split('\n')[0]?.trim() ?? '';
  return line.slice(0, 80) || (asset.kind === 'music' ? '未命名歌曲' : '未命名作品');
}

function pixelSize(asset: Asset): string | undefined {
  const width = asset.imageWidth;
  const height = asset.imageHeight;
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height)) return undefined;
  return `${Math.round(width)} × ${Math.round(height)}`;
}

function greatestCommonDivisor(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

/** Prefer the requested ratio, then fall back to the actual pixel ratio. */
function assetRatio(asset: Asset): string | undefined {
  const requested = asset.options.aspect_ratio;
  if (typeof requested === 'string' && /^(?:auto|\d{1,4}:\d{1,4})$/.test(requested)) {
    return requested === 'auto' ? '自动' : requested;
  }
  const width = asset.imageWidth;
  const height = asset.imageHeight;
  if (!width || !height) return undefined;
  const divisor = greatestCommonDivisor(width, height);
  const w = Math.round(width / divisor);
  const h = Math.round(height / divisor);
  // Very unusual sizes are clearer as raw pixels than as huge fractions.
  return w <= 64 && h <= 64 ? `${w} : ${h}` : undefined;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

export function galleryPublishedAt(createdAt: number): string {
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime())) return '时间未知';
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Read-only facts for the expanded detail panel. */
export function galleryParameters(asset: Asset): GalleryParameter[] {
  const output: GalleryParameter[] = [
    { label: '作品类型', value: galleryKindLabel(asset.kind) },
    { label: '模型', value: galleryModelLabel(asset.kind) },
  ];
  const ratio = assetRatio(asset);
  if (ratio) output.push({ label: '画面比例', value: ratio });

  if (asset.kind === 'image') {
    const target = asset.options.image_size;
    if (typeof target === 'string' && target) output.push({ label: '目标分辨率', value: target });
    const actual = pixelSize(asset);
    if (actual) output.push({ label: '实际尺寸', value: `${actual} 像素` });
  }

  if (asset.kind === 'video' && typeof asset.options.duration === 'number' && asset.options.duration > 0) {
    output.push({ label: '视频时长', value: `${asset.options.duration} 秒` });
  }

  if (asset.kind === 'music') {
    if (asset.song?.style) output.push({ label: '音乐风格', value: asset.song.style });
    if (asset.song) output.push({ label: '演唱方式', value: asset.song.instrumental ? '纯音乐' : '人声歌曲' });
    const seconds = asset.audioDuration || (typeof asset.options.duration === 'number' ? asset.options.duration : 0);
    if (seconds && Number.isFinite(seconds)) output.push({ label: '音频时长', value: formatDuration(seconds) });
  }

  output.push({ label: '发布时间', value: galleryPublishedAt(asset.createdAt) });
  return output;
}

/** Parameters the generation panel can pick up again without exposing private options. */
export function galleryReuseOptions(asset: Asset): Record<string, string | number> {
  const output: Record<string, string | number> = {};
  const ratio = asset.options.aspect_ratio;
  if (typeof ratio === 'string' && /^(?:auto|\d{1,4}:\d{1,4})$/.test(ratio)) output.aspect_ratio = ratio;
  else if (asset.imageWidth && asset.imageHeight) {
    const divisor = greatestCommonDivisor(asset.imageWidth, asset.imageHeight);
    const w = Math.round(asset.imageWidth / divisor);
    const h = Math.round(asset.imageHeight / divisor);
    if (w > 0 && h > 0 && w <= 64 && h <= 64) output.aspect_ratio = `${w}:${h}`;
  }
  if (['1K', '2K', '4K'].includes(String(asset.options.image_size))) output.image_size = String(asset.options.image_size);
  if (asset.kind === 'video' && typeof asset.options.duration === 'number' && asset.options.duration > 0) {
    output.duration = asset.options.duration;
  }
  return output;
}
