import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Disc3,
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
import Dialog from './ui/Dialog';
import { downloadLrcBlob, generateLrcFromPrompt, parseLRC, type LyricLine } from '../lib/lrc';
import { sungLines } from '../lib/music';

function formatTime(secs: number) {
  if (isNaN(secs) || !isFinite(secs) || secs < 0) return '00:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
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
    setIsPlaying,
    setDuration,
    close,
  } = usePlayer();

  const [audioViewMode, setAudioViewMode] = useState<'disc' | 'lyrics'>('disc');
  const [copied, setCopied] = useState(false);
  const [videoHovered, setVideoHovered] = useState(false);
  const [localLrc, setLocalLrc] = useState('');

  const lyricsContainerRef = useRef<HTMLDivElement | null>(null);
  const activeLyricRef = useRef<HTMLDivElement | null>(null);
  const videoWrapperRef = useRef<HTMLDivElement | null>(null);

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
    if (isExpanded && audioViewMode === 'lyrics' && activeLyricRef.current) {
      activeLyricRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [activeIndex, isExpanded, audioViewMode]);

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
    if (!videoWrapperRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      videoWrapperRef.current.requestFullscreen().catch(() => {});
    }
  };

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

  const progressPercent =
    duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  return (
    <>
      {/* Global native audio element (lives as long as app lives) */}
      <audio
        ref={audioRef}
        src={activeMedia?.kind === 'audio' ? activeMedia.src : undefined}
        preload="auto"
        onPlay={() => setIsPlaying(true)}
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
          1. Global Floating Video Player (视频小屏在右下角)
          ========================================================================= */}
      {activeMedia?.kind === 'video' && (
        <aside
          ref={videoWrapperRef}
          className="floating-video-player"
          onMouseEnter={() => setVideoHovered(true)}
          onMouseLeave={() => setVideoHovered(false)}
          aria-label="浮窗视频播放器"
        >
          {/* Top Bar Header */}
          <div className={`floating-video-header ${videoHovered || !isPlaying ? 'visible' : ''}`}>
            <div className="floating-video-title">
              <span className="floating-video-badge">
                <Video size={11} /> 视频播放
              </span>
              <span className="title-text" title={activeMedia.title}>
                {activeMedia.title}
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
              <button
                type="button"
                className="header-action-btn"
                onClick={toggleFullscreen}
                title="全屏播放"
                aria-label="全屏"
              >
                <Maximize2 size={14} />
              </button>
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

          {/* Video Stage with Click-to-Play/Pause */}
          <div className="floating-video-stage" onClick={togglePlay}>
            <video
              ref={videoRef}
              src={activeMedia.src}
              playsInline
              preload="auto"
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onTimeUpdate={onVideoTimeUpdate}
              onLoadedMetadata={onVideoLoadedMetadata}
              onEnded={() => {
                pause();
              }}
              onError={(e) => {
                console.warn('Video element error:', e);
                setIsPlaying(false);
              }}
            />
            {!isPlaying && (
              <div className="video-pause-overlay">
                <div className="video-play-pulse">
                  <Play size={26} className="play-icon-offset" />
                </div>
              </div>
            )}
          </div>

          {/* Bottom Controls Bar */}
          <div className={`floating-video-controls ${videoHovered || !isPlaying ? 'visible' : ''}`}>
            {/* Scrubber */}
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
        </aside>
      )}

      {/* =========================================================================
          2. Global Floating Audio Player (音频全局悬浮播放器)
          ========================================================================= */}
      {activeMedia?.kind === 'audio' && (
        <>
          {/* A. Compact Capsule (Bottom-Right floating pill) */}
          {!isExpanded && (
            <aside className="floating-audio-capsule" aria-label="浮窗音频播放器">
              {/* Mini spinning vinyl disc */}
              <div
                className={`capsule-disc ${isPlaying ? 'spinning' : ''}`}
                onClick={() => setIsExpanded(true)}
                title="展开唱片与歌词"
              >
                <div className="capsule-disc-groove" />
                <div className="capsule-disc-center">
                  {activeMedia.coverUrl ? <img src={activeMedia.coverUrl} alt="歌曲封面" /> : <Music2 size={12} />}
                </div>
              </div>

              {/* Title & Live Lyric snippet */}
              <div
                className="capsule-info"
                onClick={() => setIsExpanded(true)}
                title="点击展开完整歌词与唱片"
              >
                <div className="capsule-title-row">
                  <span className="capsule-badge">AI 音频</span>
                  <span className="capsule-title">{activeMedia.title}</span>
                </div>
                <div className="capsule-lyric-row">
                  {parsedLyrics.length > 0 && activeIndex >= 0 ? (
                    <span className="capsule-lyric">{parsedLyrics[activeIndex]?.text}</span>
                  ) : (
                    <span className="capsule-time">
                      {formatTime(currentTime)} / {formatTime(duration)}
                    </span>
                  )}
                </div>
              </div>

              {/* Capsule Controls */}
              <div className="capsule-controls">
                <button
                  type="button"
                  className="capsule-play-btn"
                  onClick={togglePlay}
                  aria-label={isPlaying ? '暂停' : '播放'}
                >
                  {isPlaying ? <Pause size={16} /> : <Play size={16} className="play-icon-offset" />}
                </button>

                <button
                  type="button"
                  className="capsule-icon-btn"
                  onClick={() => setIsExpanded(true)}
                  title="展开唱片与歌词"
                  aria-label="展开"
                >
                  <FileText size={15} />
                </button>

                <button
                  type="button"
                  className="capsule-icon-btn"
                  onClick={toggleMute}
                  title={isMuted ? '取消静音' : '静音'}
                  aria-label="静音切换"
                >
                  {isMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                </button>

                <button
                  type="button"
                  className="capsule-icon-btn close-btn"
                  onClick={close}
                  title="关闭播放器"
                  aria-label="关闭"
                >
                  <X size={15} />
                </button>
              </div>

              {/* Mini progress line at bottom of capsule */}
              <div className="capsule-progress-bar">
                <div
                  className="capsule-progress-fill"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </aside>
          )}

          {/* B. Expanded Full Audio Player Modal / Panel */}
          {isExpanded && (
            <Dialog labelledBy="audio-player-title" onClose={() => setIsExpanded(false)} className="audio-player-dialog">
              <div
                className="floating-audio-expanded"
                onClick={e => e.stopPropagation()}
              >
                {/* Header */}
                <div className="player-header">
                  <div className="player-title-info">
                    <span className="player-badge">AI AUDIO</span>
                    <h4 id="audio-player-title" title={activeMedia.title}>{activeMedia.title}</h4>
                  </div>
                  <div className="player-tab-toggles">
                    <button
                      type="button"
                      className={`tab-btn ${audioViewMode === 'disc' ? 'active' : ''}`}
                      onClick={() => setAudioViewMode('disc')}
                    >
                      <Disc3 size={15} />
                      <span>唱片</span>
                    </button>
                    <button
                      type="button"
                      className={`tab-btn ${audioViewMode === 'lyrics' ? 'active' : ''}`}
                      onClick={() => setAudioViewMode('lyrics')}
                    >
                      <FileText size={15} />
                      <span>歌词 (LRC)</span>
                    </button>
                  </div>
                  <div className="player-header-actions">
                    <button
                      type="button"
                      className="control-icon-btn"
                      onClick={() => setIsExpanded(false)}
                      title="最小化为悬浮胶囊"
                      aria-label="最小化"
                    >
                      <Minimize2 size={16} />
                    </button>
                    <button
                      type="button"
                      className="control-icon-btn close-btn"
                      onClick={close}
                      title="关闭播放器"
                      aria-label="关闭"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>

                {/* Visual Stage */}
                {activeMedia.lyrics && !activeMedia.song?.instrumental && <div className="player-lyrics-status">
                  <span>{activeMedia.lrcSource === 'audio' ? '已按音频校准 · 可试听检查' : '歌词时间为估算 · 可按音频校准'}</span>
                  {onAlignLyrics && <button className="secondary-button small" disabled={aligningIds.includes(activeMedia.id)} onClick={() => onAlignLyrics(activeMedia.id)}>{aligningIds.includes(activeMedia.id) ? <LoaderCircle size={13} className="spin" /> : <Sparkles size={13} />}{aligningIds.includes(activeMedia.id) ? '正在校准歌词…' : '校准歌词'}</button>}
                </div>}
                <div className="player-visual-stage">
                  {audioViewMode === 'disc' ? (
                    <div className="disc-stage">
                      <div className={`vinyl-record ${isPlaying ? 'spinning' : ''}`}>
                        <div className="vinyl-groove groove-1" />
                        <div className="vinyl-groove groove-2" />
                        <div className="vinyl-groove groove-3" />
                        <div className="vinyl-label">
                          {activeMedia.coverUrl ? <img src={activeMedia.coverUrl} alt="歌曲封面" /> : <Music2 size={24} />}
                        </div>
                      </div>

                      {/* Equalizer animation */}
                      <div className={`audio-equalizer ${isPlaying ? 'active' : ''}`}>
                        <span className="eq-bar bar-1" />
                        <span className="eq-bar bar-2" />
                        <span className="eq-bar bar-3" />
                        <span className="eq-bar bar-4" />
                        <span className="eq-bar bar-5" />
                        <span className="eq-bar bar-6" />
                      </div>

                      {/* Live Lyric Line */}
                      {parsedLyrics.length > 0 && activeIndex >= 0 && (
                        <p className="disc-live-lyric">{parsedLyrics[activeIndex]?.text}</p>
                      )}
                    </div>
                  ) : (
                    <div className="lyrics-stage" ref={lyricsContainerRef}>
                      {parsedLyrics.length > 0 ? (
                        <div className="lyrics-scroll-list">
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
                                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); seek(item.time); } }}
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
                          <FileText size={32} />
                          <p>{activeMedia.song?.instrumental ? '纯音乐，享受旋律。' : '暂无对齐歌词数据'}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Progress bar */}
                <div className="player-progress-bar-container">
                  <span className="time-label">{formatTime(currentTime)}</span>
                  <div className="progress-track-wrapper">
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
                        background: `linear-gradient(to right, var(--accent-lime, #7047eb) ${progressPercent}%, rgba(255,255,255,0.12) ${progressPercent}%)`,
                      }}
                    />
                  </div>
                  <span className="time-label">{formatTime(duration)}</span>
                </div>

                {/* Controls Bar */}
                <div className="player-controls-bar">
                  <div className="controls-left">
                    <button
                      type="button"
                      className="control-icon-btn"
                      onClick={changeRate}
                      title="播放倍速"
                    >
                      <span className="speed-tag">{playbackRate}x</span>
                    </button>
                    <button
                      type="button"
                      className="control-icon-btn"
                      onClick={toggleMute}
                      title={isMuted ? '取消静音' : '静音'}
                    >
                      {isMuted ? <VolumeX size={17} /> : <Volume2 size={17} />}
                    </button>
                  </div>

                  <div className="controls-center">
                    <button
                      type="button"
                      className="control-icon-btn"
                      onClick={() => jump(-5)}
                      title="后退 5 秒"
                    >
                      <RotateCcw size={17} />
                    </button>
                    <button
                      type="button"
                      className="play-pause-circle-btn"
                      onClick={togglePlay}
                      aria-label={isPlaying ? '暂停' : '播放'}
                    >
                      {isPlaying ? (
                        <Pause size={20} />
                      ) : (
                        <Play size={20} className="play-icon-offset" />
                      )}
                    </button>
                    <button
                      type="button"
                      className="control-icon-btn"
                      onClick={() => jump(5)}
                      title="快进 5 秒"
                    >
                      <RotateCw size={17} />
                    </button>
                  </div>

                  <div className="controls-right">
                    {localLrc && (
                      <>
                        <button
                          type="button"
                          className="control-icon-btn"
                          onClick={handleCopyLrc}
                          title={copied ? '已复制歌词' : '复制 LRC 歌词'}
                        >
                          {copied ? (
                            <Check size={16} color="var(--accent-lime, #7047eb)" />
                          ) : (
                            <Copy size={16} />
                          )}
                        </button>
                        <button
                          type="button"
                          className="control-icon-btn"
                          onClick={handleDownloadLrc}
                          title="导出并下载 .LRC 歌词文件"
                        >
                          <Download size={16} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </Dialog>
          )}
        </>
      )}
    </>
  );
}
