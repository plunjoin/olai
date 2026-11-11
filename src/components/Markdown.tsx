import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { convertAudioDataUriToPlayable } from '../lib/audio';
import { usePlayer } from '../lib/playerContext';

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
      return `<div class="chat-audio-player"><div class="chat-audio-label">🎵 生成音频</div><button type="button" class="chat-audio-play" data-audio-src="${encodeURIComponent(playable)}">播放音频</button></div>`;
    }
    return `<img src="${href}" alt="${text || ''}" title="${title || ''}" class="chat-media-image" loading="lazy" />`;
  }
};

marked.use({ renderer });

export default function Markdown({ text }: { text: string }) {
  const { play } = usePlayer();
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false, breaks: true }) as string, {
    FORBID_TAGS: ['video', 'audio', 'source', 'iframe', 'style', 'form', 'input'],
    FORBID_ATTR: ['style'],
    ADD_TAGS: ['img'],
    ADD_ATTR: ['src', 'alt', 'title', 'loading', 'data-audio-src'],
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|data|blob):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  }), [text]);

  const handleClick = (e: React.MouseEvent) => {
    const audio = (e.target as HTMLElement).closest<HTMLElement>('.chat-audio-play');
    if (audio?.dataset.audioSrc) {
      const src = decodeURIComponent(audio.dataset.audioSrc);
      play({ id: `chat-audio-${src.slice(-24)}`, kind: 'audio', src, title: '生成音频' });
      return;
    }
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
