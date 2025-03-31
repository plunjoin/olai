import { AudioLines, Boxes, Cpu, Image, LayoutGrid, MessageCircle, RefreshCw, Video } from 'lucide-react';
type IconProps = { size?: number; active?: boolean };
const props = ({ size = 20, active = false }: IconProps) => ({ size, strokeWidth: active ? 1.9 : 1.7, 'aria-hidden': true as const, className: 'custom-svg-icon' });
export function StudioDashboardSvg(p: IconProps) { return <LayoutGrid {...props(p)} />; }
export function ChatAgentSvg(p: IconProps) { return <MessageCircle {...props(p)} />; }
export function ImageSynthesisSvg(p: IconProps) { return <Image {...props(p)} />; }
export function VideoMotionSvg(p: IconProps) { return <Video {...props(p)} />; }
export function AudioWaveSvg(p: IconProps) { return <AudioLines {...props(p)} />; }
export function CosmicVaultSvg(p: IconProps) { return <Boxes {...props(p)} />; }
export function ModelChipSvg({ size = 16, className = '' }: { size?: number; className?: string }) { return <Cpu size={size} strokeWidth={1.7} aria-hidden="true" className={className} />; }
export function AnimatedRefreshSvg({ size = 15, spinning = false }: { size?: number; spinning?: boolean }) { return <RefreshCw size={size} strokeWidth={1.7} aria-hidden="true" className={spinning ? 'spin' : ''} />; }
