import { describe, expect, it } from 'vitest';
import {
  convertAudioDataUriToPlayable,
  parseAudioDataUri,
  pcmToWavBlob,
} from '../audio';
import { extractAudiosFromContent } from '../api';

describe('audio utility and PCM WAV packaging', () => {
  it('encodes PCM bytes into standard 44-byte RIFF/WAVE header', async () => {
    // 模拟 100 字节的 16-bit 线性 PCM 音频数据
    const rawPcm = new Uint8Array(100);
    for (let i = 0; i < 100; i++) rawPcm[i] = i % 256;

    const wavBlob = pcmToWavBlob(rawPcm, 24000, 1, 16);
    expect(wavBlob.type).toBe('audio/wav');
    expect(wavBlob.size).toBe(44 + 100);

    const buffer = await wavBlob.arrayBuffer();
    const view = new DataView(buffer);

    // 验证 RIFF 块
    const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    expect(riff).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + 100);

    // 验证 WAVE 与 fmt
    const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
    expect(wave).toBe('WAVE');
    const fmt = String.fromCharCode(view.getUint8(12), view.getUint8(13), view.getUint8(14), view.getUint8(15));
    expect(fmt).toBe('fmt ');

    // 验证 PCM 音频参数: format=1, channels=1, rate=24000, bitDepth=16
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(24000);
    expect(view.getUint32(28, true)).toBe(24000 * 2);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);

    // 验证 data 块
    const data = String.fromCharCode(view.getUint8(36), view.getUint8(37), view.getUint8(38), view.getUint8(39));
    expect(data).toBe('data');
    expect(view.getUint32(40, true)).toBe(100);
  });

  it('correctly parses data:audio/pcm and converts to wav', () => {
    // 4 字节的简单 PCM 数据: [0, 1, 2, 3] -> base64: AAECAw==
    const pcmDataUri = 'data:audio/pcm;rate=24000;base64,AAECAw==';
    const parsed = parseAudioDataUri(pcmDataUri);

    expect(parsed.mime).toBe('audio/wav');
    expect(parsed.sampleRate).toBe(24000);
    expect(parsed.blob.size).toBe(44 + 4);
  });

  it('preserves non-PCM audio container format like audio/mpeg or audio/wav', () => {
    const mp3DataUri = 'data:audio/mpeg;base64,AQIDBA==';
    const parsed = parseAudioDataUri(mp3DataUri);

    expect(parsed.mime).toBe('audio/mpeg');
    expect(parsed.blob.size).toBe(4);
  });

  it('synchronously converts PCM data URI to playable WAV data URI', () => {
    const pcmDataUri = 'data:audio/pcm;rate=24000;base64,AAECAw==';
    const playable = convertAudioDataUriToPlayable(pcmDataUri);

    expect(playable.startsWith('data:audio/wav;base64,')).toBe(true);
  });

  it('extracts Markdown audio links from assistant response', () => {
    const content = `欢迎来到雾中的森林。\n![media](data:audio/pcm;rate=24000;base64,AAECAw==)\n祝你旅途愉快！`;
    const results = extractAudiosFromContent(content);

    expect(results).toHaveLength(1);
    expect(results[0].mime).toBe('audio/pcm;rate=24000');
    expect(results[0].base64).toBe('AAECAw==');
  });

  it('extracts remote audio URLs', () => {
    const content = `点击播放：https://example.com/forest-sounds.mp3`;
    const results = extractAudiosFromContent(content);

    expect(results).toHaveLength(1);
    expect(results[0].url).toBe('https://example.com/forest-sounds.mp3');
    expect(results[0].mime).toBe('audio/mpeg');
  });

  it('normalizes octet-stream audio blobs to playable MIME types', async () => {
    const rawPcm = new Uint8Array(40);
    const wavBlob = pcmToWavBlob(rawPcm, 24000, 1, 16);
    // 模拟网关返回的 application/octet-stream 类型 WAV 音频
    const octetBlob = new Blob([await wavBlob.arrayBuffer()], { type: 'application/octet-stream' });
    const { ensurePlayableAudioBlob } = await import('../audio');
    const fixed = await ensurePlayableAudioBlob(octetBlob);

    expect(fixed.type).toBe('audio/wav');
    expect(fixed.size).toBe(octetBlob.size);
  });

  it('extracts MP3 audio from lyria music generation response', async () => {
    const { mediaOutputs } = await import('../api');
    // 模拟 web2api lyria 音乐生成响应
    const response = {
      choices: [{
        message: {
          role: 'assistant',
          content: 'Generated music:\n![media](data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYwLjE2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAADhAC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzYwLjMxAAAAAAAAAAAAAAAAJAQKAAAAAAAAA4To5zSr//sQZAAP8AAAaQAAAAgAAA0gAAABAAABpAAAACAAADSAAAAETEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVQ==)'
        }
      }]
    };

    const audios = mediaOutputs(response, 'music');
    expect(audios).toHaveLength(1);
    expect(audios[0].mime).toBe('audio/mpeg');
    expect(audios[0].base64).toBeTruthy();
    expect(audios[0].base64?.startsWith('SUQz')).toBe(true); // MP3 ID3 header
  });
});
