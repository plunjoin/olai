import { ArrowDown, ArrowRight, ArrowUpRight, Sparkles, WandSparkles, Clock3 } from 'lucide-react';
import Artwork from './Artwork';
import type { Asset, Conversation, MediaKind, View } from '../lib/types';
import {
  ChatAgentSvg,
  ImageSynthesisSvg,
  VideoMotionSvg,
  AudioWaveSvg,
} from './svg/AnimatedIcons';

const inspirations: { kind: MediaKind; tag: string; title: string; description: string; prompt: string }[] = [
  {
    kind: 'image',
    tag: '图像灵感',
    title: '让不可能，有形状',
    description: '用色彩、光影和一点天马行空',
    prompt:
      '极简超现实主义建筑，奶油色拱门与悬浮的珊瑚橙球体，浅蓝天空，柔和自然光，精致 3D 渲染，艺术杂志封面，无文字',
  },
  {
    kind: 'video',
    tag: '动态灵感',
    title: '给世界，按下播放',
    description: '让脑海中的画面缓缓展开',
    prompt:
      '电影感航拍，镜头缓缓穿越紫色山脉，远处一轮暖橙色太阳升起，薄雾流动，宁静梦幻，平滑镜头，无文字',
  },
  {
    kind: 'music',
    tag: '声音灵感',
    title: '把心情，谱成旋律',
    description: '一段只属于此刻的声音',
    prompt:
      '温暖的 lo-fi 器乐，轻柔钢琴、爵士吉他和细腻黑胶噪声，适合雨天阅读，舒缓节拍，无人声',
  },
];

export default function Home({
  onNavigate,
  onPrompt,
  assets,
  conversations,
  onOpenConversation,
}: {
  onNavigate: (view: View) => void;
  onPrompt: (kind: MediaKind, prompt: string) => void;
  assets: Asset[];
  conversations: Conversation[];
  onOpenConversation: (id: string) => void;
}) {
  const tools = [
    {
      view: 'chat' as const,
      iconComponent: ChatAgentSvg,
      title: '聊一聊',
      text: '聊聊日常，也一起想个好点子。',
      color: 'violet',
      badge: '随时畅聊',
    },
    {
      view: 'image' as const,
      iconComponent: ImageSynthesisSvg,
      title: '画出想象',
      text: '把脑海中的画面，变成看得见的美好。',
      color: 'blue',
      badge: '多比例 · 4K',
    },
    {
      view: 'video' as const,
      iconComponent: VideoMotionSvg,
      title: '让故事动起来',
      text: '从一个镜头开始，让想象流动。',
      color: 'blue',
      badge: '4 / 6 / 8 秒',
    },
    {
      view: 'music' as const,
      iconComponent: AudioWaveSvg,
      title: '听见灵感',
      text: '为此刻的心情，写一段专属旋律。',
      color: 'violet',
      badge: '原创歌曲',
    },
  ];

  return (
    <div className="home-page">
      <div className="page-intro">
        <div>
          <div className="eyebrow">
            <span className="tiny-dot" /> YOUR LITTLE CREATIVE UNIVERSE
          </div>
          <h1>
            灵感，从这里发生<span className="heading-spark">✦</span>
          </h1>
          <p>欢迎回到 Olai，今天想一起创造什么？</p>
        </div>
        <span className="intro-date">
          {new Date().toLocaleDateString('zh-CN', {
            month: 'long',
            day: 'numeric',
            weekday: 'long',
            timeZone: 'Asia/Shanghai',
          })}
        </span>
      </div>

      {/* 现代极简 Hero 区域与动态矢量星系 */}
      <section className="hero">
        <div className="hero-content">
          <span className="hero-label">
            <Sparkles size={13} /> ONLINE AI COMPANION
          </span>
          <h2>
            你的想象，
            <br />
            都有<span>一个伙伴。</span>
          </h2>
          <p>
            嗨，我是 Olai。陪你聊生活，也陪你创造。
            <br />
            把一个小小的念头，变成画面、故事与旋律。
          </p>
          <div className="hero-buttons"><button onClick={() => onNavigate('chat')} className="lime-button">和 Olai 聊聊<ArrowRight size={17} /></button><button className="hero-secondary" onClick={() => onNavigate('image')}>开始创作<ArrowUpRight size={16} /></button></div>
          <div className="hero-footnote">
            <span /> 随时在线，让每一个灵感都有回应
          </div>
        </div>
        <Artwork variant="orbit" />
      </section>

      {/* 创作工具箱 */}
      <div className="section-heading">
        <h2>
          从这里开始<span>一点好奇，无限可能</span>
        </h2>
        <span className="section-note">
          为灵感选择一种表达 <ArrowDown size={14} />
        </span>
      </div>

      <section className="tool-grid">
        {tools.map(({ view, iconComponent: IconSvg, title, text, color, badge }) => (
          <button
            key={view}
            className="tool-card group"
            onClick={() => onNavigate(view)}
          >
            <div className="tool-card-top">
              <span className={`tool-icon ${color}`}>
                <IconSvg size={26} active={true} />
              </span>
              {badge && <span className="tool-badge">{badge}</span>}
              <ArrowUpRight className="tool-arrow" size={18} />
            </div>
            <h3>{title}</h3>
            <p>{text}</p>
            <span className="tool-action">
              开始创作 <ArrowRight size={13} />
            </span>
          </button>
        ))}
      </section>

      {/* 灵感火花卡片 */}
      <div className="section-heading inspiration-heading">
        <h2>
          灵感补给站<span>不知道从哪开始？试试这些</span>
        </h2>
        <span className="section-note">
          <WandSparkles size={14} /> 点击灵感，试着创作
        </span>
      </div>

      <section className="inspiration-grid">
        {inspirations.map(item => (
          <button
            key={item.kind}
            className="inspiration-card"
            onClick={() => onPrompt(item.kind, item.prompt)}
          >
            <Artwork variant={item.kind} />
            <div className="inspiration-text">
              <span>{item.tag}</span>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              <span className="inspiration-arrow">
                <ArrowUpRight size={18} />
              </span>
            </div>
          </button>
        ))}
      </section>

      {/* 数据存档条 */}
      <section className="workspace-strip">
        <span className="strip-icon">
          <Clock3 size={21} />
        </span>
        <div>
          <h3>每一步灵感，都值得留下</h3>
          <p>
            {conversations.length || assets.length
              ? `已安全保存 ${conversations.length} 个会话与 ${
                  assets.filter(a => a.status === 'completed').length
                } 件作品。继续上一次探索，或开始新的创作。`
              : '会话与作品自动保存在当前浏览器，下次回来，接着创作。'}
          </p>
        </div>
        <button
          className="text-button"
          onClick={() =>
            conversations.length ? onOpenConversation(conversations[0].id) : onNavigate('library')
          }
        >
          {conversations.length ? '继续最近会话' : '我的作品'}
          <ArrowRight size={16} />
        </button>
      </section>

      <footer className="page-footer">
        <span>olai · 让灵感有个伴</span>
        <span>ONLINE AI COMPANION <span className="footer-star">✦</span></span>
      </footer>
    </div>
  );
}
