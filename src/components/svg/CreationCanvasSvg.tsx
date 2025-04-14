import { useId } from 'react';
export default function CreationCanvasSvg({ kind = 'image', className = '' }: { kind?: 'image' | 'video' | 'music'; className?: string }) {
  const id = useId().replace(/:/g, '');
  return <div className={`creation-svg-art ${kind}-art ${className}`} aria-hidden="true">
    <svg viewBox="0 0 360 200" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id={id} x1="85" y1="35" x2="270" y2="175" gradientUnits="userSpaceOnUse"><stop stopColor="#81C4FF" /><stop offset="1" stopColor="#7980EE" /></linearGradient></defs>
      <ellipse cx="180" cy="170" rx="92" ry="8" fill="#5E74C9" opacity=".08" />
      <circle cx="180" cy="100" r="76" stroke="#C5D4F5" strokeDasharray="3 8" />
      {kind === 'image' ? <g transform="rotate(-6 180 100)"><rect x="108" y="35" width="145" height="128" rx="14" fill="white" stroke="#CBD9F3" strokeWidth="1.5" /><rect x="118" y="45" width="125" height="100" rx="8" fill="#EAF2FF" /><circle cx="212" cy="72" r="15" fill="#B4CDFF" /><path d="m118 132 42-49 28 31 22-21 33 39v13H118Z" fill={`url(#${id})`} /><path d="M163 154h35" stroke="#C0CEEB" strokeWidth="3" strokeLinecap="round" /></g> : kind === 'video' ? <g transform="rotate(-5 180 100)"><rect x="89" y="49" width="182" height="113" rx="15" fill="white" stroke="#CBD9F3" strokeWidth="1.5" /><rect x="99" y="59" width="162" height="92" rx="8" fill="#EAF2FF" /><path d="m170 88 29 18-29 18Z" fill={`url(#${id})`} /><path d="m121 35 135-12 3 26-135 12Z" fill={`url(#${id})`} /><path d="m142 34 16 19m17-22 16 19m17-22 16 19" stroke="#FFF" strokeWidth="8" opacity=".65" /></g> : <g><circle cx="180" cy="99" r="65" fill="#F5F7FF" stroke="#CCD8F4" /><circle cx="180" cy="99" r="53" stroke="#DBE3F8" /><circle cx="180" cy="99" r="42" stroke="#DBE3F8" /><circle cx="180" cy="99" r="26" fill={`url(#${id})`} /><circle cx="180" cy="99" r="5" fill="white" /><path d="M255 50v53m0-47 22-5v46" stroke="#7186DE" strokeWidth="4" strokeLinecap="round" /><ellipse cx="248" cy="104" rx="9" ry="6" fill="#7186DE" /><ellipse cx="270" cy="98" rx="9" ry="6" fill="#7186DE" /></g>}
      <path d="M77 71v12m-6-6h12m203 57v10m-5-5h10" stroke="#9CAFF0" strokeWidth="2" strokeLinecap="round" />
      <circle cx="286" cy="49" r="3" fill="#AFCBFB" /><circle cx="74" cy="139" r="3" fill="#AFCBFB" />
    </svg>
  </div>;
}
