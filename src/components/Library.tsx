import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowUpRight,
  Bookmark,
  FileText,
  Image as ImageIcon,
  LoaderCircle,
  Music2,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Video,
  WandSparkles,
} from 'lucide-react';
import type { Asset, View } from '../lib/types';
import { downloadLrcBlob } from '../lib/lrc';
import { readGalleryFavorites, toggleFavoriteId, writeGalleryFavorites } from '../lib/galleryFavorites';
import { t, tIn } from '../lib/i18n';
import Companion from './Companion';
import GalleryCard from './GalleryCard';
import GalleryDetail from './GalleryDetail';
import MoreMenu from './ui/MoreMenu';

export interface LibraryProps {
  assets: Asset[];
  onNavigate: (view: View) => void;
  onDelete?: (id: string) => void;
  onRetry?: (asset: Asset) => void;
  onDownload: (asset: Asset) => void;
  onEdit?: (asset: Asset) => void;
  onAlignLyrics?: (asset: Asset) => void;
  aligningIds?: string[];
  onDownloadCover?: (asset: Asset) => void;
  onRetryCover?: (asset: Asset) => void;
  onReuse?: (asset: Asset, prompt: string) => void;
  cloudStorage?: boolean;
  onLogin?: () => void;
}

type Filter = 'all' | 'image' | 'video' | 'music';
type MenuItem = { label: string; icon: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean };

export default function Library({
  assets,
  onNavigate,
  onDelete,
  onRetry,
  onDownload,
  onEdit,
  onAlignLyrics,
  aligningIds,
  onDownloadCover,
  onRetryCover,
  onReuse,
  cloudStorage = false,
  onLogin,
}: LibraryProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [active, setActive] = useState<{ asset: Asset; rect: DOMRect; source: HTMLElement | null } | null>(null);

  useEffect(() => { setFavorites(readGalleryFavorites()); }, []);

  const toggleFavorite = (asset: Asset) => {
    setFavorites(previous => writeGalleryFavorites(toggleFavoriteId(previous, asset.id)));
  };

  const matches = (asset: Asset) => {
    const kindMatch = filter === 'all' || asset.kind === filter;
    const query = search.trim().toLowerCase();
    const haystack = `${asset.prompt}\n${asset.song?.title ?? ''}\n${asset.song?.style ?? ''}`.toLowerCase();
    return kindMatch && (!query || haystack.includes(query)) && (!favoritesOnly || favorites.includes(asset.id));
  };
  const visible = assets.filter(matches);
  const tabs: { key: Filter; label: string }[] = [
    { key: 'all', label: t('全部作品') },
    { key: 'image', label: tIn('gallery', '图像') },
    { key: 'video', label: tIn('gallery', '视频') },
    { key: 'music', label: tIn('gallery', '音乐') },
  ];
  const countFor = (key: Filter) => assets.filter(asset => key === 'all' || asset.kind === key).length;
  const resetFilters = () => { setSearch(''); setFilter('all'); setFavoritesOnly(false); };
  const completedCount = assets.filter(asset => asset.status === 'completed').length;

  const menuItems = (asset: Asset): MenuItem[] => {
    const completed = asset.status === 'completed';
    const aligning = !!aligningIds?.includes(asset.id);
    return [
      ...(asset.status === 'failed' && onRetry
        ? [{ label: t('重试生成'), icon: <RefreshCw size={15} />, onClick: () => onRetry(asset) }]
        : []),
      ...(asset.kind === 'music' && completed && asset.song && onEdit
        ? [{ label: t('编辑后生成'), icon: <Pencil size={15} />, onClick: () => onEdit(asset) }]
        : []),
      ...(asset.kind === 'music' && completed && !asset.song?.instrumental && asset.lyrics && onAlignLyrics
        ? [{ label: aligning ? t('正在校准歌词…') : t('校准歌词'), icon: aligning ? <LoaderCircle size={15} className="spin" /> : <WandSparkles size={15} />, disabled: aligning, onClick: () => onAlignLyrics(asset) }]
        : []),
      ...(asset.kind === 'music' && completed && !asset.coverUrl && onRetryCover
        ? [{
            label: asset.coverStatus === 'pending' ? t('正在生成封面…') : asset.coverStatus === 'failed' ? t('重试生成封面') : t('生成封面'),
            icon: asset.coverStatus === 'pending' ? <LoaderCircle size={15} className="spin" /> : <ImageIcon size={15} />,
            disabled: asset.coverStatus === 'pending',
            onClick: () => onRetryCover(asset),
          }]
        : []),
      ...(completed && asset.coverUrl && onDownloadCover
        ? [{ label: t('下载封面'), icon: <ImageIcon size={15} />, onClick: () => onDownloadCover(asset) }]
        : []),
      ...(completed && asset.lyrics
        ? [{ label: t('下载歌词 TXT'), icon: <FileText size={15} />, onClick: () => downloadLrcBlob(asset.lyrics!, `olai-music-${asset.id.slice(0, 8)}.txt`) }]
        : []),
      ...(completed && asset.kind === 'music' && asset.lrc
        ? [{ label: t('下载 LRC 歌词'), icon: <FileText size={15} />, onClick: () => downloadLrcBlob(asset.lrc!, `olai-music-${asset.id.slice(0, 8)}.lrc`) }]
        : []),
      ...(onDelete
        ? [{ label: t('删除作品'), icon: <Trash2 size={15} />, danger: true, disabled: asset.status === 'pending', onClick: () => onDelete(asset.id) }]
        : []),
    ];
  };

  const activeAsset = active ? assets.find(asset => asset.id === active.asset.id) ?? active.asset : null;

  return <div className="gallery-page library-page">
    <div className="page-intro gallery-intro">
      <div>
        <span className="eyebrow">A COLLECTION OF YOUR IMAGINATION</span>
        <h1>{t('我的库')}</h1>
        <p>{cloudStorage ? t('这里只展示你生成的作品，登录后可跨设备查看。') : t('当前浏览器的创作保留在这里，登录后同步到你的账号。')}</p>
        {!cloudStorage && onLogin && <button className="secondary-button library-login" onClick={onLogin}>{t('登录查看我的作品')}</button>}
      </div>
      <span className="library-total">{completedCount}<small>{t('件创作')}</small></span>
    </div>

    <div className="gallery-toolbar">
      <div className="filter-tabs" role="group" aria-label={t('作品类型')}>
        {tabs.map(tab => <button
          type="button"
          className={filter === tab.key ? 'active' : ''}
          aria-pressed={filter === tab.key}
          key={tab.key}
          onClick={() => setFilter(tab.key)}
        >{tab.label}<span>{countFor(tab.key)}</span></button>)}
      </div>
      <div className="gallery-toolbar-actions">
        <button
          type="button"
          className={`gallery-favorite-filter ${favoritesOnly ? 'active' : ''}`}
          aria-pressed={favoritesOnly}
          onClick={() => setFavoritesOnly(value => !value)}
          title={favoritesOnly ? t('显示全部作品') : t('只看我收藏的作品')}
        >
          <Bookmark size={15} fill={favoritesOnly ? 'currentColor' : 'none'} />
          <span>{t('收藏')}</span>
          <em>{favorites.length}</em>
        </button>
        <div className="search-input"><Search size={16} /><input aria-label={t('搜索作品')} placeholder={t('搜索灵感关键词…')} value={search} onChange={event => setSearch(event.target.value)} /></div>
      </div>
    </div>

    {visible.length ? (
      <div className="gallery-masonry">
        {visible.map(asset => <GalleryCard
          key={asset.id}
          asset={asset}
          favorite={favorites.includes(asset.id)}
          onToggleFavorite={toggleFavorite}
          onOpen={(target, rect, source) => setActive({ asset: target, rect, source })}
          onDownload={onDownload}
          captionAction={<MoreMenu label={t('更多作品操作')} items={menuItems(asset)} />}
        />)}
      </div>
    ) : (
      <div className="library-empty gallery-empty">
        {assets.length
          ? <><div className="empty-orbit"><Companion size={130} /></div><h2>{favoritesOnly ? t('还没有收藏的作品') : t('还没有匹配的作品')}</h2><p>{favoritesOnly ? t('在作品卡片右上角点一下书签，就会收藏在这里。') : t('试试其他关键词，或切换作品类型。')}</p><button type="button" className="secondary-button empty-reset" onClick={resetFilters}>{t('查看全部作品')}</button></>
          : <><div className="empty-orbit"><Companion size={150} /></div><h2>{t('第一份灵感，值得一个好位置')}</h2><p>{t('你的作品会在这里相遇。从一个小小的想法开始吧。')}</p><div className="empty-library-actions">{([{ view: 'image', icon: ImageIcon, title: t('生成图像') }, { view: 'video', icon: Video, title: t('生成视频') }, { view: 'music', icon: Music2, title: t('生成音乐') }] as const).map(({ view, icon: Icon, title }) => <button type="button" className="secondary-button" key={view} onClick={() => onNavigate(view)}><Icon size={16} />{title}<ArrowUpRight size={14} /></button>)}</div></>}
      </div>
    )}

    <p className="library-footnote">{cloudStorage ? t('作品保存在你的账号 · 已完成作品也会展示在作品广场 · 重要作品请下载备份') : t('作品保存在当前浏览器 · 登录后可同步 · 重要作品请下载备份')}</p>

    {active && activeAsset && <GalleryDetail
      asset={activeAsset}
      sourceRect={active.rect}
      favorite={favorites.includes(activeAsset.id)}
      onToggleFavorite={toggleFavorite}
      onClose={() => {
        const source = active.source;
        setActive(null);
        requestAnimationFrame(() => source?.querySelector<HTMLElement>('.gallery-card-open')?.focus());
      }}
      onDownload={onDownload}
      onReuse={onReuse ?? (() => undefined)}
      onRetry={onRetry}
      actions={<MoreMenu label={t('更多作品操作')} items={menuItems(activeAsset)} className="gallery-detail-more" />}
    />}
  </div>;
}
