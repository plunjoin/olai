import { useState } from 'react';
import { ArrowUpRight, Image, Music2, Search, Video } from 'lucide-react';
import type { Asset, View } from '../lib/types';
import AssetCard from './AssetCard';
import Companion from './Companion';

export default function Library({ assets, onNavigate, onDelete, onRetry, onDownload, onEdit, onAlignLyrics, aligningIds, onDownloadCover, onRetryCover }: {
  assets: Asset[]; onNavigate: (view: View) => void; onDelete: (id: string) => void; onRetry: (asset: Asset) => void; onDownload: (asset: Asset) => void; onEdit?: (asset: Asset) => void; onAlignLyrics?: (asset: Asset) => void; aligningIds?: string[]; onDownloadCover?: (asset: Asset) => void; onRetryCover?: (asset: Asset) => void;
}) {
  const [filter, setFilter] = useState('all'); const [search, setSearch] = useState('');
  const filtered = assets.filter(a => (filter === 'all' || a.kind === filter) && a.prompt.toLowerCase().includes(search.toLowerCase()));
  const tabs = [['all', '全部作品'], ['image', '图像'], ['video', '视频'], ['music', '音乐']];
  return <div className="library-page"><div className="page-intro"><div><span className="eyebrow">A COLLECTION OF YOUR IMAGINATION</span><h1>我的作品<span className="heading-spark">✳</span></h1><p>每一个灵感，都在这里有了自己的位置。</p></div><span className="library-total">{assets.filter(a => a.status === 'completed').length}<small>件创作</small></span></div><div className="library-toolbar"><div className="filter-tabs">{tabs.map(([key, label]) => <button className={filter === key ? 'active' : ''} key={key} onClick={() => setFilter(key)}>{label}<span>{assets.filter(a => key === 'all' || a.kind === key).length}</span></button>)}</div><div className="search-input"><Search size={16} /><input aria-label="搜索作品" placeholder="搜索灵感关键词…" value={search} onChange={e => setSearch(e.target.value)} /></div></div>
    {filtered.length ? <div className="library-grid">{filtered.map(asset => <AssetCard key={asset.id} asset={asset} onDelete={onDelete} onRetry={onRetry} onDownload={onDownload} onEdit={onEdit} onAlignLyrics={onAlignLyrics} aligning={aligningIds?.includes(asset.id)} onDownloadCover={onDownloadCover} onRetryCover={onRetryCover} />)}</div> : <div className="library-empty"><div className="empty-orbit"><Companion size={150} /></div><h2>{assets.length ? '还没有匹配的作品' : '第一份灵感，值得一个好位置'}</h2><p>{assets.length ? '试试其他关键词，或切换作品类型。' : '你的作品会在这里相遇。从一个小小的想法开始吧。'}</p>{assets.length ? <button className="secondary-button empty-reset" onClick={() => { setSearch(''); setFilter('all'); }}>查看全部作品</button> : <div className="empty-library-actions">{([{ view: 'image', icon: Image, title: '生成图像' }, { view: 'video', icon: Video, title: '生成视频' }, { view: 'music', icon: Music2, title: '生成音乐' }] as const).map(({ view, icon: Icon, title }) => <button className="secondary-button" key={view} onClick={() => onNavigate(view)}><Icon size={16} />{title}<ArrowUpRight size={14} /></button>)}</div>}</div>}<p className="library-footnote">作品保存在当前浏览器 · 重要作品请下载备份 · 远程链接可能过期</p></div>;
}
