import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Bookmark, Image as ImageIcon, Music2, RefreshCw, Search, Video } from 'lucide-react';
import { getGallery } from '../lib/gallery';
import { readGalleryFavorites, toggleFavoriteId, writeGalleryFavorites } from '../lib/galleryFavorites';
import type { Asset, View } from '../lib/types';
import GalleryCard from './GalleryCard';
import GalleryDetail from './GalleryDetail';
import Companion from './Companion';

type Props = {
  onNavigate: (view: View) => void;
  onDownload: (asset: Asset) => void;
  onReuse: (asset: Asset, prompt: string) => void;
};

type Filter = 'all' | 'image' | 'video' | 'music';

export default function Gallery({ onNavigate, onDownload, onReuse }: Props) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [active, setActive] = useState<{ asset: Asset; rect: DOMRect; source: HTMLElement | null } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const busy = useRef(false);

  useEffect(() => { setFavorites(readGalleryFavorites()); }, []);

  const load = async (offset: number) => {
    if (busy.current) return;
    busy.current = true;
    const current = new AbortController();
    controller.current = current;
    setLoading(true); setError('');
    try {
      const page = await getGallery(offset, AbortSignal.any([current.signal, AbortSignal.timeout(30_000)]));
      if (current.signal.aborted) return;
      setAssets(previous => [...new Map([...previous, ...page.records].map(asset => [asset.id, asset])).values()]);
      setNextOffset(page.nextOffset);
    } catch {
      if (!current.signal.aborted) setError('作品广场暂时无法读取，请稍后重试。');
    } finally {
      if (controller.current === current) {
        busy.current = false;
        if (!current.signal.aborted) setLoading(false);
      }
    }
  };
  useEffect(() => {
    void load(0);
    return () => { controller.current?.abort(); busy.current = false; };
  }, []);

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
    { key: 'all', label: '全部作品' },
    { key: 'image', label: '图像' },
    { key: 'video', label: '视频' },
    { key: 'music', label: '音乐' },
  ];
  const countFor = (key: Filter) => assets.filter(asset => key === 'all' || asset.kind === key).length;
  const resetFilters = () => { setSearch(''); setFilter('all'); setFavoritesOnly(false); };

  return <div className="gallery-page">
    <div className="page-intro gallery-intro">
      <div>
        <span className="eyebrow">EXPLORE THE COMMUNITY</span>
        <h1>作品广场</h1>
        <p>浏览大家已完成的图像、视频与音乐，无需登录。</p>
      </div>
      <span className="library-total">{assets.length}<small>件已加载创作</small></span>
    </div>

    <div className="gallery-toolbar">
      <div className="filter-tabs" role="group" aria-label="作品类型">
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
          title={favoritesOnly ? '显示全部作品' : '只看我收藏的作品'}
        >
          <Bookmark size={15} fill={favoritesOnly ? 'currentColor' : 'none'} />
          <span>收藏</span>
          <em>{favorites.length}</em>
        </button>
        <div className="search-input"><Search size={16} /><input aria-label="搜索作品" placeholder="搜索灵感关键词…" value={search} onChange={event => setSearch(event.target.value)} /></div>
      </div>
    </div>

    {loading && !assets.length ? (
      <div className="gallery-masonry gallery-skeletons" aria-live="polite" aria-busy="true">
        {[0, 1, 2, 3, 4, 5, 6, 7].map(index => <div className={`gallery-skeleton skeleton-${index % 4}`} key={index}><span /><i /><b /></div>)}
        <span className="visually-hidden">正在加载公开作品…</span>
      </div>
    ) : visible.length ? (
      <div className="gallery-masonry">
        {visible.map(asset => <GalleryCard
          key={asset.id}
          asset={asset}
          favorite={favorites.includes(asset.id)}
          onToggleFavorite={toggleFavorite}
          onOpen={(target, rect, source) => setActive({ asset: target, rect, source })}
          onDownload={onDownload}
        />)}
      </div>
    ) : (
      <div className="library-empty gallery-empty">
        {!assets.length && error
          ? <><RefreshCw size={28} /><h2>作品广场暂时走神了</h2><p>{error}</p><button type="button" className="secondary-button empty-reset" onClick={() => void load(0)}>重新加载</button></>
          : assets.length
            ? <><div className="empty-orbit"><Companion size={130} /></div><h2>{favoritesOnly ? '还没有收藏的作品' : '还没有匹配的作品'}</h2><p>{favoritesOnly ? '在作品卡片右上角点一下书签，就会收藏在这里。' : '试试其他关键词，或切换作品类型。'}</p><button type="button" className="secondary-button empty-reset" onClick={resetFilters}>查看全部作品</button></>
            : <><div className="empty-orbit"><Companion size={150} /></div><h2>作品广场还没有作品</h2><p>账号中已完成的创作会出现在这里。来创作第一件作品吧。</p><div className="empty-library-actions">{([{ view: 'image', icon: ImageIcon, title: '生成图像' }, { view: 'video', icon: Video, title: '生成视频' }, { view: 'music', icon: Music2, title: '生成音乐' }] as const).map(({ view, icon: Icon, title }) => <button type="button" className="secondary-button" key={view} onClick={() => onNavigate(view)}><Icon size={16} />{title}<ArrowUpRight size={14} /></button>)}</div></>}
      </div>
    )}

    <div className="gallery-pagination" aria-live="polite">
      {loading && assets.length > 0 && <p role="status">正在加载更多公开作品…</p>}
      {error && assets.length > 0 && <p role="alert">{error}</p>}
      {!loading && nextOffset !== null && assets.length > 0 && <button type="button" className="secondary-button" onClick={() => void load(nextOffset)}>{error ? '重试加载' : '加载更多作品'}</button>}
      {!loading && !error && assets.length > 0 && nextOffset === null && <p>已经看到全部公开作品了。</p>}
    </div>
    <p className="library-footnote">公开作品仅供浏览与下载 · 收藏保存在当前浏览器</p>

    {active && <GalleryDetail
      asset={active.asset}
      sourceRect={active.rect}
      favorite={favorites.includes(active.asset.id)}
      onToggleFavorite={toggleFavorite}
      onClose={() => {
        const source = active.source;
        setActive(null);
        requestAnimationFrame(() => source?.querySelector<HTMLElement>('.gallery-card-open')?.focus());
      }}
      onDownload={onDownload}
      onReuse={onReuse}
    />}
  </div>;
}
