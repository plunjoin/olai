import { afterEach, describe, expect, it, vi } from 'vitest';
import { alignLyricsToAudio, alignmentToLrc } from '../lyricAlignment';
import { generateLrcFromPrompt, parseLRC } from '../lrc';
import { DEFAULT_SETTINGS, type Asset } from '../types';

afterEach(() => vi.unstubAllGlobals());
const alignment = { lines: [{ index: 0, start: 3, end: 5 }, { index: 1, start: 8, end: 10 }, { index: 2, start: 14, end: 15 }] };
describe('alignment against actual audio', () => {
  it('retains repeated lyrics and silence between lines instead of uniform timing', () => {
    const result = parseLRC(alignmentToLrc(JSON.stringify(alignment), '星光\n晚风\n星光', 20, '星空'));
    expect(result).toEqual([{ time: 3, text: '星光' }, { time: 5, text: '' }, { time: 8, text: '晚风' }, { time: 10, text: '' }, { time: 14, text: '星光' }, { time: 15, text: '' }]);
  });
  it.each([
    'invalid', '{"lines":[]}',
    JSON.stringify({ lines: [{ index: 0, start: 3, end: 21 }] }),
    JSON.stringify({ lines: [{ index: 0, start: -1, end: 2 }] }),
    JSON.stringify({ lines: [{ index: 0, start: '3', end: 5 }] }),
    JSON.stringify({ lines: [{ index: 1, start: 3, end: 5 }] }),
    JSON.stringify({ lines: [{ index: 0, start: 3, end: 2 }] }),
    JSON.stringify({ lines: [{ index: 0, start: 3, end: 5 }, { index: 1, start: 4, end: 6 }] }),
  ])('rejects incomplete, out of range or overlapping output: %s', content => {
    expect(() => alignmentToLrc(content, content.includes('"index":1,"start":4') ? '星光\n晚风' : '星光', 20, '歌')).toThrow();
  });
  it('sends audio bytes and numbered lyrics to the configured text engine', async () => {
    vi.stubGlobal('AudioContext', class {
      async decodeAudioData() { return { duration: 20, sampleRate: 16000, numberOfChannels: 1, length: 320000, getChannelData: () => new Float32Array(320000) }; }
      async close() {}
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(alignment) } }] })));
    vi.stubGlobal('fetch', fetchMock);
    const asset: Asset = { id: 'song', kind: 'music', prompt: 'a story', options: {}, model: DEFAULT_SETTINGS.musicModel, createdAt: 0, status: 'completed', blob: new Blob(['original audio']), lyrics: '星光\n晚风\n星光' };
    const result = await alignLyricsToAudio(asset, 'key', DEFAULT_SETTINGS.chatModel, new AbortController().signal);
    expect(result.duration).toBe(20);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('gemini-3.5-flash');
    expect(body.messages[1].content[0].text).toContain('0: 星光\n1: 晚风\n2: 星光');
    expect(body.messages[1].content[1].input_audio.format).toBe('wav');
    expect(atob(body.messages[1].content[1].input_audio.data).slice(0, 4)).toBe('RIFF');
    expect(parseLRC(result.lrc)[0].time).toBe(3);
  });
  it('does not attempt alignment for instrumental songs', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(alignLyricsToAudio({ song: { instrumental: true }, lyrics: 'ignored' } as Asset, '', '', new AbortController().signal)).rejects.toThrow('纯音乐');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('keeps estimates within short clips too', () => {
    expect(parseLRC(generateLrcFromPrompt('一\n二\n三', .5)).every(line => line.time >= 0 && line.time < .5)).toBe(true);
  });
});
