import { computed, ref, shallowRef } from 'vue';
import type { SongDraft } from '../lib/types';

export interface PlayerMedia {
  id: string;
  kind: 'audio' | 'video';
  src: string;
  title: string;
  prompt?: string;
  lrc?: string;
  lrcSource?: 'estimated' | 'audio' | 'manual';
  coverUrl?: string;
  lyrics?: string;
  song?: SongDraft;
}

export interface VideoPreviewState {
  media: PlayerMedia;
  host: HTMLElement;
}

export interface InlineVideoHost {
  mediaId: string;
  host: HTMLElement;
}

// One audio element and one video element live for the whole app. Components
// dock the video element into cards, the floating window or the theater through
// a Teleport, so there is never a second instance fighting for playback.
export const activeMedia = shallowRef<PlayerMedia | null>(null);
export const isPlaying = ref(false);
/** Audio now-playing panel open. */
export const expanded = ref(false);
/** Video theater (large screen) open. */
export const isVideoExpanded = ref(false);
export const currentTime = ref(0);
export const duration = ref(0);
export const volume = ref(0.9);
export const isMuted = ref(false);
export const playbackRate = ref(1);
export const videoPreview = shallowRef<VideoPreviewState | null>(null);
export const videoPreviewMuted = ref(true);
export const videoInlineHost = shallowRef<InlineVideoHost | null>(null);

export const audioElement = shallowRef<HTMLAudioElement | null>(null);
export const videoElement = shallowRef<HTMLVideoElement | null>(null);

export const hasMedia = computed(() => Boolean(activeMedia.value));
export const mediaElement = computed<HTMLMediaElement | null>(() =>
  activeMedia.value?.kind === 'video' ? videoElement.value : audioElement.value,
);

function applyOutput(element: HTMLMediaElement | null) {
  if (!element) return;
  element.volume = volume.value;
  element.muted = isMuted.value;
  try { element.playbackRate = playbackRate.value; } catch { /* not ready */ }
}

export function attachAudio(element: HTMLAudioElement | null) {
  audioElement.value = element;
  if (element) applyOutput(element);
}

export function attachVideo(element: HTMLVideoElement | null) {
  videoElement.value = element;
  if (element) applyOutput(element);
}

/** Backwards-compatible single-element attachment. */
export function attachElement(element: HTMLMediaElement | null) {
  if (!element) {
    attachAudio(null);
    attachVideo(null);
    return;
  }
  if (element.tagName === 'VIDEO') attachVideo(element as HTMLVideoElement);
  else attachAudio(element as HTMLAudioElement);
}

export function play(media: PlayerMedia) {
  if (activeMedia.value?.id === media.id) {
    toggle();
    return;
  }
  const previous = mediaElement.value;
  if (previous && !previous.paused) previous.pause();
  videoPreview.value = null;
  activeMedia.value = media;
  currentTime.value = 0;
  duration.value = 0;
  isPlaying.value = true;
  expanded.value = false;
  isVideoExpanded.value = false;
}

export function toggle() {
  const element = mediaElement.value;
  if (!element) return;
  if (element.paused) {
    void element.play().then(() => { isPlaying.value = true; }).catch(() => { isPlaying.value = false; });
  } else {
    element.pause();
    isPlaying.value = false;
  }
}

export function pause() {
  mediaElement.value?.pause();
  isPlaying.value = false;
}

export function close() {
  audioElement.value?.pause();
  videoElement.value?.pause();
  activeMedia.value = null;
  videoPreview.value = null;
  videoInlineHost.value = null;
  isPlaying.value = false;
  expanded.value = false;
  isVideoExpanded.value = false;
  currentTime.value = 0;
  duration.value = 0;
}

export function seek(value: number) {
  const element = mediaElement.value;
  if (element && Number.isFinite(value)) {
    element.currentTime = Math.max(0, Math.min(value, duration.value || value));
    currentTime.value = element.currentTime;
  }
}

export function jump(seconds: number) {
  seek(currentTime.value + seconds);
}

export function setVolume(value: number) {
  volume.value = Math.max(0, Math.min(1, value));
  if (audioElement.value) audioElement.value.volume = volume.value;
  if (videoElement.value) videoElement.value.volume = volume.value;
}

export function toggleMute() {
  setMuted(!isMuted.value);
}

export function setMuted(value: boolean) {
  isMuted.value = value;
  if (audioElement.value) audioElement.value.muted = value;
  if (videoElement.value) videoElement.value.muted = value;
}

export function setPlaybackRate(value: number) {
  playbackRate.value = value;
  try { if (audioElement.value) audioElement.value.playbackRate = value; } catch { /* not ready */ }
  try { if (videoElement.value) videoElement.value.playbackRate = value; } catch { /* not ready */ }
}

export function setExpanded(value: boolean) {
  expanded.value = value;
}

export function setVideoExpanded(value: boolean) {
  isVideoExpanded.value = value;
}

export function previewVideo(media: PlayerMedia, host: HTMLElement) {
  if (media.kind !== 'video') return;
  videoPreview.value = { media, host };
  videoPreviewMuted.value = true;
}

export function stopVideoPreview() {
  videoPreview.value = null;
}

export function setVideoPreviewMuted(value: boolean) {
  videoPreviewMuted.value = value;
  if (videoElement.value) videoElement.value.muted = value;
}

export function setVideoInlineHost(value: InlineVideoHost | null) {
  videoInlineHost.value = value;
  if (value) isVideoExpanded.value = false;
}

export function isActive(id: string) {
  return activeMedia.value?.id === id && isPlaying.value;
}
