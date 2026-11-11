import type { SongDraft } from '../types';
export function songPrompt(song: SongDraft): string {
  return [`Title: ${song.title || '未命名歌曲'}`, `Style: ${song.style || '自由创作'}`, song.instrumental ? 'Instrumental only. No vocals.' : 'Create a complete song. Sing the lyrics exactly as written.', ...song.sections.map(s => `[${s.type}]\n${s.direction ? `Direction: ${s.direction}\n` : ''}${song.instrumental ? '(instrumental)' : s.lyrics}`)].join('\n\n');
}
