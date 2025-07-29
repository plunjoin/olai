import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Disc3,
  Download,
  FileText,
  Music2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { downloadLrcBlob, generateLrcFromPrompt, parseLRC, type LyricLine } from '../lib/lrc';

export interface AudioPlayerProps {
  src: string;
  title?: string;
  prompt?: string;
  lrc?: string;
  onLrcChange?: (newLrc: string) => void;
  className?: string;
}

export default function AudioPlayer({
  src,
  title = 'AI 原创音频',
  prompt = '',
  lrc,
  onLrcChange,
  className = '',
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lyricsContainerRef = useRef<HTMLDivElement | null>(null);
  const activeLyricRef = useRef<HTMLDivElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [viewMode, setViewMode] = useState<'disc' | 'lyrics'>('disc');
  const [copied, setCopied] = useState(false);

  // 本地歌词状态（优先传入的 lrc，若无且有 prompt 则允许即时生成）
  const [currentLrc, setCurrentLrc] = useState(lrc || '');

  useEffect(() => {
    if (lrc) {
      setCurrentLrc(lrc);
    } else if (prompt && !currentLrc) {
      // 默认若有歌词文本，生成初始时间轴 LRC
      const autoLrc = generateLrcFromPrompt(prompt, duration || 30, title);
      setCurrentLrc(autoLrc);
      onLrcChange?.(autoLrc);
    }
  }, [lrc, prompt]);

  // 解析歌词列表
  const parsedLyrics: LyricLine[] = parseLRC(currentLrc);

  // 匹配当前高亮歌词索引
  const activeIndex = parsedLyrics.reduce((acc, line, idx) => {
    if (currentTime >= line.time) return idx;
    return acc;
  }, -1);

  // 自动滚动高亮歌词到中央
  useEffect(() => {
    if (viewMode === 'lyrics' && activeLyricRef.current) {
      activeLyricRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [activeIndex, viewMode]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
  };

  const onTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const onLoadedMetadata = () => {
    if (audioRef.current) {
      const d = audioRef.current.duration;
      if (d && !isNaN(d) && isFinite(d)) {
        setDuration(d);
        // 如果之前使用默认时长生成的 LRC，在获取到真实时长后重新按真实时长校准
        if (!lrc && prompt) {
          const refinedLrc = generateLrcFromPrompt(prompt, d, title);
          setCurrentLrc(refinedLrc);
          onLrcChange?.(refinedLrc);
        }
      }
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setCurrentTime(val);
    if (audioRef.current) {
      audioRef.current.currentTime = val;
    }
  };

  const jump = (delta: number) => {
    if (audioRef.current) {
      const target = Math.min(Math.max(0, audioRef.current.currentTime + delta), duration || 999);
      audioRef.current.currentTime = target;
      setCurrentTime(target);
    }
  };

  const toggleMute = () => {
    if (!audioRef.current) return;
    const next = !isMuted;
    setIsMuted(next);
    audioRef.current.muted = next;
  };

  const changeRate = () => {
    if (!audioRef.current) return;
    const rates = [1, 1.25, 1.5, 2];
    const nextIdx = (rates.indexOf(playbackRate) + 1) % rates.length;
    const next = rates[nextIdx];
    setPlaybackRate(next);
    audioRef.current.playbackRate = next;
  };

  const seekToLyric = (time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
      if (!isPlaying) {
        audioRef.current.play().catch(() => {});
      }
    }
  };

  const handleDownloadLrc = () => {
    if (!currentLrc) return;
    downloadLrcBlob(currentLrc, `${title.replace(/\s+/g, '_')}.lrc`);
  };

  const handleCopyLrc = async () => {
    if (!currentLrc) return;
    await navigator.clipboard.writeText(currentLrc);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRegenerateLrc = () => {
    if (!prompt) return;
    const newLrc = generateLrcFromPrompt(prompt, duration || 30, title);
    setCurrentLrc(newLrc);
    onLrcChange?.(newLrc);
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className={`pro-audio-player ${className}`}>
      {/* 隐藏的基础原生音频标签 */}
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMetadata}
      />

      {/* 播放器顶部：标题与视图切换 */}
      <div className="player-header">
        <div className="player-title-info">
          <span className="player-badge">AI AUDIO</span>
          <h4 title={title}>{title}</h4>
        </div>
        <div className="player-tab-toggles">
          <button
            type="button"
            className={`tab-btn ${viewMode === 'disc' ? 'active' : ''}`}
            onClick={() => setViewMode('disc')}
            title="黑胶唱片模式"
          >
            <Disc3 size={15} />
            <span>唱片</span>
          </button>
          <button
            type="button"
            className={`tab-btn ${viewMode === 'lyrics' ? 'active' : ''}`}
            onClick={() => setViewMode('lyrics')}
            title="动态歌词模式"
          >
            <FileText size={15} />
            <span>歌词 (LRC)</span>
          </button>
        </div>
      </div>

      {/* 主展示区：黑胶模式 or 歌词滚动模式 */}
      <div className="player-visual-stage">
        {viewMode === 'disc' ? (
          <div className="disc-stage">
            <div className={`vinyl-record ${isPlaying ? 'spinning' : ''}`}>
              <div className="vinyl-groove groove-1" />
              <div className="vinyl-groove groove-2" />
              <div className="vinyl-groove groove-3" />
              <div className="vinyl-label">
                <Music2 size={24} />
              </div>
            </div>

            {/* 动态跳动频谱动画 */}
            <div className={`audio-equalizer ${isPlaying ? 'active' : ''}`}>
              <span className="eq-bar bar-1" />
              <span className="eq-bar bar-2" />
              <span className="eq-bar bar-3" />
              <span className="eq-bar bar-4" />
              <span className="eq-bar bar-5" />
              <span className="eq-bar bar-6" />
            </div>

            {/* 当前歌词浮动预览 */}
            {parsedLyrics.length > 0 && activeIndex >= 0 && (
              <p className="disc-live-lyric">{parsedLyrics[activeIndex]?.text}</p>
            )}
          </div>
        ) : (
          <div className="lyrics-stage" ref={lyricsContainerRef}>
            {parsedLyrics.length > 0 ? (
              <div className="lyrics-scroll-list">
                {parsedLyrics.map((item, idx) => {
                  const isActive = idx === activeIndex;
                  return (
                    <div
                      key={idx}
                      ref={isActive ? activeLyricRef : null}
                      className={`lyric-line ${isActive ? 'active' : ''}`}
                      onClick={() => seekToLyric(item.time)}
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
                <p>暂无对齐歌词数据</p>
                {prompt && (
                  <button type="button" className="secondary-button small" onClick={handleRegenerateLrc}>
                    <Sparkles size={14} />
                    智能生成 LRC 歌词
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 进度条与时间显示 */}
      <div className="player-progress-bar-container">
        <span className="time-label">{formatTime(currentTime)}</span>
        <div className="progress-track-wrapper">
          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            className="progress-slider"
            style={{
              background: `linear-gradient(to right, var(--accent-lime, #b6ff3e) ${progressPercent}%, rgba(255,255,255,0.12) ${progressPercent}%)`,
            }}
          />
        </div>
        <span className="time-label">{formatTime(duration)}</span>
      </div>

      {/* 控制操作栏 */}
      <div className="player-controls-bar">
        <div className="controls-left">
          <button type="button" className="control-icon-btn" onClick={changeRate} title="播放速度">
            <span className="speed-tag">{playbackRate}x</span>
          </button>
          <button type="button" className="control-icon-btn" onClick={toggleMute} title={isMuted ? '取消静音' : '静音'}>
            {isMuted ? <VolumeX size={17} /> : <Volume2 size={17} />}
          </button>
        </div>

        {/* 核心播放控制 */}
        <div className="controls-center">
          <button type="button" className="control-icon-btn" onClick={() => jump(-5)} title="后退 5 秒">
            <RotateCcw size={17} />
          </button>
          <button
            type="button"
            className="play-pause-circle-btn"
            onClick={togglePlay}
            aria-label={isPlaying ? '暂停' : '播放'}
          >
            {isPlaying ? <Pause size={20} /> : <Play size={20} className="play-icon-offset" />}
          </button>
          <button type="button" className="control-icon-btn" onClick={() => jump(5)} title="快进 5 秒">
            <RotateCw size={17} />
          </button>
        </div>

        {/* LRC 导出与复制工具 */}
        <div className="controls-right">
          {currentLrc && (
            <>
              <button
                type="button"
                className="control-icon-btn"
                onClick={handleCopyLrc}
                title={copied ? '已复制歌词' : '复制 LRC 歌词'}
              >
                {copied ? <Check size={16} color="var(--accent-lime, #b6ff3e)" /> : <Copy size={16} />}
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
  );
}
