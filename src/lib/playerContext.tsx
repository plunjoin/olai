import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { Asset, SongDraft } from './types';
import { safeMediaURL } from './api';
import { parseAudioDataUri } from './audio';

export type MediaType = 'audio' | 'video';

export interface PlayableMedia {
  id: string;
  kind: MediaType;
  src: string;
  title: string;
  prompt?: string;
  lrc?: string;
  lrcSource?: Asset['lrcSource'];
  coverUrl?: string;
  lyrics?: string;
  song?: SongDraft;
}

export interface PlayerContextValue {
  activeMedia: PlayableMedia | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  isMuted: boolean;
  playbackRate: number;
  isExpanded: boolean;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  play: (media: PlayableMedia) => void;
  pause: () => void;
  togglePlay: () => void;
  seek: (time: number) => void;
  updateCurrentTime: (time: number) => void;
  jump: (delta: number) => void;
  toggleMute: () => void;
  setPlaybackRate: (rate: number) => void;
  setIsExpanded: (expanded: boolean) => void;
  setIsPlaying: (playing: boolean) => void;
  setDuration: (duration: number) => void;
  close: () => void;
  updateLyrics: (id: string, lrc: string, source: Asset['lrcSource']) => void;
  updateCover: (id: string, coverUrl: string) => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

// Global media URL cache to preserve Blob URLs across component unmounts
const blobUrlCache = new WeakMap<Blob, string>();
const assetUrlMap = new Map<string, string>();

export function getAssetMediaURL(asset: Asset): string {
  if (asset.blob) {
    if (asset.blob instanceof Blob) {
      let cached = blobUrlCache.get(asset.blob);
      if (!cached) {
        let playBlob = asset.blob;
        if (asset.kind === 'music' && (!playBlob.type || !playBlob.type.startsWith('audio/') || playBlob.type.includes('octet-stream'))) {
          playBlob = new Blob([asset.blob], { type: 'audio/wav' });
        }
        try {
          cached = URL.createObjectURL(playBlob);
          blobUrlCache.set(asset.blob, cached);
          assetUrlMap.set(asset.id, cached);
        } catch {
          return '';
        }
      }
      return cached;
    }
  }
  if (asset.url) {
    try {
      if (asset.url.startsWith('data:audio/')) {
        let cached = assetUrlMap.get(asset.id);
        if (!cached) {
          try {
            const parsed = parseAudioDataUri(asset.url);
            cached = URL.createObjectURL(parsed.blob);
            assetUrlMap.set(asset.id, cached);
          } catch {
            return asset.url;
          }
        }
        return cached;
      }
      return safeMediaURL(asset.url);
    } catch {
      return '';
    }
  }
  return '';
}

export function revokeAssetMediaURL(assetId: string): void {
  const url = assetUrlMap.get(assetId);
  if (url) {
    try {
      URL.revokeObjectURL(url);
    } catch {}
    assetUrlMap.delete(assetId);
  }
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [activeMedia, setActiveMedia] = useState<PlayableMedia | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [isExpanded, setIsExpanded] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const play = (media: PlayableMedia) => {
    if (activeMedia?.id === media.id) {
      // Same media: resume playback
      if (media.kind === 'video' && videoRef.current) {
        audioRef.current?.pause();
        videoRef.current.play().catch(e => console.warn('Video play:', e));
      } else if (media.kind === 'audio' && audioRef.current) {
        videoRef.current?.pause();
        audioRef.current.play().catch(e => console.warn('Audio play:', e));
      }
      setIsPlaying(true);
      return;
    }

    // Switching media: pause previous elements
    if (audioRef.current) {
      audioRef.current.pause();
    }
    if (videoRef.current) {
      videoRef.current.pause();
    }

    setActiveMedia(media);
    setIsPlaying(true);
    setCurrentTime(0);
    setDuration(0);

    // Directly trigger playback synchronously within user interaction
    if (media.kind === 'audio' && audioRef.current) {
      audioRef.current.src = media.src;
      audioRef.current.playbackRate = playbackRate;
      audioRef.current.muted = isMuted;
      audioRef.current.currentTime = 0;
      audioRef.current.load();
      audioRef.current.play().catch(e => console.warn('Audio immediate play caught:', e));
    } else if (media.kind === 'video' && videoRef.current) {
      videoRef.current.src = media.src;
      videoRef.current.playbackRate = playbackRate;
      videoRef.current.muted = isMuted;
      videoRef.current.currentTime = 0;
      videoRef.current.load();
      videoRef.current.play().catch(e => console.warn('Video immediate play caught:', e));
    }
  };

  const pause = () => {
    if (activeMedia?.kind === 'video' && videoRef.current) {
      videoRef.current.pause();
    } else if (activeMedia?.kind === 'audio' && audioRef.current) {
      audioRef.current.pause();
    }
    setIsPlaying(false);
  };

  const togglePlay = () => {
    if (isPlaying) {
      pause();
    } else if (activeMedia) {
      play(activeMedia);
    }
  };

  const seek = (time: number) => {
    setCurrentTime(time);
    if (activeMedia?.kind === 'video' && videoRef.current) {
      videoRef.current.currentTime = time;
    } else if (activeMedia?.kind === 'audio' && audioRef.current) {
      audioRef.current.currentTime = time;
    }
  };

  const updateCurrentTime = (time: number) => {
    setCurrentTime(time);
  };

  const jump = (delta: number) => {
    const el = activeMedia?.kind === 'video' ? videoRef.current : audioRef.current;
    if (el) {
      const target = Math.min(Math.max(0, el.currentTime + delta), el.duration || duration || 9999);
      el.currentTime = target;
      setCurrentTime(target);
    }
  };

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    if (audioRef.current) audioRef.current.muted = next;
    if (videoRef.current) videoRef.current.muted = next;
  };

  const setPlaybackRate = (rate: number) => {
    setPlaybackRateState(rate);
    if (audioRef.current) audioRef.current.playbackRate = rate;
    if (videoRef.current) videoRef.current.playbackRate = rate;
  };

  const close = () => {
    if (audioRef.current) audioRef.current.pause();
    if (videoRef.current) videoRef.current.pause();
    setIsPlaying(false);
    setActiveMedia(null);
    setIsExpanded(false);
    setCurrentTime(0);
    setDuration(0);
  };

  // When activeMedia changes and it's video or audio, ensure playback starts if not already running
  useEffect(() => {
    if (!activeMedia) return;

    if (activeMedia.kind === 'video' && videoRef.current) {
      videoRef.current.playbackRate = playbackRate;
      videoRef.current.muted = isMuted;
      if (videoRef.current.paused && isPlaying) {
        videoRef.current.play().catch(() => {});
      }
    } else if (activeMedia.kind === 'audio' && audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
      audioRef.current.muted = isMuted;
      if (audioRef.current.paused && isPlaying) {
        audioRef.current.play().catch(() => {});
      }
    }
  }, [activeMedia]);

  return (
    <PlayerContext.Provider
      value={{
        activeMedia,
        isPlaying,
        currentTime,
        duration,
        isMuted,
        playbackRate,
        isExpanded,
        audioRef,
        videoRef,
        play,
        pause,
        togglePlay,
        seek,
        updateCurrentTime,
        jump,
        toggleMute,
        setPlaybackRate,
        setIsExpanded,
        setIsPlaying,
        setDuration,
        close,
        updateLyrics: (id, lrc, lrcSource) => setActiveMedia(current => current?.id === id ? { ...current, lrc, lrcSource } : current),
        updateCover: (id, coverUrl) => setActiveMedia(current => current?.id === id ? { ...current, coverUrl } : current),
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) {
    throw new Error('usePlayer must be used within a PlayerProvider');
  }
  return ctx;
}
