import { CloudUpload, Images, Sparkles } from 'lucide-react';
import BrandLogoSvg from '../svg/BrandLogoSvg';
import Companion from '../Companion';
import { t } from '../../lib/i18n';

/** Shared Olai lockup for the standalone sign-in and account pages. */
export function AuthBrand({ tagline = false }: { tagline?: boolean }) {
  return <a className="auth-brand" href="/" aria-label={t('小o 首页')}>
    <BrandLogoSvg size={34} />
    <span>
      Olai
      {tagline && <small>Online AI Companion</small>}
    </span>
  </a>;
}

/** Left-hand brand panel shown on wide screens. */
export function AuthShowcase() {
  const points = [
    { icon: <CloudUpload size={16} strokeWidth={1.8} />, text: t('游客记录自动同步到账号') },
    { icon: <Images size={16} strokeWidth={1.8} />, text: t('作品广场与个人库跨设备可见') },
    { icon: <Sparkles size={16} strokeWidth={1.8} />, text: t('每日额度与积分清晰可查') },
  ];
  return <aside className="auth-showcase">
    <AuthBrand tagline />
    <div className="auth-showcase-body">
      <p className="auth-kicker">Olai · Online AI Companion</p>
      <p className="auth-showcase-title">{t('让灵感，')}<br /><em>{t('在这里长大。')}</em></p>
      <p className="auth-showcase-copy">{t('对话、图像、视频与音乐，都在同一个温暖的创作空间里。登录后会同步你的游客记录，换一台设备也能继续。')}</p>
      <div className="auth-points">
        {points.map(point => <div className="auth-point" key={point.text}>
          <span className="auth-point-icon">{point.icon}</span>
          <span>{point.text}</span>
        </div>)}
      </div>
    </div>
    <div className="auth-mascot"><Companion size={248} animated /></div>
    <p className="auth-footline"><span>对话</span><span>图像</span><span>视频</span><span>音乐</span></p>
  </aside>;
}
