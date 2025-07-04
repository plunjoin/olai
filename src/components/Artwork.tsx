import HeroArtSvg from './svg/HeroArtSvg';
import CreationCanvasSvg from './svg/CreationCanvasSvg';

export default function Artwork({
  variant = 'orbit',
  className = '',
}: {
  variant?: string;
  className?: string;
}) {
  if (variant === 'orbit') {
    return <HeroArtSvg className={className} />;
  }

  if (variant === 'music') {
    return <CreationCanvasSvg kind="music" className={className} />;
  }

  if (variant === 'video') {
    return <CreationCanvasSvg kind="video" className={className} />;
  }

  return <CreationCanvasSvg kind="image" className={className} />;
}
