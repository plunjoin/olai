/**
 * Shared body scroll lock for stacked overlays (work detail, audio stage,
 * video theater). Reference-counted so closing one overlay never unlocks the
 * page while another is still open, and never leaves it locked when all close.
 */
let locks = 0;
let previousOverflow = '';

export function lockBodyScroll(): () => void {
  if (typeof document === 'undefined') return () => {};
  if (locks === 0) previousOverflow = document.body.style.overflow;
  locks += 1;
  document.body.style.overflow = 'hidden';
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks = Math.max(0, locks - 1);
    if (locks === 0) document.body.style.overflow = previousOverflow;
  };
}
