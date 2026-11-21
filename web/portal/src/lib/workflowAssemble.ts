import { t } from './i18n';
import type { Shot } from './videoWorkflow';

/**
 * 无依赖的浏览器端成片合成。
 *
 * 逐镜头播放视频，把画面绘制到 canvas，并把原声与背景音乐混入
 * MediaStream，最后用 MediaRecorder 录制为一段可下载的成片。
 * 整个过程在本机完成，不上传任何素材，也不需要 Node 或外部 wasm。
 */

export interface WorkflowAssemblyOptions {
  shots: Shot[];
  musicBlob?: Blob;
  includeSubtitles?: boolean;
  onProgress?: (message: string, percent?: number) => void;
  signal?: AbortSignal;
}

function abortError() {
  return new DOMException('Aborted', 'AbortError');
}

function chooseMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
  for (const type of candidates) {
    try { if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) return type; } catch { /* try next */ }
  }
  return '';
}

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); reject(abortError()); };
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  });
}

function drawFrame(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, width: number, height: number, subtitle: string) {
  ctx.fillStyle = '#06070a';
  ctx.fillRect(0, 0, width, height);
  const sourceWidth = video.videoWidth || 16;
  const sourceHeight = video.videoHeight || 9;
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  ctx.drawImage(video, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  if (!subtitle.trim()) return;
  const fontSize = Math.round(width * 0.028);
  ctx.font = `600 ${fontSize}px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const maxWidth = width * 0.86;
  const lines: string[] = [];
  let line = '';
  for (const character of subtitle.trim().split('')) {
    const candidate = line + character;
    if (ctx.measureText(candidate).width > maxWidth && line) { lines.push(line); line = character; }
    else line = candidate;
  }
  if (line) lines.push(line);
  const lineHeight = Math.round(fontSize * 1.35);
  const bottom = height - Math.round(height * 0.07);
  lines.slice(-3).forEach((text, index, shown) => {
    const y = bottom - (shown.length - 1 - index) * lineHeight;
    ctx.lineWidth = Math.max(3, fontSize / 7);
    ctx.strokeStyle = 'rgba(0,0,0,0.78)';
    ctx.strokeText(text, width / 2, y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, width / 2, y);
  });
}

export async function assembleWorkflowVideo({ shots, musicBlob, includeSubtitles, onProgress, signal }: WorkflowAssemblyOptions): Promise<Blob> {
  const completed = shots.filter(shot => shot.videoBlob && shot.videoStatus === 'completed');
  if (!completed.length) throw new Error(t('没有可用的视频镜头'));
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement === 'undefined') {
    throw new Error(t('当前浏览器不支持本地合成视频，请下载单个镜头后使用剪辑软件拼接。'));
  }
  const mimeType = chooseMimeType();
  if (!mimeType) throw new Error(t('当前浏览器不支持本地合成视频，请下载单个镜头后使用剪辑软件拼接。'));

  const width = 1280;
  const height = 720;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(t('无法创建视频画布。'));

  const stream = canvas.captureStream(30);
  const audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();
  const audioTrack = destination.stream.getAudioTracks()[0];
  if (audioTrack) stream.addTrack(audioTrack);

  let music: HTMLAudioElement | null = null;
  let musicUrl = '';
  if (musicBlob) {
    musicUrl = URL.createObjectURL(musicBlob);
    music = new Audio(musicUrl);
    music.loop = true;
    try {
      const source = audioContext.createMediaElementSource(music);
      const gain = audioContext.createGain();
      gain.gain.value = 0.26;
      source.connect(gain).connect(destination);
    } catch { /* Keep recording without music if the browser refuses. */ }
  }

  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000, audioBitsPerSecond: 128_000 });
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });

  const videoElements: HTMLVideoElement[] = [];
  const objectUrls: string[] = [];
  try {
    await audioContext.resume().catch(() => {});
    if (music) await music.play().catch(() => {});
    recorder.start(500);
    drawFrame(ctx, { videoWidth: width, videoHeight: height } as HTMLVideoElement, width, height, '');
    const startedAt = performance.now();
    let elapsed = 0;
    for (let index = 0; index < completed.length; index++) {
      if (signal?.aborted) throw abortError();
      const shot = completed[index];
      onProgress?.(t('正在合成镜头 {index}/{total}…', { index: index + 1, total: completed.length }), Math.round((index / completed.length) * 85));
      const url = URL.createObjectURL(shot.videoBlob!);
      objectUrls.push(url);
      const video = document.createElement('video');
      videoElements.push(video);
      video.src = url;
      video.playsInline = true;
      video.preload = 'auto';
      try {
        const source = audioContext.createMediaElementSource(video);
        const gain = audioContext.createGain();
        gain.gain.value = 1;
        source.connect(gain).connect(destination);
      } catch { /* Video without audio track is still recorded. */ }
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error(t('无法读取镜头 {number} 的视频。', { number: shot.number })));
      });
      await video.play();
      const limit = Math.max(0.3, Math.min(shot.duration || video.duration || 4, 30));
      const shotStart = elapsed;
      while (!video.ended && video.currentTime < limit) {
        if (signal?.aborted) throw abortError();
        const played = Math.min(video.currentTime, limit);
        elapsed = shotStart + played;
        drawFrame(ctx, video, width, height, includeSubtitles ? (shot.dialogue || '') : '');
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }
      video.pause();
      video.removeAttribute('src');
      video.load();
      elapsed = shotStart + limit;
    }
    const target = (elapsed * 1000) - (performance.now() - startedAt);
    if (target > 0) await wait(target, signal);
    onProgress?.(t('正在整理成片…'), 94);
  } finally {
    if (recorder.state !== 'inactive') recorder.stop();
    music?.pause();
    objectUrls.forEach(url => URL.revokeObjectURL(url));
    await stopped.catch(() => {});
    stream.getTracks().forEach(track => track.stop());
    await audioContext.close().catch(() => {});
    if (musicUrl) URL.revokeObjectURL(musicUrl);
  }
  if (signal?.aborted) throw abortError();
  const blob = new Blob(chunks, { type: mimeType.split(';')[0] || 'video/webm' });
  if (!blob.size) throw new Error(t('成片为空，请重试。'));
  onProgress?.(t('合成完成！'), 100);
  return blob;
}

function secondsToSRTTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.floor((seconds % 1) * 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

export function generateWorkflowSRT(shots: Shot[]): string {
  const entries: { index: number; start: string; end: string; text: string }[] = [];
  let currentTime = 0;
  for (const shot of shots) {
    if (shot.dialogue) entries.push({ index: entries.length + 1, start: secondsToSRTTime(currentTime), end: secondsToSRTTime(currentTime + shot.duration), text: shot.dialogue });
    currentTime += shot.duration;
  }
  return entries.map(entry => `${entry.index}\n${entry.start} --> ${entry.end}\n${entry.text}\n`).join('\n');
}

export function exportWorkflowSRT(shots: Shot[], title: string) {
  const blob = new Blob([generateWorkflowSRT(shots)], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${title}.srt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
