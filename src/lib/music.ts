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
export function songPrompt(song: SongDraft): string {
  return [`Title: ${song.title || '未命名歌曲'}`, `Style: ${song.style || '自由创作'}`, song.instrumental ? 'Instrumental only. No vocals.' : 'Create a complete song. Sing the lyrics exactly as written.', ...song.sections.map(s => `[${s.type}]\n${s.direction ? `Direction: ${s.direction}\n` : ''}${song.instrumental ? '(instrumental)' : s.lyrics}`)].join('\n\n');
}
export function songLyrics(song: SongDraft): string {
  if (song.instrumental) return '';
  return song.sections.filter(s => s.lyrics.trim()).map(s => `[${s.type}]\n${s.lyrics.trim()}`).join('\n\n');
}
export function sungLines(song: SongDraft): string {
  return song.instrumental ? '' : song.sections.map(s => s.lyrics.trim()).filter(Boolean).join('\n');
}
export async function composeSong(key: string, model: string, inspiration: string, style: string, instrumental: boolean): Promise<SongDraft> {
  const response = await request('chat/completions', key, { method: 'POST', signal: AbortSignal.timeout(120000), body: JSON.stringify({
    model, stream: false, messages: [
      { role: 'system', content: '你是专业作词和编曲助手。将灵感整理为可编辑的完整歌曲。只返回 JSON: {"title":"歌曲名","style":"流派、节奏、乐器、人声和氛围","instrumental":false,"sections":[{"type":"intro|verse|chorus|bridge|outro","direction":"该段编曲说明","lyrics":"该段实际歌词，换行分句"}]}。按音乐逻辑安排段落，可重复 verse/chorus。保留用户已给出的歌词，不要把编曲说明混入歌词。用户明确要求无人声时 instrumental=true 且所有 lyrics 为空。否则根据主题写歌词，语言跟随用户。至少包含 intro, verse, chorus, bridge, outro。' },
      { role: 'user', content: `${inspiration}\n风格偏好：${style || '根据灵感选择'}\n${instrumental ? '必须为纯音乐，不要歌词。' : '遵循灵感中的人声偏好。'}` },
    ],
  }) });
  const result = await response.json();
  const content = result.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('未收到歌曲整理结果，请重试。');
  return parseSong(content);
}
