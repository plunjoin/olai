import { AudioLines, Image, Sparkles } from 'lucide-react';
import Companion from '../Companion';
export default function HeroArtSvg({ className = '' }: { className?: string }) {
  return <div className={`hero-art-wrapper ${className}`} aria-hidden="true">
    <div className="hero-orbit hero-orbit-one" /><div className="hero-orbit hero-orbit-two" />
    <span className="hero-star star-a"><Sparkles size={22} /></span>
    <Companion size={310} animated />
    <span className="floating-note note-hello">Hi，我是小o <span>✦</span></span>
    <span className="floating-note note-image"><Image size={16} />让想象有形状</span>
    <span className="floating-note note-music"><AudioLines size={17} />灵感，正在发生</span>
    <span className="mascot-shadow" />
  </div>;
}
