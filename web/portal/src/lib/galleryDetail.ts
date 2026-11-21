import { intlLocale, t, tIn } from './i18n';
import type { Asset, MediaKind } from './types';

const KIND_LABELS: Record<MediaKind, string> = { image: tIn('gallery', '图像'), video: tIn('gallery', '视频'), music: tIn('gallery', '音乐') };
const MODEL_LABELS: Record<MediaKind, string> = {
  image: 'Olai Image Engine',
  video: 'Olai Video Engine',
  music: 'Olai Music Engine',
};

export interface GalleryParameter { label: string; value: string }

export function galleryKindLabel(kind: MediaKind): string {
  return KIND_LABELS[kind] ?? t('作品');
}

export function galleryModelLabel(kind: MediaKind): string {
  return MODEL_LABELS[kind] ?? 'Olai Engine';
}

/** The public gallery shows a short, human title; the full prompt lives in the detail panel. */
export function galleryTitle(asset: Asset): string {
  if (asset.kind === 'music' && asset.song?.title?.trim()) return asset.song.title.trim().slice(0, 80);
  const line = (asset.prompt || '').trim().split('\n')[0]?.trim() ?? '';
  return line.slice(0, 80) || (asset.kind === 'music' ? t('未命名歌曲') : t('未命名作品'));
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
    return requested === 'auto' ? t('自动') : requested;
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
  if (!Number.isFinite(date.getTime())) return t('时间未知');
  return date.toLocaleDateString(intlLocale(), { year: 'numeric', month: 'long', day: 'numeric' });
}

const EFFORT_LABELS: Record<string, string> = {
  minimal: t('Minimal · 轻度'), medium: t('Medium · 适中'), high: t('High · 丰富'),
};
const MUSIC_MODE_LABELS: Record<string, string> = { inspiration: t('灵感模式'), composer: 'Composer' };

/** Generation facts for the expanded detail panel. Engagement counts stay in the stats row. */
export function galleryParameters(asset: Asset): GalleryParameter[] {
  const output: GalleryParameter[] = [
    { label: t('作品类型'), value: galleryKindLabel(asset.kind) },
    // The public alias recorded when the work was generated; older works fall
    // back to the engine family they were made with.
    { label: t('模型'), value: (asset.modelLabel || '').trim() || galleryModelLabel(asset.kind) },
  ];
  const ratio = assetRatio(asset);
  if (ratio) output.push({ label: t('画面比例'), value: ratio });

  if (asset.kind === 'image') {
    const target = asset.options.image_size;
    if (typeof target === 'string' && target) output.push({ label: t('目标分辨率'), value: target });
    const actual = pixelSize(asset);
    if (actual) output.push({ label: t('实际尺寸'), value: t('{size} 像素', { size: actual }) });
  }

  if (asset.kind === 'video') {
    const target = asset.options.resolution;
    if (typeof target === 'string' && target) output.push({ label: t('视频分辨率'), value: target === '4k' ? '4K' : target });
    const seconds = typeof asset.options.duration === 'number' ? asset.options.duration : asset.options.seconds;
    if (typeof seconds === 'number' && seconds > 0) output.push({ label: t('视频时长'), value: t('{seconds} 秒', { seconds }) });
  }

  if (asset.kind === 'image' || asset.kind === 'video') {
    const effort = asset.options.reasoning_effort;
    if (typeof effort === 'string' && EFFORT_LABELS[effort]) output.push({ label: t('联想等级'), value: EFFORT_LABELS[effort] });
  }

  if (asset.kind === 'music') {
    const mode = asset.options.music_mode;
    if (typeof mode === 'string' && MUSIC_MODE_LABELS[mode]) output.push({ label: t('创作模式'), value: MUSIC_MODE_LABELS[mode] });
    if (asset.song?.style) output.push({ label: t('音乐风格'), value: asset.song.style });
    if (asset.song) output.push({ label: t('演唱方式'), value: asset.song.instrumental ? t('纯音乐') : t('人声歌曲') });
    const seconds = asset.audioDuration || (typeof asset.options.duration === 'number' ? asset.options.duration : 0);
    if (seconds && Number.isFinite(seconds)) output.push({ label: t('音频时长'), value: formatDuration(seconds) });
  }

  output.push({ label: t('发布时间'), value: galleryPublishedAt(asset.createdAt) });
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
