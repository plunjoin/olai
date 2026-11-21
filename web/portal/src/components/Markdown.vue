<template>
  <div class="markdown markdown-body" @click="onClick" v-html="html" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { convertAudioDataUriToPlayable } from '../lib/audio';
import { t } from '../lib/i18n';
import { play } from '../composables/player';

const props = defineProps<{ text: string }>();

marked.setOptions({ gfm: true, breaks: true });
marked.use({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      const language = lang || 'code';
      const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<div class="code-block-wrapper"><div class="code-block-header"><span>${language}</span><button type="button" class="copy-code-btn" data-code="${encodeURIComponent(text)}">${t('复制')}</button></div><pre><code class="language-${language}">${escaped}</code></pre></div>`;
    },
    image({ href, text, title }: { href: string; text?: string; title?: string | null }) {
      if (!href) return '';
      if (href.startsWith('data:audio/') || /\.(mp3|wav|ogg|aac|m4a|flac)($|\?)/i.test(href)) {
        const playable = convertAudioDataUriToPlayable(href);
        return `<div class="chat-audio-player"><div class="chat-audio-label">${t('🎵 生成音频')}</div><button type="button" class="chat-audio-play" data-audio-src="${encodeURIComponent(playable)}">${t('播放音频')}</button></div>`;
      }
      return `<img src="${href}" alt="${text || ''}" title="${title || ''}" class="chat-media-image" loading="lazy" />`;
    },
  },
});

const html = computed(() => DOMPurify.sanitize(marked.parse(props.text || '', { async: false }) as string, {
  FORBID_TAGS: ['video', 'audio', 'source', 'iframe', 'style', 'form', 'input'],
  FORBID_ATTR: ['style', 'onerror', 'onload'],
  ADD_TAGS: ['img'],
  ADD_ATTR: ['src', 'alt', 'title', 'loading', 'data-audio-src', 'data-code'],
  ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|data|blob):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
}));

function onClick(event: MouseEvent) {
  const target = event.target as HTMLElement;
  const audio = target.closest<HTMLElement>('.chat-audio-play');
  if (audio?.dataset.audioSrc) {
    const src = decodeURIComponent(audio.dataset.audioSrc);
    play({ id: `chat-audio-${src.slice(-24)}`, kind: 'audio', src, title: t('生成音频') });
    return;
  }
  const copy = target.closest<HTMLElement>('.copy-code-btn');
  if (!copy) return;
  const code = decodeURIComponent(copy.dataset.code || '');
  if (!code) return;
  void navigator.clipboard.writeText(code).then(() => {
    const original = copy.innerText;
    copy.innerText = t('已复制！');
    setTimeout(() => { copy.innerText = original; }, 1500);
  }).catch(() => { /* clipboard unavailable */ });
}
</script>
