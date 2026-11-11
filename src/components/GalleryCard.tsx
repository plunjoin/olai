import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bookmark, CircleAlert, Download, Image as ImageIcon, Music2, SlidersHorizontal, Video, Volume2, VolumeX } from 'lucide-react';
import type { Asset } from '../lib/types';
import { galleryKindLabel, galleryTitle } from '../lib/galleryDetail';
import { usePlayer } from '../lib/playerContext';
import { useAssetURL } from './AssetCard';
import ThinkingOrbSvg from './svg/ThinkingOrbSvg';

export default function GalleryCard({
  asset,
  favorite,
  onToggleFavorite,
  onOpen,
  onDownload,
  captionAction,
}: {
  asset: Asset;
  favorite: boolean;
  onToggleFavorite: (asset: Asset) => void;
  onOpen: (asset: Asset, rect: DOMRect, source: HTMLElement | null) => void;
  onDownload: (asset: Asset) => void;
  /** Extra owner-only control shown in the caption, e.g. the library action menu. */
  captionAction?: ReactNode;
}) {
  const url = useAssetURL(asset);
  // Grid cards use the small bucket-side copy; opening the card loads the original.
  const imageSrc = asset.blob ? url : asset.thumbnail || url;
  const card = useRef<HTMLElement>(null);
  const previewHost = useRef<HTMLDivElement>(null);
  const previewTimer = useRef<number | undefined>(undefined);
  const [imageFailed, setImageFailed] = useState(false);
  const [imageRatio, setImageRatio] = useState<string>();
  const [coverFailed, setCoverFailed] = useState(false);
  const { previewVideo, stopVideoPreview, videoPreview, videoPreviewMuted, setVideoPreviewMuted } = usePlayer();
  const cover = asset.coverUrl && !coverFailed ? asset.coverThumbnail || asset.coverUrl : undefined;
  const Icon = asset.kind === 'image' ? ImageIcon : asset.kind === 'video' ? Video : Music2;
  const title = galleryTitle(asset);
  const kindLabel = galleryKindLabel(asset.kind);
  const pending = asset.status === 'pending';
  const failed = asset.status === 'failed';
  const completed = asset.status === 'completed';
  const statusLabel = pending ? '生成中' : failed ? '生成未完成' : kindLabel;
  const date = new Date(asset.createdAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  // Reserve the real shape before the (possibly slow) media request finishes.
  const mediaRatio = asset.kind === 'image'
    ? asset.imageWidth && asset.imageHeight
      ? `${asset.imageWidth} / ${asset.imageHeight}`
      : imageRatio
    : undefined;

  useEffect(() => { setCoverFailed(false); }, [asset.coverUrl]);

  const previewing = asset.kind === 'video' && videoPreview?.media.id === asset.id;
  const previewingRef = useRef(false);
  previewingRef.current = previewing;
  const stopPreviewRef = useRef(stopVideoPreview);
  stopPreviewRef.current = stopVideoPreview;

  const beginVideoPreview = () => {
    if (asset.kind !== 'video' || !url) return;
    if (typeof window !== 'undefined' && !window.matchMedia('(hover: hover)').matches) return;
    window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(() => {
      const host = previewHost.current;
      if (!host) return;
      previewVideo({ id: asset.id, kind: 'video', src: url, title, prompt: asset.prompt }, host);
    }, 150);
  };
  const endVideoPreview = () => {
    window.clearTimeout(previewTimer.current);
    if (previewingRef.current) stopVideoPreview();
  };
  useEffect(() => () => {
    window.clearTimeout(previewTimer.current);
    if (previewingRef.current) stopPreviewRef.current();
  }, []);

  const open = () => {
    const element = card.current;
    const rect = element?.getBoundingClientRect();
    if (rect) onOpen(asset, rect, element);
  };
  let media: ReactNode;
  if (pending) {
    media = <div className="gallery-card-placeholder is-pending"><ThinkingOrbSvg size={34} label="正在生成作品" /><span>正在生成…</span></div>;
  } else if (failed) {
    media = <div className="gallery-card-placeholder is-failed"><CircleAlert size={26} /><span>生成未完成</span></div>;
  } else if (asset.kind === 'image') {
    media = imageSrc && !imageFailed
      ? <img
          src={imageSrc}
          alt={title}
          loading="lazy"
          onLoad={event => {
            const { naturalWidth, naturalHeight } = event.currentTarget;
            if (naturalWidth && naturalHeight) setImageRatio(`${naturalWidth} / ${naturalHeight}`);
          }}
          onError={() => setImageFailed(true)}
        />
      : <div className="gallery-card-placeholder"><ImageIcon size={26} /><span>图片暂不可用</span></div>;
  } else if (asset.kind === 'video') {
    media = url
      ? <div className={`gallery-video-poster ${cover ? 'has-cover' : ''}`} aria-hidden="true">
          {cover
            ? <img src={cover} alt="" loading="lazy" onError={() => setCoverFailed(true)} />
            : <span className="gallery-video-poster-glow" />}
        </div>
      : <div className="gallery-card-placeholder"><Video size={26} /><span>视频暂不可用</span></div>;
  } else {
    media = <div className="gallery-music-media">
      {cover
        ? <img src={cover} alt={`${title}封面`} loading="lazy" onError={() => setCoverFailed(true)} />
        : <div className="gallery-music-art"><Music2 size={30} /><span>{title}</span></div>}
    </div>;
  }

  return (
    <article
      ref={card}
      className={['gallery-card', `gallery-card-${asset.kind}`, favorite && 'is-favorite', pending && 'is-pending', failed && 'is-failed'].filter(Boolean).join(' ')}
    >
      <div
        className="gallery-card-frame"
        onMouseEnter={beginVideoPreview}
        onMouseLeave={endVideoPreview}
      >
        <div className={`gallery-card-media ${mediaRatio ? 'has-ratio' : ''}`} style={mediaRatio ? { aspectRatio: mediaRatio } : undefined}>
          {media}
          {asset.kind === 'video' && <div ref={previewHost} className="gallery-card-video-preview" aria-hidden="true" />}
          {previewing && <button
            type="button"
            className={`gallery-video-preview-sound ${videoPreviewMuted ? '' : 'is-on'}`}
            aria-label={videoPreviewMuted ? '开启预览声音' : '关闭预览声音'}
            aria-pressed={!videoPreviewMuted}
            title={videoPreviewMuted ? '开启声音' : '关闭声音'}
            onClick={() => setVideoPreviewMuted(!videoPreviewMuted)}
          >
            {videoPreviewMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>}

          <button
            type="button"
            className={`gallery-card-bookmark ${favorite ? 'is-favorite' : ''}`}
            aria-label={favorite ? `取消收藏：${title}` : `收藏作品：${title}`}
            aria-pressed={favorite}
            title={favorite ? '取消收藏' : '收藏'}
            onClick={() => onToggleFavorite(asset)}
          >
            <Bookmark size={16} fill={favorite ? 'currentColor' : 'none'} />
          </button>

          <div className="gallery-card-hover">
            <span className="gallery-kind-pill"><Icon size={13} />{kindLabel}</span>
            <div className="gallery-card-actions">
              <button type="button" aria-label="查看作品参数" title="查看作品参数" onClick={open}>
                <SlidersHorizontal size={16} />
              </button>
              <button type="button" aria-label="下载作品" title={completed ? '下载作品' : '生成完成后可下载'} disabled={!completed} onClick={() => onDownload(asset)}>
                <Download size={16} />
              </button>
            </div>
          </div>
        </div>
        <div className="gallery-card-caption">
          <div className="gallery-card-caption-text">
            <strong title={asset.prompt}>{title}</strong>
            <span>{date} · {statusLabel}</span>
          </div>
          {captionAction && <span className="gallery-card-caption-action">{captionAction}</span>}
        </div>
        <button type="button" className="gallery-card-open" aria-label={`查看作品：${title}`} onClick={open} />
      </div>
    </article>
  );
}
