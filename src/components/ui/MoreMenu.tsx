import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
type Item = { label: string; icon: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean };
export default function MoreMenu({ label = '更多操作', items, triggerIcon, className = '', disabled = false }: { label?: string; items: Item[]; triggerIcon?: ReactNode; className?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const dismiss = (restore = false) => { setOpen(false); if (restore) trigger.current?.focus(); };
  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const height = menu.current.offsetHeight;
    setPosition({ left: Math.max(8, Math.min(rect.right - 176, window.innerWidth - 184)), top: rect.bottom + height + 12 > window.innerHeight ? Math.max(8, rect.top - height - 6) : rect.bottom + 6 });
    menu.current.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!menu.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) dismiss(); };
    const reposition = (e: Event) => { if (!menu.current?.contains(e.target as Node)) dismiss(); };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', reposition); window.addEventListener('scroll', reposition, true);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true); };
  }, [open]);
  return <><button ref={trigger} type="button" className={`icon-button more-trigger ${className} ${open ? 'is-open' : ''}`} disabled={disabled} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}>{triggerIcon || <MoreHorizontal size={18} />}</button>
    {open && createPortal(<div ref={menu} id={id} className="more-menu" role="menu" aria-label={label} style={position} onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); dismiss(true); }
      if (e.key === 'Tab') { e.preventDefault(); dismiss(true); }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]; const index = buttons.indexOf(document.activeElement as HTMLButtonElement); const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length; buttons[next]?.focus(); }
    }}>{items.map(item => <button type="button" role="menuitem" key={item.label} disabled={item.disabled} className={item.danger ? 'is-danger' : ''} onClick={() => { dismiss(true); item.onClick(); }}>{item.icon}<span>{item.label}</span></button>)}</div>, document.body)}
  </>;
}
