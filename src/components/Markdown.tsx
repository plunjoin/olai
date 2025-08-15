import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { convertAudioDataUriToPlayable } from '../lib/audio';

const renderer = {
  code({ text, lang }: { text: string; lang?: string }) {
    const l = lang || 'code';
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<div class="code-block-wrapper"><div class="code-block-header"><span>${l}</span><button type="button" class="copy-code-btn" data-code="${encodeURIComponent(text)}">复制</button></div><pre><code class="language-${l}">${escaped}</code></pre></div>`;
  },
  image({ href, text, title }: { href: string; text?: string; title?: string | null }) {
    if (!href) return '';
    if (href.startsWith('data:audio/') || /\.(mp3|wav|ogg|aac|m4a|flac)($|\?)/i.test(href)) {
      const playable = convertAudioDataUriToPlayable(href);
      return `<div class="chat-audio-player"><div class="chat-audio-label">🎵 生成音频</div><audio controls preload="metadata" src="${playable}"></audio></div>`;
    }
    return `<img src="${href}" alt="${text || ''}" title="${title || ''}" class="chat-media-image" loading="lazy" />`;
  }
};

marked.use({ renderer });

export default function Markdown({ text }: { text: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false, breaks: true }) as string, {
    FORBID_TAGS: ['video', 'iframe', 'style', 'form', 'input'],
    FORBID_ATTR: ['style'],
    ADD_TAGS: ['img', 'audio', 'source'],
    ADD_ATTR: ['src', 'alt', 'title', 'loading', 'controls', 'preload'],
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|data|blob):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  }), [text]);

  const handleClick = (e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest('.copy-code-btn') as HTMLElement;
    if (!target) return;
    const code = decodeURIComponent(target.dataset.code || '');
    if (code) {
      void navigator.clipboard.writeText(code);
      const original = target.innerText;
      target.innerText = '已复制！';
      setTimeout(() => { target.innerText = original; }, 1500);
    }
  };

  return <div className="markdown" onClick={handleClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
