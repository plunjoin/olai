import { safeMediaURL } from './api';

/** Longest edge of the generated cover, keeping card thumbnails small. */
const MAX_EDGE = 800;
const SAMPLE_WIDTH = 64;
const LOAD_TIMEOUT = 15_000;
const SEEK_TIMEOUT = 10_000;

function waitForEvent(video: HTMLVideoElement, event: keyof HTMLMediaElementEventMap, timeout: number, message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      video.removeEventListener(event, ready);
      video.removeEventListener('error', failed);
      if (error) reject(error); else resolve();
    };
    const ready = () => finish();
    const failed = () => finish(new Error('无法读取视频画面。'));
    const timer = setTimeout(() => finish(new Error(message)), timeout);
    video.addEventListener(event, ready);
    video.addEventListener('error', failed);
  });
}

async function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  const target = Math.max(0, time);
  if (Math.abs(video.currentTime - target) < 0.05 && video.readyState >= 2) return;
  const seeked = waitForEvent(video, 'seeked', SEEK_TIMEOUT, '视频跳转超时。');
  try { video.currentTime = target; } catch { /* Await the seek anyway. */ }
  await seeked;
  // A seeked event may land before the frame is decodable; wait for one more.
  if (video.readyState < 2) await waitForEvent(video, 'loadeddata', SEEK_TIMEOUT, '视频画面加载超时。');
}

/**
 * Early frames, avoiding a black or fading opening. The brightest of these is
 * used, so a short fade-in never becomes the card cover.
 */
export function coverCandidateTimes(duration: number): number[] {
  if (!duration || !Number.isFinite(duration) || duration <= 0) return [0.2];
  const end = Math.min(duration - 0.05, Math.max(1.2, duration * 0.25));
  const times = [Math.min(0.15, end), end * 0.5, end];
  return [...new Set(times.map(time => Math.round(Math.max(0, Math.min(time, duration - 0.05)) * 100) / 100))]
    .sort((a, b) => a - b);
}

function averageLuma(context: CanvasRenderingContext2D, width: number, height: number): number {
  // Cross-origin frames taint the canvas; the thrown SecurityError reaches the caller.
  const { data } = context.getImageData(0, 0, width, height);
  let sum = 0;
  for (let index = 0; index < data.length; index += 4) {
    sum += 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
  }
  return data.length ? sum / (data.length / 4) : 0;
}

/**
 * Draw a representative frame of a video into a JPEG data URL.
 * Works from a local Blob or a stored media URL; throws when the frame cannot
 * be decoded or the canvas is tainted, so callers keep their gradient fallback.
 */
export async function captureVideoCover(source: Blob | string): Promise<string> {
  if (typeof document === 'undefined') throw new Error('封面截取需要浏览器环境。');
  const objectURL = typeof source === 'string' ? undefined : URL.createObjectURL(source);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('aria-hidden', 'true');
  Object.assign(video.style, {
    position: 'fixed', left: '-9999px', top: '0', width: '1px', height: '1px',
    opacity: '0', pointerEvents: 'none',
  });
  document.body.appendChild(video);
  try {
    video.src = objectURL ?? safeMediaURL(source as string);
    if (!video.src) throw new Error('视频地址无效。');
    if (video.readyState < 1) await waitForEvent(video, 'loadedmetadata', LOAD_TIMEOUT, '视频信息读取超时。');
    if (!video.videoWidth || !video.videoHeight) throw new Error('视频尺寸无效。');

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const candidates = coverCandidateTimes(duration);

    const sampler = document.createElement('canvas');
    sampler.width = SAMPLE_WIDTH;
    sampler.height = Math.max(1, Math.round(SAMPLE_WIDTH * video.videoHeight / video.videoWidth));
    const samplerContext = sampler.getContext('2d', { willReadFrequently: true });

    const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext('2d');
    if (!samplerContext || !context) throw new Error('无法创建封面画布。');

    let best = { time: candidates[0], luma: -1 };
    for (const time of candidates) {
      await seekTo(video, time);
      samplerContext.drawImage(video, 0, 0, sampler.width, sampler.height);
      const luma = averageLuma(samplerContext, sampler.width, sampler.height);
      if (luma > best.luma) best = { time, luma };
    }

    await seekTo(video, best.time);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    if (!/^data:image\/jpeg[;,]/i.test(dataUrl)) throw new Error('封面编码失败。');
    return dataUrl;
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
    if (objectURL) URL.revokeObjectURL(objectURL);
  }
}
