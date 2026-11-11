import { request } from './api';
import type { SongDraft, SongSectionType } from './types';

export const SECTION_TYPES: SongSectionType[] = ['intro', 'verse', 'chorus', 'bridge', 'outro'];
export const SECTION_LABELS = { intro: '前奏', verse: '主歌', chorus: '副歌', bridge: '桥段', outro: '尾奏' };
export function newSong(): SongDraft {
  return { title: '', style: '', instrumental: false, sections: SECTION_TYPES.map((type, i) => ({ id: `section-${i}`, type, direction: '', lyrics: '' })) };
}
export function parseSong(text: string): SongDraft {
  let value: any;
  try { value = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
  catch { throw new Error('歌曲整理结果格式不完整，请重试。'); }
  if (!value || typeof value.title !== 'string' || typeof value.style !== 'string' || typeof value.instrumental !== 'boolean' || !Array.isArray(value.sections) || !value.sections.length || value.sections.length > 30) throw new Error('歌曲整理结果缺少有效段落，请重试。');
  const sections = value.sections.map((s: any, i: number) => {
    if (!s || !SECTION_TYPES.includes(s.type) || typeof s.direction !== 'string' || typeof s.lyrics !== 'string') throw new Error('歌曲段落格式不正确，请重试。');
    return { id: `section-${i}`, type: s.type, direction: s.direction.slice(0, 2000), lyrics: value.instrumental ? '' : s.lyrics.slice(0, 6000) };
  });
  return { title: value.title.slice(0, 100), style: value.style.slice(0, 2000), instrumental: value.instrumental, sections };
}
export function songLyrics(song: SongDraft): string {
  if (song.instrumental) return '';
  return song.sections.filter(s => s.lyrics.trim()).map(s => `[${s.type}]\n${s.lyrics.trim()}`).join('\n\n');
}
export function sungLines(song: SongDraft): string {
  return song.instrumental ? '' : song.sections.map(s => s.lyrics.trim()).filter(Boolean).join('\n');
}
export async function composeSong(inspiration: string, style: string, instrumental: boolean): Promise<SongDraft> {
  const response = await request('chat/completions', { method: 'POST', signal: AbortSignal.timeout(120000), body: JSON.stringify({ action: 'compose-song', inspiration, style, instrumental }) });
  const result = await response.json();
  const content = result.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('未收到歌曲整理结果，请重试。');
  return parseSong(content);
}
