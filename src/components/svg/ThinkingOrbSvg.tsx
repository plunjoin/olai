import BrandLogoSvg from './BrandLogoSvg';
export default function ThinkingOrbSvg({ size = 28, label = '小o 正在思考…' }: { size?: number; label?: string }) {
  return <div className="thinking-orb-container" role="status"><BrandLogoSvg size={size} /><span className="thinking-orb-label">{label}</span><span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span></div>;
}
