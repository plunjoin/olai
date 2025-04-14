/** Small vector companion, drawn from the supplied Olai identity. */
import { useId } from 'react';
export default function BrandLogoSvg({ size = 36, className = '' }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  return <span className={`brand-logo-wrapper ${className}`} style={{ width: size, height: size }}>
    <svg viewBox="0 0 100 90" width={size} height={size} fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-body`} x1="68" y1="8" x2="30" y2="82" gradientUnits="userSpaceOnUse"><stop stopColor="#72BCFF" /><stop offset=".5" stopColor="#507CFF" /><stop offset="1" stopColor="#7162EF" /></linearGradient>
        <linearGradient id={`${id}-ring`} x1="10" y1="72" x2="89" y2="36" gradientUnits="userSpaceOnUse"><stop stopColor="#589FFF" /><stop offset="1" stopColor="#81DCFA" /></linearGradient>
      </defs>
      <ellipse cx="50" cy="54" rx="45" ry="16" transform="rotate(-23 50 54)" stroke={`url(#${id}-ring)`} strokeWidth="7" />
      <path d="M30 14C10 4 17-6 40 10C71 8 87 31 83 55C80 72 66 82 59 85C55 87 57 77 48 77C20 83 8 65 13 43C16 30 21 21 30 14Z" fill={`url(#${id}-body)`} />
      <ellipse cx="49" cy="43" rx="29" ry="21" transform="rotate(-17 49 43)" fill="#F5F8FF" />
      <rect x="35" y="37" width="7" height="12" rx="3.5" transform="rotate(-13 35 37)" fill="#202957" /><rect x="57" y="30" width="7" height="12" rx="3.5" transform="rotate(-13 57 30)" fill="#202957" />
      <path d="m29 51-2 4m6-5-2 4m40-15-2 4m6-5-2 4" stroke="#9EBBFF" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M8 60C-2 85 53 73 81 56C94 48 97 39 89 35" stroke={`url(#${id}-ring)`} strokeWidth="7" strokeLinecap="round" />
      <path d="M86 5C88 13 90 15 96 18C90 20 88 23 86 30C84 23 82 20 76 18C82 15 84 13 86 5Z" fill="#779CFF" />
    </svg>
  </span>;
}
