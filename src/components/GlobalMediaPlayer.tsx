import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  Copy,
  Download,
  FileText,
  Maximize2,
  Minimize2,
  Music2,
  LoaderCircle,
  Pause,
  PictureInPicture,
  Play,
  RotateCcw,
  RotateCw,
  Sparkles,
  Video,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { usePlayer } from '../lib/playerContext';
import { lockBodyScroll } from '../lib/scrollLock';
import { downloadLrcBlob, generateLrcFromPrompt, parseLRC, type LyricLine } from '../lib/lrc';
import { sungLines } from '../lib/music';

function formatTime(secs: number) {
  if (isNaN(secs) || !isFinite(secs) || secs < 0) return '00:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

const PANEL_EASE = 'cubic-bezier(0.2, 0.9, 0.25, 1)';

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function ProgressRing({ progress, className = '' }: { progress: number; className?: string }) {
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const value = Math.min(100, Math.max(0, progress));
  return <svg className={`audio-progress-ring ${className}`} viewBox="0 0 100 100" aria-hidden="true">
    <circle className="ring-track" cx="50" cy="50" r={radius} />
    <circle
      className="ring-value"
      cx="50"
      cy="50"
      r={radius}
      strokeDasharray={circumference}
      strokeDashoffset={circumference * (1 - value / 100)}
    />
  </svg>;
}

export default function GlobalMediaPlayer({ onAlignLyrics, aligningIds = [] }: { onAlignLyrics?: (id: string) => void; aligningIds?: string[] }) {
  const {
    activeMedia,
    isPlaying,
    currentTime,
    duration,
    isMuted,
    playbackRate,
    isExpanded,
    isVideoExpanded,
    videoPreview,
    videoPreviewMuted,
    videoInlineHost,
    audioRef,
    videoRef,
    pause,
    togglePlay,
    seek,
    updateCurrentTime,
    jump,
    toggleMute,
    setPlaybackRate,
    setIsExpanded,
    setIsVideoExpanded,
    setIsPlaying,
    setDuration,
    close,
  } = usePlayer();

  const [copied, setCopied] = useState(false);
  const [videoHovered, setVideoHovered] = useState(false);
  const [localLrc, setLocalLrc] = useState('');
  const [audioClosing, setAudioClosing] = useState(false);
  const [videoClosing, setVideoClosing] = useState(false);
  const [videoStageHost, setVideoStageHost] = useState<HTMLDivElement | null>(null);

  const lyricsContainerRef = useRef<HTMLDivElement | null>(null);
  const activeLyricRef = useRef<HTMLDivElement | null>(null);
  const videoFrameRef = useRef<HTMLDivElement | null>(null);
  const videoFromRect = useRef<DOMRect | null>(null);
  const videoClosingRef = useRef(false);
  const discRef = useRef<HTMLButtonElement | null>(null);
  const audioPanelRef = useRef<HTMLElement | null>(null);
  const audioFromRect = useRef<DOMRect | null>(null);
  const audioClosingRef = useRef(false);

  const hasVideo = activeMedia?.kind === 'video';
  const videoSrc = videoPreview?.media.src ?? (hasVideo ? activeMedia?.src : undefined);
  // A page (gallery detail) can dock the active video in place. Theater mode
  // always takes the video back into the shell.
  const inlineHost = !isVideoExpanded && hasVideo && videoInlineHost?.mediaId === activeMedia?.id
    ? videoInlineHost.host
    : null;
  const videoHost = videoPreview?.host ?? inlineHost ?? videoStageHost;
  const isDockedInline = !videoPreview && !!inlineHost;

  // Sync LRC from active media or generate if missing
  useEffect(() => {
    if (activeMedia?.kind === 'audio') {
      const lyrics = activeMedia.song ? sungLines(activeMedia.song) : (activeMedia.lyrics || '').replace(/^\[[^\]]+\]\s*$/gm, '');
      if (activeMedia.song?.instrumental) {
        setLocalLrc('');
      } else if (activeMedia.lrcSource === 'audio' && activeMedia.lrc) {
        setLocalLrc(activeMedia.lrc);
      } else if (lyrics && duration > 0) {
        setLocalLrc(generateLrcFromPrompt(lyrics, duration, activeMedia.title));
      } else if (activeMedia.lrc) {
        setLocalLrc(activeMedia.lrc);
      } else {
        setLocalLrc('');
      }
    }
  }, [activeMedia, duration]);

  // Parse LRC into lyric lines
  const parsedLyrics: LyricLine[] = parseLRC(localLrc);

  // Match active lyric line
  const activeIndex = parsedLyrics.reduce((acc, line, idx) => {
    if (currentTime >= line.time) return idx;
    return acc;
  }, -1);

  // Auto-scroll active lyric into view
  useEffect(() => {
    if (isExpanded && activeLyricRef.current) {
      activeLyricRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [activeIndex, isExpanded]);

  const onAudioTimeUpdate = () => {
    if (audioRef.current) {
      updateCurrentTime(audioRef.current.currentTime);
    }
  };

  const onAudioLoadedMetadata = () => {
    if (audioRef.current) {
      const d = audioRef.current.duration;
      if (d && !isNaN(d) && isFinite(d)) {
        setDuration(d);
      }
    }
  };

  const onVideoTimeUpdate = () => {
    if (videoRef.current) {
      updateCurrentTime(videoRef.current.currentTime);
    }
  };

  const onVideoLoadedMetadata = () => {
    if (videoRef.current) {
      const d = videoRef.current.duration;
      if (d && !isNaN(d) && isFinite(d)) {
        setDuration(d);
      }
    }
  };

  const handleSeekSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    seek(val);
  };

  const changeRate = () => {
    const rates = [1, 1.25, 1.5, 2];
    const nextIdx = (rates.indexOf(playbackRate) + 1) % rates.length;
    setPlaybackRate(rates[nextIdx]);
  };

  const togglePip = async () => {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await videoRef.current.requestPictureInPicture();
      }
    } catch {
      // Browser may not support or allow PiP
    }
  };

  const toggleFullscreen = () => {
    const frame = videoFrameRef.current;
    if (!frame) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      frame.requestFullscreen().catch(() => {});
    }
  };

  // Hover preview, rendered by the same single global video element. It starts
  // silent; the card's sound button can unmute it.
  useEffect(() => {
    if (!videoPreview) return;
    const element = videoRef.current;
    if (!element) return;
    element.muted = videoPreviewMuted;
    element.loop = true;
    element.play().catch(() => {});
  }, [videoPreview, videoPreviewMuted]);

  useEffect(() => {
    if (videoPreview) return;
    const element = videoRef.current;
    if (!element) return;
    element.loop = false;
    element.muted = isMuted;
  }, [videoPreview, isMuted]);

  // Changing the portal target (inline detail ↔ mini window) remounts the
  // <video>; carry playback position and intent over to the new element.
  const playbackIntent = useRef({ time: 0, playing: false, muted: false });
  playbackIntent.current = { time: currentTime, playing: isPlaying, muted: isMuted };
  useEffect(() => {
    if (videoPreview || !hasVideo) return;
    const element = videoRef.current;
    if (!element) return;
    const intent = playbackIntent.current;
    element.muted = intent.muted;
    const restore = () => {
      if (intent.time < 0.25) return;
      try {
        if (Math.abs(element.currentTime - intent.time) > 0.5) element.currentTime = intent.time;
      } catch {}
    };
    if (element.readyState >= 1) restore();
    else element.addEventListener('loadedmetadata', restore, { once: true });
    if (intent.playing && element.paused) element.play().catch(() => {});
  }, [videoHost]);

  const openVideoTheater = () => {
    if (!hasVideo) return;
    videoFromRect.current = (inlineHost ?? videoFrameRef.current)?.getBoundingClientRect() ?? null;
    videoClosingRef.current = false;
    setIsVideoExpanded(true);
  };

  const collapseVideoTheater = useCallback(() => {
    if (videoClosingRef.current || !isVideoExpanded) return;
    videoClosingRef.current = true;
    const element = videoFrameRef.current;
    const source = videoFromRect.current;
    if (!element || !source || reducedMotion()) {
      setIsVideoExpanded(false);
      videoClosingRef.current = false;
      return;
    }
    const target = element.getBoundingClientRect();
    if (!target.width || !target.height || !source.width || !source.height) {
      setIsVideoExpanded(false);
      videoClosingRef.current = false;
      return;
    }
    setVideoClosing(true);
    const animation = element.animate(
      [
        { transform: 'translate(0, 0) scale(1, 1)', borderRadius: getComputedStyle(element).borderRadius, opacity: 1 },
        {
          transform: `translate(${source.left - target.left}px, ${source.top - target.top}px) scale(${source.width / target.width}, ${source.height / target.height})`,
          borderRadius: '18px',
          opacity: 0.4,
        },
      ],
      { duration: 340, easing: PANEL_EASE, fill: 'forwards' },
    );
    const finish = () => {
      setIsVideoExpanded(false);
      setVideoClosing(false);
      videoClosingRef.current = false;
    };
    animation.onfinish = finish;
    animation.oncancel = finish;
  }, [isVideoExpanded, setIsVideoExpanded]);

  useLayoutEffect(() => {
    if (!isVideoExpanded) return;
    const element = videoFrameRef.current;
    const source = videoFromRect.current;
    if (!element || !source || reducedMotion()) return;
    const target = element.getBoundingClientRect();
    if (!target.width || !target.height || !source.width || !source.height) return;
    element.animate(
      [
        {
          transform: `translate(${source.left - target.left}px, ${source.top - target.top}px) scale(${source.width / target.width}, ${source.height / target.height})`,
          borderRadius: '18px',
          opacity: 0.5,
        },
        { transform: 'translate(0, 0) scale(1, 1)', borderRadius: getComputedStyle(element).borderRadius, opacity: 1 },
      ],
      { duration: 420, easing: PANEL_EASE },
    );
  }, [isVideoExpanded]);

  useEffect(() => {
    if (!isVideoExpanded) return;
    const releaseScroll = lockBodyScroll();
    const timer = requestAnimationFrame(() => {
      videoFrameRef.current?.querySelector<HTMLElement>('.video-theater-toggle')?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      collapseVideoTheater();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(timer);
      releaseScroll();
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isVideoExpanded, collapseVideoTheater]);

  const handleCopyLrc = async () => {
    if (!localLrc) return;
    await navigator.clipboard.writeText(localLrc);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadLrc = () => {
    if (!localLrc) return;
    downloadLrcBlob(localLrc, `${(activeMedia?.title || 'olai-music').replace(/\s+/g, '_')}.lrc`);
  };

  const openAudioPlayer = () => {
    audioFromRect.current = discRef.current?.getBoundingClientRect() ?? null;
    audioClosingRef.current = false;
    setIsExpanded(true);
  };

  const collapseAudioPlayer = useCallback(() => {
    if (audioClosingRef.current) return;
    audioClosingRef.current = true;
    const element = audioPanelRef.current;
    const source = audioFromRect.current;
    if (!element || !source || reducedMotion()) {
      setIsExpanded(false);
      audioClosingRef.current = false;
      return;
    }
    const target = element.getBoundingClientRect();
    if (!target.width || !target.height) {
      setIsExpanded(false);
      audioClosingRef.current = false;
      return;
    }
    setAudioClosing(true);
    const animation = element.animate(
      [
        { transform: 'translate(0, 0) scale(1, 1)', borderRadius: getComputedStyle(element).borderRadius, opacity: 1 },
        {
          transform: `translate(${source.left - target.left}px, ${source.top - target.top}px) scale(${source.width / target.width}, ${source.height / target.height})`,
          borderRadius: '50%',
          opacity: 0,
        },
      ],
      { duration: 360, easing: PANEL_EASE, fill: 'forwards' },
    );
    const finish = () => {
      setIsExpanded(false);
      setAudioClosing(false);
      audioClosingRef.current = false;
      requestAnimationFrame(() => discRef.current?.focus());
    };
    animation.onfinish = finish;
    animation.oncancel = finish;
  }, [setIsExpanded]);

  useLayoutEffect(() => {
    if (!isExpanded) return;
    const element = audioPanelRef.current;
    const source = audioFromRect.current;
    if (!element || !source || reducedMotion()) return;
    const target = element.getBoundingClientRect();
    if (!target.width || !target.height || !source.width || !source.height) return;
    element.animate(
      [
        {
          transform: `translate(${source.left - target.left}px, ${source.top - target.top}px) scale(${source.width / target.width}, ${source.height / target.height})`,
          borderRadius: '50%',
          opacity: 0.6,
        },
        { transform: 'translate(0, 0) scale(1, 1)', borderRadius: getComputedStyle(element).borderRadius, opacity: 1 },
      ],
      { duration: 480, easing: PANEL_EASE },
    );
  }, [isExpanded]);

  useEffect(() => {
    if (!isExpanded) return;
    const releaseScroll = lockBodyScroll();
    const timer = requestAnimationFrame(() => {
      audioPanelRef.current?.querySelector<HTMLElement>('.audio-stage-collapse')?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        collapseAudioPlayer();
        return;
      }
      if (event.key !== 'Tab' || !audioPanelRef.current) return;
      const focusable = [...audioPanelRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])')]
        .filter(element => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(timer);
      releaseScroll();
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isExpanded, collapseAudioPlayer]);

  const progressPercent =
    duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  // The one and only <video> in the app. It is portaled either into the player
  // shell or into a hovered video card, so there is never a second instance.
  const videoElement = (
    <video
      ref={videoRef}
      src={videoSrc}
      playsInline
      preload={videoPreview ? 'metadata' : 'auto'}
      loop={!!videoPreview}
      muted={videoPreview ? videoPreviewMuted : isMuted}
      className={videoPreview ? 'hover-preview-video' : 'global-video-element'}
      onPlay={() => {
        if (videoPreview) return;
        audioRef.current?.pause();
        setIsPlaying(true);
      }}
      onPause={() => {
        if (!videoPreview) setIsPlaying(false);
      }}
      onTimeUpdate={() => {
        if (!videoPreview) onVideoTimeUpdate();
      }}
      onLoadedMetadata={() => {
        if (!videoPreview) onVideoLoadedMetadata();
      }}
      onEnded={() => {
        if (!videoPreview) pause();
      }}
      onError={(e) => {
        if (videoPreview) return;
        console.warn('Video element error:', e);
        setIsPlaying(false);
      }}
    />
  );

  return (
    <>
      {/* Global native audio element (lives as long as app lives) */}
      <audio
        ref={audioRef}
        src={activeMedia?.kind === 'audio' ? activeMedia.src : undefined}
        preload="auto"
        onPlay={() => {
          videoRef.current?.pause();
          setIsPlaying(true);
        }}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          pause();
        }}
        onTimeUpdate={onAudioTimeUpdate}
        onLoadedMetadata={onAudioLoadedMetadata}
        onError={(e) => {
          console.warn('Audio element error:', e);
          setIsPlaying(false);
        }}
      />

      {/* =========================================================================
          1. Global video player — small floating window / large theater mode.
             The same shell and the same <video> serve both modes.
          ========================================================================= */}
      <aside
        className={[
          'floating-video-player',
          hasVideo && 'has-media',
          isVideoExpanded && 'is-theater',
          isDockedInline && 'is-inline',
          !hasVideo && 'is-idle',
          videoClosing && 'is-closing',
        ].filter(Boolean).join(' ')}
        onMouseEnter={() => setVideoHovered(true)}
        onMouseLeave={() => setVideoHovered(false)}
        aria-label="视频播放器"
        aria-hidden={!hasVideo || isDockedInline}
      >
        {isVideoExpanded && (
          <button type="button" className="video-theater-backdrop" aria-label="收起视频播放器" onClick={collapseVideoTheater} />
        )}
        <div ref={videoFrameRef} className="video-player-frame">
          {hasVideo && (
            <div className={`floating-video-header ${videoHovered || !isPlaying || isVideoExpanded ? 'visible' : ''}`}>
              <div className="floating-video-title">
                <span className="floating-video-badge">
                  <Video size={11} /> {isVideoExpanded ? '大屏观看' : '视频播放'}
                </span>
                <span className="title-text" title={activeMedia?.title}>
                  {activeMedia?.title}
                </span>
              </div>
              <div className="floating-video-header-actions">
                <button
                  type="button"
                  className="header-action-btn"
                  onClick={togglePip}
                  title="画中画模式"
                  aria-label="画中画"
                >
                  <PictureInPicture size={14} />
                </button>
                {isVideoExpanded ? (
                  <button
                    type="button"
                    className="header-action-btn video-theater-toggle"
                    onClick={collapseVideoTheater}
                    title="收起为小窗"
                    aria-label="收起为小窗"
                  >
                    <Minimize2 size={14} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="header-action-btn"
                    onClick={openVideoTheater}
                    title="大屏观看"
                    aria-label="大屏观看"
                  >
                    <Maximize2 size={14} />
                  </button>
                )}
                <button
                  type="button"
                  className="header-action-btn close-btn"
                  onClick={close}
                  title="关闭播放器"
                  aria-label="关闭"
                >
                  <X size={15} />
                </button>
              </div>
            </div>
          )}

          <div className="floating-video-stage" onClick={hasVideo ? togglePlay : undefined}>
            <div ref={setVideoStageHost} className="video-element-host" />
            {videoHost && createPortal(videoElement, videoHost)}
            {hasVideo && !isPlaying && (
              <div className="video-pause-overlay">
                <div className="video-play-pulse">
                  <Play size={26} className="play-icon-offset" />
                </div>
              </div>
            )}
          </div>

          {hasVideo && (
            <div className={`floating-video-controls ${videoHovered || !isPlaying || isVideoExpanded ? 'visible' : ''}`}>
              <div className="floating-video-progress">
                <input
                  type="range"
                  min={0}
                  max={duration || 100}
                  step={0.1}
                  value={currentTime}
                  onChange={handleSeekSlider}
                  className="video-progress-slider"
                  style={{
                    background: `linear-gradient(to right, var(--accent-lime, #7047eb) ${progressPercent}%, rgba(255,255,255,0.2) ${progressPercent}%)`,
                  }}
                />
              </div>

              <div className="floating-video-buttons">
                <div className="video-buttons-left">
                  <button
                    type="button"
                    className="v-btn play-btn"
                    onClick={togglePlay}
                    aria-label={isPlaying ? '暂停' : '播放'}
                  >
                    {isPlaying ? <Pause size={16} /> : <Play size={16} className="play-icon-offset" />}
                  </button>
                  <span className="video-time-tag">
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>
                </div>

                <div className="video-buttons-right">
                  <button
                    type="button"
                    className="v-btn"
                    onClick={toggleMute}
                    title={isMuted ? '取消静音' : '静音'}
                    aria-label={isMuted ? '取消静音' : '静音'}
                  >
                    {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                  </button>
                  {isVideoExpanded ? (
                    <button
                      type="button"
                      className="v-btn"
                      onClick={collapseVideoTheater}
                      title="收起为小窗"
                      aria-label="收起为小窗"
                    >
                      <Minimize2 size={16} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="v-btn"
                      onClick={openVideoTheater}
                      title="大屏观看"
                      aria-label="大屏观看"
                    >
                      <Maximize2 size={16} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="v-btn"
                    onClick={toggleFullscreen}
                    title="全屏"
                    aria-label="全屏"
                  >
                    <Maximize2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* =========================================================================
          2. Global Floating Audio Player (音频全局悬浮播放器)
          ========================================================================= */}
      {activeMedia?.kind === 'audio' && (
        <>
          {/* A. Compact disc: spins alone as a circle; on hover it stretches into
                 an ellipse and the controls slide out behind the artwork. */}
          {!isExpanded && (
            <aside className="floating-audio-disc-wrap" aria-label="浮窗音乐播放器">
              <button
                ref={discRef}
                type="button"
                className="floating-audio-disc"
                onClick={togglePlay}
                aria-label={`${isPlaying ? '暂停' : '播放'}：${activeMedia.title}`}
                title={`${activeMedia.title} · ${isPlaying ? '暂停' : '播放'}`}
              >
                <ProgressRing progress={progressPercent} />
                <span className={`audio-disc-cover ${isPlaying ? 'is-spinning' : ''}`}>
                  {activeMedia.coverUrl
                    ? <img src={activeMedia.coverUrl} alt="" />
                    : <Music2 size={24} />}
                </span>
                <span className="audio-disc-toggle" aria-hidden="true">
                  {isPlaying ? <Pause size={17} /> : <Play size={17} className="play-icon-offset" />}
                </span>
              </button>

              <div className="audio-disc-controls">
                <button type="button" onClick={togglePlay} aria-label={isPlaying ? '暂停' : '播放'} title={isPlaying ? '暂停' : '播放'}>
                  {isPlaying ? <Pause size={15} /> : <Play size={15} className="play-icon-offset" />}
                </button>
                <button type="button" onClick={openAudioPlayer} aria-label="展开播放器" title="展开播放器">
                  <Maximize2 size={15} />
                </button>
                <button type="button" onClick={toggleMute} aria-label={isMuted ? '取消静音' : '静音'} title={isMuted ? '取消静音' : '静音'}>
                  {isMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                </button>
                <button type="button" className="is-danger" onClick={close} aria-label="关闭播放器" title="关闭播放器">
                  <X size={15} />
                </button>
              </div>
            </aside>
          )}

          {/* B. Full-screen now-playing panel, expanding from the disc */}
          {isExpanded && (
            <div
              className={`audio-stage ${audioClosing ? 'is-closing' : ''}`}
              role="dialog"
              aria-modal="true"
              aria-label={`音乐播放器：${activeMedia.title}`}
            >
              <button type="button" className="audio-stage-backdrop" aria-label="收起音乐播放器" onClick={collapseAudioPlayer} />
              <section ref={audioPanelRef} className="audio-stage-panel">
                <div className="audio-stage-art">
                  <div className="audio-stage-cover-wrap">
                    <div className={`audio-stage-cover ${isPlaying ? 'is-spinning' : ''}`}>
                      {activeMedia.coverUrl
                        ? <img src={activeMedia.coverUrl} alt={`${activeMedia.title}封面`} />
                        : <Music2 size={68} />}
                    </div>
                    <ProgressRing progress={progressPercent} className="audio-stage-ring" />
                  </div>
                  <div className="audio-stage-now">
                    <span className="audio-stage-badge">AI AUDIO</span>
                    <h2 id="audio-player-title">{activeMedia.title}</h2>
                    <p>{activeMedia.song?.style || '原创音乐'}{!activeMedia.song?.instrumental && ' · 人声歌曲'}</p>
                  </div>
                  <div className={`audio-stage-eq ${isPlaying ? 'active' : ''}`} aria-hidden="true">
                    <span /><span /><span /><span /><span /><span />
                  </div>
                  {parsedLyrics.length > 0 && activeIndex >= 0 && (
                    <p className="audio-stage-live-lyric">{parsedLyrics[activeIndex]?.text}</p>
                  )}
                </div>

                <div className="audio-stage-side">
                  <header className="audio-stage-head">
                    <div className="audio-stage-heading">
                      <span className="audio-stage-kicker">正在播放</span>
                      <strong title={activeMedia.title}>{activeMedia.title}</strong>
                    </div>
                    <div className="audio-stage-head-actions">
                      <button type="button" onClick={toggleMute} aria-label={isMuted ? '取消静音' : '静音'} title={isMuted ? '取消静音' : '静音'}>
                        {isMuted ? <VolumeX size={17} /> : <Volume2 size={17} />}
                      </button>
                      {/* Closes the dialog back to the compact disc; playback keeps
                          going. Stopping the player lives on the disc's own close. */}
                      <button type="button" className="audio-stage-collapse is-danger" onClick={collapseAudioPlayer} aria-label="关闭弹窗" title="关闭弹窗">
                        <X size={17} />
                      </button>
                    </div>
                  </header>

                  {activeMedia.lyrics && !activeMedia.song?.instrumental && (
                    <div className="audio-stage-status">
                      <span>{activeMedia.lrcSource === 'audio' ? '已按音频校准 · 可试听检查' : '歌词时间为估算 · 可按音频校准'}</span>
                      {onAlignLyrics && (
                        <button
                          type="button"
                          className="secondary-button small"
                          disabled={aligningIds.includes(activeMedia.id)}
                          onClick={() => onAlignLyrics(activeMedia.id)}
                        >
                          {aligningIds.includes(activeMedia.id) ? <LoaderCircle size={13} className="spin" /> : <Sparkles size={13} />}
                          {aligningIds.includes(activeMedia.id) ? '正在校准歌词…' : '校准歌词'}
                        </button>
                      )}
                    </div>
                  )}

                  <div className="audio-stage-lyrics" ref={lyricsContainerRef}>
                    {parsedLyrics.length > 0 ? (
                      <div className="audio-stage-lyric-list">
                        {parsedLyrics.map((item, idx) => {
                          if (!item.text) return null;
                          const isActive = idx === activeIndex;
                          return (
                            <div
                              key={idx}
                              ref={isActive ? activeLyricRef : null}
                              className={`lyric-line ${isActive ? 'active' : ''}`}
                              onClick={() => seek(item.time)}
                              role="button"
                              tabIndex={0}
                              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); seek(item.time); } }}
                              title={`点击跳转到 ${formatTime(item.time)}`}
                            >
                              <span className="lyric-time">{formatTime(item.time)}</span>
                              <span className="lyric-text">{item.text}</span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="lyrics-empty">
                        <FileText size={34} />
                        <p>{activeMedia.song?.instrumental ? '纯音乐，享受旋律。' : '暂无对齐歌词数据'}</p>
                      </div>
                    )}
                  </div>

                  <footer className="audio-stage-footer">
                    <div className="audio-stage-progress">
                      <span>{formatTime(currentTime)}</span>
                      <input
                        type="range"
                        min={0}
                        max={duration || 100}
                        step={0.1}
                        value={currentTime}
                        onChange={handleSeekSlider}
                        className="progress-slider"
                        aria-label="播放进度"
                        style={{
                          background: `linear-gradient(to right, var(--accent-lime, #7047eb) ${progressPercent}%, rgba(120, 132, 170, 0.18) ${progressPercent}%)`,
                        }}
                      />
                      <span>{formatTime(duration)}</span>
                    </div>

                    <div className="audio-stage-controls">
                      <div className="audio-stage-controls-side">
                        <button type="button" onClick={changeRate} title="播放倍速" aria-label={`播放倍速 ${playbackRate} 倍`}>
                          <span className="speed-tag">{playbackRate}x</span>
                        </button>
                        {localLrc && (
                          <>
                            <button type="button" onClick={handleCopyLrc} title={copied ? '已复制歌词' : '复制 LRC 歌词'} aria-label="复制 LRC 歌词">
                              {copied ? <Check size={17} /> : <Copy size={17} />}
                            </button>
                            <button type="button" onClick={handleDownloadLrc} title="下载 LRC 歌词" aria-label="下载 LRC 歌词">
                              <Download size={17} />
                            </button>
                          </>
                        )}
                      </div>

                      <div className="audio-stage-controls-center">
                        <button type="button" className="audio-stage-jump" onClick={() => jump(-5)} title="后退 5 秒" aria-label="后退 5 秒">
                          <RotateCcw size={19} />
                        </button>
                        <button type="button" className="audio-stage-play" onClick={togglePlay} aria-label={isPlaying ? '暂停' : '播放'}>
                          {isPlaying ? <Pause size={24} /> : <Play size={24} className="play-icon-offset" />}
                        </button>
                        <button type="button" className="audio-stage-jump" onClick={() => jump(5)} title="快进 5 秒" aria-label="快进 5 秒">
                          <RotateCw size={19} />
                        </button>
                      </div>

                      <div className="audio-stage-controls-side is-right">
                        <button type="button" onClick={toggleMute} title={isMuted ? '取消静音' : '静音'} aria-label={isMuted ? '取消静音' : '静音'}>
                          {isMuted ? <VolumeX size={17} /> : <Volume2 size={17} />}
                        </button>
                      </div>
                    </div>
                  </footer>
                </div>
              </section>
            </div>
          )}
        </>
      )}
    </>
  );
}
