import { useEffect, useState } from 'react';
import {
  CircleAlert,
  Disc3,
  Download,
  FileText,
  Image,
  Music2,
  Pencil,
  WandSparkles,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  Trash2,
  Video,
} from 'lucide-react';
import type { Asset } from '../lib/types';
import { publicServiceError } from '../lib/api';
import { imageResolutionWarning, type ImageResolution } from '../lib/imageResolution';
import { downloadLrcBlob } from '../lib/lrc';
import { getAssetMediaURL, usePlayer } from '../lib/playerContext';
import ThinkingOrbSvg from './svg/ThinkingOrbSvg';
import MoreMenu from './ui/MoreMenu';

export function useAssetURL(asset: Asset) {
  const [url, setURL] = useState(() => getAssetMediaURL(asset));
  useEffect(() => {
    setURL(getAssetMediaURL(asset));
  }, [asset.blob, asset.url]);
  return url;
}

export default function AssetCard({
  asset,
  onDelete,
  onRetry,
  onDownload,
  onEdit,
  onAlignLyrics,
  onDownloadCover,
  onRetryCover,
  aligning = false,
}: {
  asset: Asset;
  onDelete: (id: string) => void;
  onRetry: (asset: Asset) => void;
  onDownload: (asset: Asset) => void;
  onEdit?: (asset: Asset) => void;
  onAlignLyrics?: (asset: Asset) => void;
  aligning?: boolean;
  onDownloadCover?: (asset: Asset) => void;
  onRetryCover?: (asset: Asset) => void;
}) {
  const url = useAssetURL(asset);
  const [loadError, setLoadError] = useState(false);
  const [loadedResolution, setLoadedResolution] = useState<ImageResolution>();
  const { activeMedia, isPlaying, play, pause, setIsExpanded } = usePlayer();

  useEffect(() => { setLoadError(false); setLoadedResolution(undefined); }, [url]);
  const resolution = loadedResolution || (asset.imageWidth && asset.imageHeight ? { width: asset.imageWidth, height: asset.imageHeight } : undefined);
  const resolutionWarning = imageResolutionWarning(resolution, asset.options.image_size);

  const isCurrentActive = activeMedia?.id === asset.id;
  const isCurrentPlaying = isCurrentActive && isPlaying;
  const Icon = asset.kind === 'image' ? Image : asset.kind === 'video' ? Video : Music2;

  const handleMediaToggle = () => {
    if (!url) return;
    if (isCurrentPlaying) {
      pause();
    } else {
      play({
        id: asset.id,
        kind: asset.kind === 'video' ? 'video' : 'audio',
        src: url,
        title: asset.song?.title || asset.prompt.slice(0, 36) || (asset.kind === 'video' ? 'AI 视频' : '原创音乐'),
        prompt: asset.prompt,
        lrc: asset.lrc,
        lrcSource: asset.lrcSource,
        coverUrl: asset.coverUrl,
        lyrics: asset.lyrics,
        song: asset.song,
      });
    }
  };

  const handleExpandLyrics = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!url) return;
    play({
      id: asset.id,
      kind: 'audio',
      src: url,
      title: asset.song?.title || asset.prompt.slice(0, 36) || '原创音乐',
      prompt: asset.prompt,
      lrc: asset.lrc,
      lrcSource: asset.lrcSource,
      coverUrl: asset.coverUrl,
      lyrics: asset.lyrics,
      song: asset.song,
    });
    setIsExpanded(true);
  };

  return (
    <article className={`asset-card ${asset.kind === 'music' ? 'audio-asset' : ''} ${isCurrentPlaying ? 'is-playing' : ''}`}>
      <div className={`asset-preview ${asset.kind}`}>
        {asset.status === 'pending' ? (
          <div className="asset-placeholder">
            <ThinkingOrbSvg size={34} label="小o 正在创作" />
            <strong>{asset.kind === 'video' ? '视频正在生成' : '正在构建你的灵感'}</strong>
            <span>作品完成后会自动出现在这里</span>
          </div>
        ) : asset.status === 'failed' ? (
          <div className="asset-placeholder failed">
            <CircleAlert size={25} />
            <strong>生成未完成</strong>
            <span>{publicServiceError(asset.error || '生成未完成，请重试。')}</span>
            <button className="secondary-button" onClick={() => onRetry(asset)}>
              <RefreshCw size={14} />重试
            </button>
          </div>
        ) : !url || loadError ? (
          <div className="asset-placeholder">
            <Icon size={28} />
            <strong>{loadError ? '媒体链接暂时不可用' : '暂无可预览内容'}</strong>
            <span>可重试生成，或尝试下载作品</span>
          </div>
        ) : asset.kind === 'image' ? (
          <img src={url} alt={asset.prompt} loading="lazy" onError={() => setLoadError(true)} onLoad={event => {
            const image = event.currentTarget;
            setLoadedResolution({ width: image.naturalWidth, height: image.naturalHeight });
          }} />
        ) : asset.kind === 'video' ? (
          <div className="card-video-container" onClick={handleMediaToggle}>
            <video
              src={url}
              preload="metadata"
              muted
              playsInline
              onError={() => setLoadError(true)}
            />
            <div className={`card-media-overlay ${isCurrentPlaying ? 'active' : ''}`}>
              <button
                type="button"
                className="card-play-trigger-btn"
                aria-label={isCurrentPlaying ? '暂停' : '在右下角播放'}
                title={isCurrentPlaying ? '暂停播放' : '右下角悬浮小屏播放'}
              >
                {isCurrentPlaying ? <Pause size={24} /> : <Play size={24} className="play-icon-offset" />}
              </button>
              {isCurrentPlaying && (
                <span className="card-playing-indicator">
                  <span className="playing-pulse-dot" /> 右下角小屏播放中
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="card-audio-container" onClick={handleMediaToggle}>
            {asset.coverUrl ? <img className="card-album-cover" src={asset.coverUrl} alt={`${asset.song?.title || '原创音乐'}封面`} /> : <div className={`card-vinyl ${isCurrentPlaying ? 'spinning' : ''}`}>
              <div className="card-vinyl-groove" />
              <div className="card-vinyl-label">
                <Music2 size={24} />
              </div>
            </div>}

            {/* Equalizer animation */}
            <div className={`card-audio-eq ${isCurrentPlaying ? 'active' : ''}`}>
              <span className="c-eq-1" />
              <span className="c-eq-2" />
              <span className="c-eq-3" />
              <span className="c-eq-4" />
            </div>

            <div className="card-audio-overlay">
              <button
                type="button"
                className="card-play-trigger-btn"
                aria-label={isCurrentPlaying ? '暂停' : '播放'}
                title={isCurrentPlaying ? '暂停' : '全局悬浮播放'}
              >
                {isCurrentPlaying ? <Pause size={24} /> : <Play size={24} className="play-icon-offset" />}
              </button>
              <button
                type="button"
                className="card-open-lyrics-btn"
                onClick={handleExpandLyrics}
                title="展开动态歌词与完整唱片"
              >
                <Disc3 size={13} />
                <span>歌词 / 唱片</span>
              </button>
            </div>
          </div>
        )}

        <span className="media-badge">
          <Icon size={12} />
          {asset.kind === 'image' ? '图像' : asset.kind === 'video' ? '视频' : '音乐'}
        </span>
      </div>

      <div className="asset-info">
        {asset.kind === 'image' && asset.status === 'completed' && <>
          <div className="image-resolution">{resolution ? `实际尺寸：${resolution.width} × ${resolution.height} 像素` : '实际尺寸：暂未读取'}{asset.options.image_size ? ` · 目标 ${asset.options.image_size}` : ''}</div>
          {resolutionWarning && <div className="image-resolution-warning" role="status">{resolutionWarning}</div>}
        </>}
        {asset.kind === 'music' && asset.song && (
          <div className="asset-song-details">
            <span>{asset.song.instrumental ? '纯音乐' : asset.lrcSource === 'audio' ? '歌词已按音频校准' : '歌词已关联 · 时间待校准'}</span>
            <details>
              <summary>查看歌曲段落</summary>
              <pre>{asset.lyrics || asset.song.sections.map(s => `[${s.type}] ${s.direction}`).join('\n')}</pre>
            </details>
          </div>
        )}
        {asset.kind === 'music' && asset.lrcError && <p className="lyric-alignment-error" role="alert">{asset.lrcError}</p>}
        {asset.kind === 'music' && asset.status === 'completed' && asset.coverStatus === 'pending' && <p className="cover-status" role="status"><LoaderCircle size={12} className="spin" />正在绘制歌曲封面…</p>}
        {asset.kind === 'music' && asset.coverStatus === 'failed' && <p className="lyric-alignment-error" role="alert">封面生成未完成：{asset.coverError} {onRetryCover && <button className="text-button" onClick={() => onRetryCover(asset)}>重试封面</button>}</p>}
        {asset.kind === 'music' && asset.status === 'completed' && <div className="music-asset-actions">
          {asset.song && onEdit && <button className="secondary-button small" onClick={() => onEdit(asset)}><Pencil size={13} />编辑后生成</button>}
          {!asset.song?.instrumental && asset.lyrics && onAlignLyrics && <button className="secondary-button small" disabled={aligning} onClick={() => onAlignLyrics(asset)}>{aligning ? <LoaderCircle size={13} className="spin" /> : <WandSparkles size={13} />}{aligning ? '正在校准歌词…' : '校准歌词'}</button>}
          {!asset.coverUrl && asset.coverStatus !== 'failed' && onRetryCover && <button className="secondary-button small" disabled={asset.coverStatus === 'pending'} onClick={() => onRetryCover(asset)}>{asset.coverStatus === 'pending' ? <LoaderCircle size={13} className="spin" /> : <Image size={13} />}{asset.coverStatus === 'pending' ? '正在生成封面…' : '生成封面'}</button>}
        </div>}
        <p title={asset.song?.title || asset.prompt}>{asset.song?.title || asset.prompt}</p>
        <div className="asset-meta">
          <span>
            {new Date(asset.createdAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })} ·{' '}
            {asset.kind === 'music' ? '原创音乐' : asset.kind === 'video' ? '动态影像' : '灵感图像'}
          </span>
          <div>
            {asset.status === 'completed' && asset.lyrics && (
              <button
                className="icon-button"
                aria-label="下载 TXT 歌词"
                title="下载 TXT 歌词"
                onClick={() => downloadLrcBlob(asset.lyrics!, `olai-music-${asset.id.slice(0, 8)}.txt`)}
              >
                <FileText size={15} />
              </button>
            )}
            {asset.status === 'completed' && asset.kind === 'music' && asset.lrc && (
              <button
                className="icon-button"
                aria-label={asset.lrcSource === 'audio' ? '下载 LRC 歌词（音频校准）' : '下载 LRC 歌词（估算时间）'}
                title="下载 LRC 歌词"
                onClick={() => downloadLrcBlob(asset.lrc!, `olai-music-${asset.id.slice(0, 8)}.lrc`)}
              >
                <FileText size={15} />
              </button>
            )}
            {asset.status === 'completed' && (
              <button
                className="icon-button"
                aria-label="下载作品"
                title="下载作品及关联文件"
                onClick={() => onDownload(asset)}
              >
                <Download size={15} />
              </button>
            )}
            {asset.status === 'completed' && asset.coverUrl && onDownloadCover && <button className="icon-button" aria-label="下载封面" title="下载封面" onClick={() => onDownloadCover(asset)}><Image size={15} /></button>}
            <MoreMenu label="更多作品操作" items={[{ label: '删除作品', icon: <Trash2 size={15} />, danger: true, disabled: asset.status === 'pending', onClick: () => onDelete(asset.id) }]} />
          </div>
        </div>
      </div>
    </article>
  );
}
