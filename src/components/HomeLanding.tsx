import { useEffect, useState } from 'react';
import { ArrowUpRight, Image as ImageIcon, MessageSquare, Music2, Video } from 'lucide-react';
import BrandLogoSvg from './svg/BrandLogoSvg';
import { getGallery } from '../lib/gallery';
import { galleryTitle } from '../lib/galleryDetail';
import { t } from '../lib/i18n';
import type { Asset } from '../lib/types';

function features() {
  return [
    { href: '/chat', icon: MessageSquare, title: t('对话'), text: t('陪你聊天，也一起把想法说清楚。') },
    { href: '/image', icon: ImageIcon, title: t('图像'), text: t('把脑海中的画面，变成看得见的作品。') },
    { href: '/video', icon: Video, title: t('视频'), text: t('从一个镜头开始，让故事慢慢展开。') },
    { href: '/music', icon: Music2, title: t('音乐'), text: t('为此刻的心情，写一段专属旋律。') },
  ];
}

function previewSrc(asset: Asset) {
  if (asset.kind === 'image') return asset.thumbnail || asset.url;
  return asset.coverThumbnail || asset.coverUrl || asset.thumbnail;
}

export default function HomeLanding() {
  const [works, setWorks] = useState<Asset[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');

  useEffect(() => {
    const controller = new AbortController();
    void getGallery(0, controller.signal).then(page => {
      const records = page.records.filter(asset => asset.status === 'completed').slice(0, 12);
      setWorks(records);
      setStatus(records.length ? 'ready' : 'empty');
    }).catch(() => {
      if (!controller.signal.aborted) setStatus('error');
    });
    return () => controller.abort();
  }, []);

  return (
    <div className="site-home">
      <header className="site-nav">
        <a className="site-brand" href="/" aria-label={t('小o 首页')}>
          <BrandLogoSvg size={30} />
          <span>Olai</span>
        </a>
        <nav className="site-nav-links" aria-label={t('主导航')}>
          <a href="/gallery">{t('作品广场')}</a>
          <a href="/download">{t('下载应用')}</a>
          <a href="/login">{t('登录')}</a>
          <a className="site-nav-cta" href="/chat">{t('开始创作')}</a>
        </nav>
      </header>

      <main className="site-main">
        <section className="site-hero">
          <p className="site-kicker">Online AI Companion</p>
          <h1>{t('对话、图像、视频和音乐，')}<br />{t('都在同一个创作空间。')}</h1>
          <p className="site-lead">{t('Olai 是你的在线 AI 伴侣。先在网页里创作，应用上架后也可以在这里下载。')}</p>
          <div className="site-hero-actions">
            <a className="site-btn-primary" href="/chat">{t('开始创作')}</a>
            <a className="site-btn-secondary" href="/gallery">{t('浏览作品广场')}</a>
          </div>
        </section>

        <section className="site-works" aria-labelledby="site-works-title">
          <div className="site-section-head">
            <h2 id="site-works-title">{t('大家正在创作')}</h2>
            <a href="/gallery">{t('查看全部')}</a>
          </div>
          {status === 'loading' && <div className="site-works-status">{t('正在加载作品…')}</div>}
          {status === 'error' && <div className="site-works-status">{t('作品暂时无法加载，稍后再来看看。')}</div>}
          {status === 'empty' && <div className="site-works-empty">{t('作品广场还没有作品，先去创作第一件吧。')}</div>}
          {status === 'ready' && (
            <div className="site-masonry">
              {works.map(asset => {
                const src = previewSrc(asset);
                const ratio = asset.imageWidth && asset.imageHeight
                  ? String(asset.imageWidth / asset.imageHeight)
                  : asset.kind === 'video' ? '16 / 9' : '1 / 1';
                return (
                  <a className="site-work" href="/gallery" key={asset.id}>
                    {src
                      ? <img className="site-work-media" src={src} alt="" style={{ aspectRatio: ratio }} />
                      : <div className="site-work-media is-placeholder">{asset.kind === 'music' ? t('音乐') : galleryTitle(asset)}</div>}
                    <div className="site-work-copy">
                      <strong>{galleryTitle(asset)}</strong>
                      <span>{asset.kind === 'image' ? t('图像') : asset.kind === 'video' ? t('视频') : t('音乐')}</span>
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </section>

        <section className="site-features" aria-labelledby="site-features-title">
          <div className="site-section-head">
            <h2 id="site-features-title">{t('从这里开始')}</h2>
          </div>
          <div className="site-feature-grid">
            {features().map(item => {
              const Icon = item.icon;
              return (
                <a className="site-feature" href={item.href} key={item.href}>
                  <Icon size={18} strokeWidth={1.75} />
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </a>
              );
            })}
          </div>
        </section>

        <section className="site-download">
          <h2>{t('应用即将上架')}</h2>
          <p>{t('iOS 和 Android 正在准备上架。下载页会一直留在这里，发布后即可获取官方链接。')}</p>
          <a className="site-btn-secondary" href="/download">{t('前往下载页')} <ArrowUpRight size={16} /></a>
        </section>
      </main>

      <footer className="site-footer">
        <span>Olai · {t('让灵感有个伴')}</span>
        <a href="/download">{t('下载应用')}</a>
      </footer>
    </div>
  );
}
