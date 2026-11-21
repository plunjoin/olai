/**
 * Shared-element motion for the gallery plaza. The clicked card's picture flies
 * to the detail panel (and back on close) as one fixed-position image, so the
 * masonry itself can reflow underneath without the animation jumping with it.
 */
export interface PlazaMotionSource {
  src: string;
  rect: DOMRect;
  radius?: string;
}

export interface PlazaMotionTarget {
  rect: DOMRect;
  radius?: string;
}

const EASE = 'cubic-bezier(0.22, 0.85, 0.25, 1)';

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function flyPlazaMedia(source: PlazaMotionSource, target: PlazaMotionTarget, duration = 520): Promise<void> {
  if (typeof document === 'undefined' || prefersReducedMotion()) return Promise.resolve();
  const from = source.rect;
  const to = target.rect;
  if (!source.src || !from?.width || !from.height || !to?.width || !to.height) return Promise.resolve();
  return new Promise(resolve => {
    const image = document.createElement('img');
    image.src = source.src;
    image.alt = '';
    image.draggable = false;
    image.setAttribute('aria-hidden', 'true');
    image.className = 'plaza-fly-media';
    image.style.cssText = [
      'position:fixed',
      `left:${from.left}px`,
      `top:${from.top}px`,
      `width:${from.width}px`,
      `height:${from.height}px`,
      'object-fit:cover',
      'object-position:center',
      `border-radius:${source.radius || '14px'}`,
      'z-index:220',
      'pointer-events:none',
      'box-shadow:0 28px 70px -30px rgba(20, 20, 38, 0.45)',
      'background:#f1f1f4',
      'will-change:left,top,width,height,border-radius',
    ].join(';');
    document.body.appendChild(image);
    const animation = image.animate([
      {
        left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`,
        borderRadius: source.radius || '14px',
      },
      {
        left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`,
        borderRadius: target.radius || '14px',
      },
    ], { duration, easing: EASE, fill: 'both' });
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      image.remove();
      resolve();
    };
    animation.onfinish = finish;
    animation.oncancel = finish;
    window.setTimeout(finish, duration + 150);
  });
}

/**
 * The largest rect with `ratio` that fits inside a padded container. Used to
 * land the flying picture on the exact area the contained detail image will
 * occupy, so handing the animation over is seamless.
 */
export function containedMediaRect(container: HTMLElement, ratio: number): DOMRect {
  const box = container.getBoundingClientRect();
  const style = getComputedStyle(container);
  const left = parseFloat(style.paddingLeft) || 0;
  const right = parseFloat(style.paddingRight) || 0;
  const top = parseFloat(style.paddingTop) || 0;
  const bottom = parseFloat(style.paddingBottom) || 0;
  const width = Math.max(0, box.width - left - right);
  const height = Math.max(0, box.height - top - bottom);
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 4 / 3;
  let mediaWidth = width;
  let mediaHeight = mediaWidth / safeRatio;
  if (mediaHeight > height) {
    mediaHeight = height;
    mediaWidth = mediaHeight * safeRatio;
  }
  return new DOMRect(
    box.left + left + (width - mediaWidth) / 2,
    box.top + top + (height - mediaHeight) / 2,
    mediaWidth,
    mediaHeight,
  );
}

/** Natural aspect ratio from stored pixel dimensions; 4:3 is a calm fallback. */
export function mediaRatio(width?: number, height?: number): number {
  if (width && height && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return width / height;
  }
  return 4 / 3;
}
