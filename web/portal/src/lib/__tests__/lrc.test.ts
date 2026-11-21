import { describe, expect, it } from 'vitest';
import {
  buildLrcFromLines, formatLrcClock, parseLRC, parseLrcMetadata, parseLrcTimeInput,
} from '../lrc';

describe('portal LRC parsing', () => {
  it('accepts 1–3 digit minutes and 0–3 digit fractions', () => {
    const lines = parseLRC([
      '[0:02.5]第一句',
      '[00:10.25]第二句',
      '[00:20.123]第三句',
      '[00:40]第四句',
    ].join('\n'));

    expect(lines.map(line => line.time)).toEqual([2.5, 10.25, 20.123, 40]);
    expect(lines.map(line => line.text)).toEqual(['第一句', '第二句', '第三句', '第四句']);
  });

  it('expands multiple time tags on one line and sorts by time', () => {
    const lines = parseLRC('[00:30.00][00:10.00]副歌');
    expect(lines).toEqual([
      { time: 10, text: '副歌' },
      { time: 30, text: '副歌' },
    ]);
  });

  it('extracts metadata and ignores timed lines', () => {
    const meta = parseLrcMetadata([
      '[ti:测试歌曲]',
      '[ar:测试歌手]',
      '[al:测试专辑]',
      '[by:Olai AI]',
      '[custom:keep-me]',
      '[00:12.50]第一句',
    ].join('\n'));

    expect(meta).toEqual({
      ti: '测试歌曲', ar: '测试歌手', al: '测试专辑', by: 'Olai AI', custom: 'keep-me',
    });
  });

  it('parses typed times as clock or raw seconds', () => {
    expect(parseLrcTimeInput('01:23.45')).toBe(83.45);
    expect(parseLrcTimeInput('1:23.5')).toBe(83.5);
    expect(parseLrcTimeInput('83.45')).toBe(83.45);
    expect(parseLrcTimeInput('00:75')).toBeNull();
    expect(parseLrcTimeInput('abc')).toBeNull();
    expect(parseLrcTimeInput('')).toBeNull();
  });
});

describe('portal LRC serialization', () => {
  it('keeps original metadata, orders standard tags, and drops offset', () => {
    const lrc = buildLrcFromLines(
      [{ time: 12.5, text: '第二句' }, { time: 2.5, text: '第一句' }],
      {
        title: '新标题',
        meta: {
          ti: '旧标题', ar: '测试歌手', al: '测试专辑', by: 'Olai AI', custom: 'keep-me', offset: '500',
        },
      },
    );

    expect(lrc.split('\n')).toEqual([
      '[ti:新标题]',
      '[ar:测试歌手]',
      '[al:测试专辑]',
      '[by:Olai AI]',
      '[custom:keep-me]',
      '[00:02.50] 第一句',
      '[00:12.50] 第二句',
    ]);
  });

  it('drops empty lines and keeps equal-time order stable', () => {
    const lrc = buildLrcFromLines([
      { time: 5, text: '先' },
      { time: 5, text: '后' },
      { time: 9, text: '   ' },
    ]);

    expect(lrc.split('\n').slice(1)).toEqual(['[00:05.00] 先', '[00:05.00] 后']);
  });

  it('exposes a bracket-free clock for the editor', () => {
    expect(formatLrcClock(20.123)).toBe('00:20.12');
    expect(formatLrcClock(65.5)).toBe('01:05.50');
  });
});
