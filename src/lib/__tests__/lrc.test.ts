import { describe, expect, it } from 'vitest';
import { formatLrcTimestamp, generateLrcFromPrompt, parseLRC } from '../lrc';

describe('LRC lyrics parser and generator', () => {
  it('formats seconds to standard [mm:ss.xx] timestamp', () => {
    expect(formatLrcTimestamp(0)).toBe('[00:00.00]');
    expect(formatLrcTimestamp(12.5)).toBe('[00:12.50]');
    expect(formatLrcTimestamp(65.05)).toBe('[01:05.05]');
    expect(formatLrcTimestamp(125.8)).toBe('[02:05.80]');
  });

  it('parses standard LRC text into structured timeline', () => {
    const lrcContent = `
[ti:测试曲目]
[ar:歌手名]
[00:03.50] 第一句歌词：晨曦的光
[00:08.20] 第二句歌词：穿透了森林
[00:15.00] 结尾：万物苏醒
    `.trim();

    const result = parseLRC(lrcContent);
    expect(result).toHaveLength(3);
    expect(result[0].time).toBe(3.5);
    expect(result[0].text).toBe('第一句歌词：晨曦的光');
    expect(result[1].time).toBe(8.2);
    expect(result[1].text).toBe('第二句歌词：穿透了森林');
    expect(result[2].time).toBe(15.0);
    expect(result[2].text).toBe('结尾：万物苏醒');
  });

  it('handles multi-timestamp format on a single line', () => {
    const lrcContent = `[00:01.00][00:05.00] 重复副歌旋律`;
    const result = parseLRC(lrcContent);

    expect(result).toHaveLength(2);
    expect(result[0].time).toBe(1.0);
    expect(result[0].text).toBe('重复副歌旋律');
    expect(result[1].time).toBe(5.0);
    expect(result[1].text).toBe('重复副歌旋律');
  });

  it('intelligently generates LRC from multi-line lyrics and audio duration', () => {
    const prompt = `
风格：Lo-fi 爵士
雨滴落在寂静的窗台
咖啡散发温暖的香气
微风吹拂着记忆的花海
    `.trim();

    const lrc = generateLrcFromPrompt(prompt, 30, '雨天Lo-fi');
    expect(lrc).toContain('[ti:雨天Lo-fi]');
    expect(lrc).toContain('[ar:Olai Studio]');
    // 风格描述行应被过滤
    expect(lrc).not.toContain('风格：');
    expect(lrc).toContain('雨滴落在寂静的窗台');
    expect(lrc).toContain('咖啡散发温暖的香气');
    expect(lrc).toContain('微风吹拂着记忆的花海');

    // 解析生成的结果，验证时间轴递增
    const parsed = parseLRC(lrc);
    expect(parsed.length).toBe(3);
    expect(parsed[0].time).toBeLessThan(parsed[1].time);
    expect(parsed[1].time).toBeLessThan(parsed[2].time);
    expect(parsed[2].time).toBeLessThanOrEqual(30);
  });

  it('splits long prose or speech text into punctuated lyrics lines', () => {
    const speechPrompt = '请用温和的声音朗读：欢迎来到神秘的古老森林。这里有清澈的溪流，还有会发光的小鹿。';
    const lrc = generateLrcFromPrompt(speechPrompt, 20);

    const parsed = parseLRC(lrc);
    expect(parsed.length).toBeGreaterThanOrEqual(2);
    expect(parsed[0].text).toContain('欢迎来到神秘的古老森林');
  });
});
