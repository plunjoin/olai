import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  Bookmark,
  Check,
  CircleAlert,
  Copy,
  Download,
  Image as ImageIcon,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Music2,
  Pause,
  Play,
  RefreshCw,
  Sparkles,
  Video,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { Asset } from '../lib/types';
import { publicServiceError } from '../lib/api';
import { galleryKindLabel, galleryParameters, galleryPublishedAt, galleryTitle } from '../lib/galleryDetail';
import { usePlayer } from '../lib/playerContext';
import { lockBodyScroll } from '../lib/scrollLock';
import { useAssetURL } from './AssetCard';
import ThinkingOrbSvg from './svg/ThinkingOrbSvg';

const PANEL_EASE = 'cubic-bezier(0.2, 0.9, 0.25, 1)';

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function formatTime(secs: number) {
  if (isNaN(secs) || !isFinite(secs) || secs < 0) return '00:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function GalleryDetail({
  asset,
  sourceRect,
  favorite,
  onToggleFavorite,
  onClose,
  onDownload,
  onReuse,
  onRetry,
  actions,
}: {
  asset: Asset;
  sourceRect: DOMRect;
  favorite: boolean;
  onToggleFavorite: (asset: Asset) => void;
  onClose: () => void;
  onDownload: (asset: Asset) => void;
  onReuse: (asset: Asset, prompt: string) => void;
  onRetry?: (asset: Asset) => void;
  /** Owner-only controls shown beside the close button. */
  actions?: ReactNode;
}) {
  const url = useAssetURL(asset);
  const {
    activeMedia,
    isPlaying,
    currentTime,
    duration,
    isMuted,
    play,
    pause,
    seek,
    toggleMute,
    setIsVideoExpanded,
    setVideoInlineHost,
    close: closePlayer,
  } = usePlayer();
  const panel = useRef<HTMLDivElement>(null);
  const videoHost = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const closing = useRef(false);
  const [videoDocked, setVideoDocked] = useState(true);
  const [isClosing, setIsClosing] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [promptDraft, setPromptDraft] = useState(asset.prompt);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const title = galleryTitle(asset);
  const kindLabel = galleryKindLabel(asset.kind);
  const parameters = galleryParameters(asset);
  const playing = activeMedia?.id === asset.id && isPlaying;
  const videoActive = asset.kind === 'video' && activeMedia?.id === asset.id;
  const videoInline = videoActive && videoDocked;
  const progress = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const reuseLabel = asset.kind === 'image' ? '生成图片' : asset.kind === 'video' ? '生成视频' : '生成音乐';
  const pending = asset.status === 'pending';
  const failed = asset.status === 'failed';
  const completed = asset.status === 'completed';
  const statusLabel = pending ? '生成中' : failed ? '未完成' : galleryPublishedAt(asset.createdAt);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    const element = panel.current;
    if (!element || reducedMotion()) { onClose(); return; }
    const target = element.getBoundingClientRect();
    if (!target.width || !target.height) { onClose(); return; }
    setIsClosing(true);
    const animation = element.animate(
      [
        { transform: 'translate(0, 0) scale(1, 1)', borderRadius: getComputedStyle(element).borderRadius, opacity: 1 },
        {
          transform: `translate(${sourceRect.left - target.left}px, ${sourceRect.top - target.top}px) scale(${sourceRect.width / target.width}, ${sourceRect.height / target.height})`,
          borderRadius: '18px',
          opacity: 0,
        },
      ],
      { duration: 340, easing: PANEL_EASE, fill: 'forwards' },
    );
    animation.onfinish = onClose;
    animation.oncancel = onClose;
  }, [onClose, sourceRect]);

  useLayoutEffect(() => {
    const element = panel.current;
    if (!element || reducedMotion()) return;
    const target = element.getBoundingClientRect();
    if (!target.width || !target.height || !sourceRect.width || !sourceRect.height) return;
    element.animate(
      [
        {
          transform: `translate(${sourceRect.left - target.left}px, ${sourceRect.top - target.top}px) scale(${sourceRect.width / target.width}, ${sourceRect.height / target.height})`,
          borderRadius: '18px',
          opacity: 0.55,
        },
        { transform: 'translate(0, 0) scale(1, 1)', borderRadius: getComputedStyle(element).borderRadius, opacity: 1 },
      ],
      { duration: 460, easing: PANEL_EASE },
    );
  }, [sourceRect]);

  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; }, [close]);

  useEffect(() => {
    const releaseScroll = lockBodyScroll();
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panel.current) return;
      const focusable = [...panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], textarea:not(:disabled), video[controls], [tabindex]:not([tabindex="-1"])')]
        .filter(element => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      releaseScroll();
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (copyState === 'idle') return;
    const timer = setTimeout(() => setCopyState('idle'), 2000);
    return () => clearTimeout(timer);
  }, [copyState]);

  useEffect(() => { setPromptDraft(asset.prompt); }, [asset.id]);

  // Dock the global video element inside this panel's stage while the detail is open.
  useEffect(() => {
    if (asset.kind !== 'video' || !url || !videoDocked) return;
    const host = videoHost.current;
    if (!host) return;
    setVideoInlineHost({ mediaId: asset.id, host });
    return () => setVideoInlineHost(null);
  }, [asset.kind, asset.id, url, videoDocked, setVideoInlineHost]);

  // Closing the panel stops an inline playback; a deliberately undocked mini
  // window is left running.
  const stopInlineRef = useRef<() => void>(() => {});
  stopInlineRef.current = () => {
    if (videoDocked && activeMedia?.id === asset.id && activeMedia.kind === 'video') closePlayer();
  };
  useEffect(() => () => stopInlineRef.current(), []);

  // Grow with the prompt so long works stay readable without an inner scrollbar.
  useLayoutEffect(() => {
    const element = promptRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(Math.max(element.scrollHeight + 2, 104), 280)}px`;
  }, [promptDraft]);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(promptDraft);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  const togglePlay = () => {
    if (!url) return;
    if (playing) { pause(); return; }
    if (asset.kind === 'video') setVideoDocked(true);
    play({
      id: asset.id,
      kind: asset.kind === 'video' ? 'video' : 'audio',
      src: url,
      title: asset.song?.title || title,
      prompt: asset.prompt,
      lrc: asset.lrc,
      lrcSource: asset.lrcSource,
      coverUrl: asset.coverUrl,
      lyrics: asset.lyrics,
      song: asset.song,
    });
  };

  return (
    <div className={`gallery-detail ${isClosing ? 'is-closing' : ''}`} role="dialog" aria-modal="true" aria-label={`${kindLabel}作品详情：${title}`}>
      <button type="button" className="gallery-detail-backdrop" aria-label="关闭作品详情" onClick={close} />
      <div className="gallery-detail-panel" ref={panel}>
        <section className="gallery-detail-stage" aria-label="作品展示">
          {pending ? (
            <div className="gallery-detail-missing is-pending">
              <ThinkingOrbSvg size={62} label="正在生成作品" />
              <strong>正在生成这件作品</strong>
              <span>完成后会自动更新，可以稍后回来查看。</span>
            </div>
          ) : failed ? (
            <div className="gallery-detail-missing is-failed">
              <CircleAlert size={38} />
              <strong>生成未完成</strong>
              <span>{publicServiceError(asset.error || '这次生成没有完成，可以重试一次。')}</span>
              {onRetry && <button type="button" className="secondary-button" onClick={() => onRetry(asset)}><RefreshCw size={15} />重试生成</button>}
            </div>
          ) : asset.kind === 'image' ? (
            url && !imageFailed
              ? <img className="gallery-detail-image" src={url} alt={title} onError={() => setImageFailed(true)} />
              : <div className="gallery-detail-missing"><ImageIcon size={30} /><strong>图片暂不可用</strong><span>作品信息仍保留，可稍后再试。</span></div>
          ) : asset.kind === 'video' ? (
            url
              ? <div className={`gallery-detail-video-card ${videoActive ? 'is-video-active' : ''}`}>
                  <div ref={videoHost} className="gallery-detail-video-stage" aria-hidden={!videoActive} />
                  {!videoInline && (asset.coverUrl
                    ? <div className="gallery-detail-video-cover" aria-hidden="true"><img src={asset.coverUrl} alt="" /></div>
                    : <div className="gallery-detail-video-art" aria-hidden="true">
                        <span className="gallery-detail-video-orbit orbit-one" />
                        <span className="gallery-detail-video-orbit orbit-two" />
                        <Video size={58} />
                      </div>)}
                  {!videoActive && (
                    <>
                      <button type="button" className="gallery-detail-video-play" onClick={togglePlay}>
                        <Play size={21} className="play-icon-offset" />
                        播放视频
                      </button>
                      <span className="gallery-detail-video-hint">在详情中播放 · 可切换小窗或大屏观看</span>
                    </>
                  )}
                  {videoActive && !videoDocked && (
                    <>
                      <span className="gallery-detail-video-away">正在小窗播放</span>
                      <button type="button" className="gallery-detail-video-play" onClick={() => setVideoDocked(true)}>
                        <Maximize2 size={18} />
                        回到详情播放
                      </button>
                    </>
                  )}
                  {videoInline && (
                    <>
                      <button type="button" className="gallery-detail-video-tap" aria-label={playing ? '暂停播放' : '播放视频'} onClick={togglePlay} />
                      {!playing && (
                        <span className="gallery-detail-video-center" aria-hidden="true">
                          <Play size={26} className="play-icon-offset" />
                        </span>
                      )}
                      <div className="gallery-detail-video-controls">
                        <input
                          type="range"
                          min={0}
                          max={duration || 100}
                          step={0.1}
                          value={Math.min(currentTime, duration || 100)}
                          onChange={event => seek(parseFloat(event.target.value))}
                          className="video-progress-slider gallery-detail-video-progress"
                          aria-label="播放进度"
                          style={{ background: `linear-gradient(to right, #fff ${progress}%, rgba(255, 255, 255, 0.28) ${progress}%)` }}
                        />
                        <div className="gallery-detail-video-controls-row">
                          <button type="button" onClick={togglePlay} aria-label={playing ? '暂停' : '播放'} title={playing ? '暂停' : '播放'}>
                            {playing ? <Pause size={15} /> : <Play size={15} className="play-icon-offset" />}
                          </button>
                          <span className="gallery-detail-video-time">{formatTime(currentTime)} / {formatTime(duration)}</span>
                          <span className="gallery-detail-video-controls-spacer" />
                          <button type="button" onClick={toggleMute} aria-label={isMuted ? '取消静音' : '静音'} title={isMuted ? '取消静音' : '静音'}>
                            {isMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setVideoDocked(false); setVideoInlineHost(null); }}
                            aria-label="小窗播放"
                            title="小窗播放"
                          >
                            <Minimize2 size={15} />
                          </button>
                          <button type="button" onClick={() => setIsVideoExpanded(true)} aria-label="大屏观看" title="大屏观看">
                            <Maximize2 size={15} />
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              : <div className="gallery-detail-missing"><LoaderCircle size={30} /><strong>视频暂不可用</strong><span>作品信息仍保留，可稍后再试。</span></div>
          ) : (
            <div className="gallery-detail-music">
              <div className="gallery-detail-cover">
                {asset.coverUrl
                  ? <img src={asset.coverUrl} alt={`${title}封面`} />
                  : <div className="gallery-detail-cover-fallback"><Music2 size={54} /><span>{title}</span></div>}
                <button type="button" className="gallery-detail-play" onClick={togglePlay} disabled={!url} aria-label={playing ? '暂停' : '播放'}>
                  {playing ? <Pause size={24} /> : <Play size={24} className="play-icon-offset" />}
                </button>
              </div>
              <div className="gallery-detail-music-meta">
                <strong>{asset.song?.title || title}</strong>
                <span>{asset.song?.style || '原创音乐'}</span>
              </div>
            </div>
          )}
        </section>

        <aside className="gallery-detail-side">
          <header className="gallery-detail-head">
            <div className="gallery-detail-heading">
              <span className="gallery-detail-kicker">{kindLabel}作品 · {statusLabel}</span>
              <h2>{title}</h2>
            </div>
            <div className="gallery-detail-head-actions">
              {actions}
              <button ref={closeButton} type="button" className="gallery-detail-close" aria-label="关闭详情" onClick={close}>
                <X size={18} />
              </button>
            </div>
          </header>

          <div className="gallery-detail-scroll">
            <section className="gallery-detail-block">
              <div className="gallery-detail-block-head">
                <span>提示词</span>
                <button type="button" className="gallery-detail-copy" onClick={() => void copyPrompt()}>
                  {copyState === 'copied' ? <Check size={13} /> : <Copy size={13} />}
                  {copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制'}
                </button>
              </div>
              <textarea
                ref={promptRef}
                className="gallery-detail-prompt"
                aria-label="提示词，可编辑"
                value={promptDraft}
                rows={4}
                spellCheck={false}
                onChange={event => setPromptDraft(event.target.value)}
              />
              <p className="gallery-detail-edit-hint">可直接修改；点击下方按钮会用这段提示词生成。</p>
            </section>

            <section className="gallery-detail-block">
              <div className="gallery-detail-block-head"><span>作品参数</span></div>
              <dl className="gallery-detail-params">
                {parameters.map(parameter => (
                  <div key={parameter.label}>
                    <dt>{parameter.label}</dt>
                    <dd title={parameter.value}>{parameter.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>

          <footer className="gallery-detail-footer">
            <div className="gallery-detail-secondary">
              <button type="button" className={favorite ? 'is-favorite' : ''} aria-pressed={favorite} onClick={() => onToggleFavorite(asset)}>
                <Bookmark size={15} fill={favorite ? 'currentColor' : 'none'} />
                {favorite ? '已收藏' : '收藏'}
              </button>
              {completed ? (
                <button type="button" onClick={() => onDownload(asset)}>
                  <Download size={15} />
                  下载作品
                </button>
              ) : (
                <button type="button" onClick={() => onRetry?.(asset)} disabled={pending || !onRetry}>
                  {pending ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
                  {pending ? '正在生成…' : '重试生成'}
                </button>
              )}
            </div>
            {!pending && (
              <button type="button" className="gallery-detail-cta" disabled={!promptDraft.trim()} onClick={() => onReuse(asset, promptDraft.trim())}>
                <Sparkles size={17} />
                {reuseLabel}
              </button>
            )}
            <p className="gallery-detail-hint">
              {pending ? '生成完成后可以下载，并沿用参数继续创作。' : '沿用这件作品的提示词与参数，打开创作台继续生成。'}
            </p>
          </footer>
        </aside>
      </div>
    </div>
  );
}
