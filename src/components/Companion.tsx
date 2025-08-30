import { useEffect, useRef, useState } from 'react';

export default function Companion({ size = 140, className = '', animated = false, interactive = false }: { size?: number; className?: string; animated?: boolean; interactive?: boolean }) {
  const wrapper = useRef<HTMLSpanElement>(null);
  const gaze = useRef<SVGGElement>(null);
  const [blinking, setBlinking] = useState(false);
  useEffect(() => {
    if (!interactive) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const pointer = window.matchMedia('(pointer: fine)');
    let frame = 0;
    let blinkTimer: ReturnType<typeof setTimeout>;
    let openTimer: ReturnType<typeof setTimeout>;
    let target = { x: 0, y: 0 }, current = { x: 0, y: 0 };
    const reset = () => { target = { x: 0, y: 0 }; if (!frame && !motion.matches && !document.hidden) frame = requestAnimationFrame(tick); };
    const move = (event: PointerEvent) => {
      if (!pointer.matches || motion.matches || event.pointerType === 'touch' || document.querySelector('dialog[open]')) return;
      const rect = wrapper.current?.getBoundingClientRect();
      if (!rect) return;
      target = { x: Math.max(-12, Math.min(12, (event.clientX - rect.left - rect.width / 2) / innerWidth * 30)), y: Math.max(-9, Math.min(9, (event.clientY - rect.top - rect.height / 2) / innerHeight * 23)) };
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const tick = () => {
      current.x += (target.x - current.x) * .12;
      current.y += (target.y - current.y) * .12;
      gaze.current?.setAttribute('transform', `translate(${current.x.toFixed(2)} ${current.y.toFixed(2)})`);
      frame = Math.abs(target.x - current.x) + Math.abs(target.y - current.y) > .02 ? requestAnimationFrame(tick) : 0;
    };
    const blink = () => {
      blinkTimer = setTimeout(() => {
        if (!document.hidden) { setBlinking(true); openTimer = setTimeout(() => setBlinking(false), 150); }
        blink();
      }, 2800 + Math.random() * 3500);
    };
    const configure = () => {
      cancelAnimationFrame(frame); clearTimeout(blinkTimer); clearTimeout(openTimer);
      frame = 0; target = { x: 0, y: 0 }; current = { x: 0, y: 0 }; setBlinking(false); gaze.current?.setAttribute('transform', 'translate(0 0)');
      if (!motion.matches && !document.hidden) blink();
    };
    configure();
    window.addEventListener('pointermove', move, { passive: true });
    document.documentElement.addEventListener('pointerleave', reset);
    window.addEventListener('blur', reset);
    motion.addEventListener('change', configure);
    pointer.addEventListener('change', configure);
    document.addEventListener('visibilitychange', configure);
    return () => { cancelAnimationFrame(frame); clearTimeout(blinkTimer); clearTimeout(openTimer); window.removeEventListener('pointermove', move); document.documentElement.removeEventListener('pointerleave', reset); window.removeEventListener('blur', reset); motion.removeEventListener('change', configure); pointer.removeEventListener('change', configure); document.removeEventListener('visibilitychange', configure); };
  }, [interactive]);
  if (!interactive) return <img src="/brand/olai-mascot.png" alt="" aria-hidden="true" width={590} height={500} className={`companion ${animated ? 'companion-float' : ''} ${className}`} style={{ width: size }} draggable={false} />;
  return <span ref={wrapper} className={`companion companion-interactive ${animated ? 'companion-float' : ''} ${className}`} style={{ width: size }} role="img" aria-label="小o，你的灵感伙伴">
    <img src="/brand/xiao-o-idle.png" alt="" width={590} height={500} draggable={false} />
    <svg viewBox="0 0 590 500" className="companion-face" aria-hidden="true"><g ref={gaze} className="companion-gaze">
      {[{ x: 249.5, y: 253 }, { x: 371.5, y: 222 }].map(({ x, y }) => <g key={x} transform={`translate(${x} ${y}) rotate(-13)`}><g className={`companion-eye ${blinking ? 'is-blinking' : ''}`}><rect x="-19" y="-31" width="38" height="62" rx="19" fill="#202957" /></g></g>)}
    </g></svg>
  </span>;
}
