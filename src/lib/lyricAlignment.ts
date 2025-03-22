import { request, safeMediaURL } from './api';
import { pcmToWavBlob } from './audio';
import { formatLrcTimestamp } from './lrc';
import type { Asset } from './types';
import { sungLines } from './music';

export function readAudioDuration(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const url = URL.createObjectURL(blob);
    const finish = (duration?: number) => {
      clearTimeout(timer); audio.onloadedmetadata = null; audio.onerror = null;
      audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url);
      if (duration && Number.isFinite(duration)) resolve(duration);
      else reject(new Error('无法读取音频时长，请检查音频文件。'));
    };
    const timer = setTimeout(() => finish(), 8000);
    audio.onloadedmetadata = () => finish(audio.duration);
    audio.onerror = () => finish();
    audio.preload = 'metadata'; audio.src = url;
  });
}

export function alignmentToLrc(content: string, lyrics: string, duration: number, title: string): string {
  const expected = lyrics.split('\n').map(text => text.trim()).filter(Boolean);
  let result;
  try { result = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
  catch { throw new Error('校准结果格式不完整，原歌词时间轴已保留。'); }
  if (!Array.isArray(result?.lines) || result.lines.length !== expected.length || !expected.length) throw new Error('校准结果缺少歌词，原歌词时间轴已保留。');
  let previousEnd = 0;
  const body = result.lines.flatMap((line: { index: number; start: number; end: number }, index: number) => {
    if (line.index !== index || typeof line.start !== 'number' || typeof line.end !== 'number' || !Number.isFinite(line.start) || !Number.isFinite(line.end) || line.start < previousEnd || line.end <= line.start || line.end > duration || line.start >= duration) throw new Error('校准结果包含无效或重叠的时间点，原歌词时间轴已保留。');
    previousEnd = line.end;
    return [`${formatLrcTimestamp(line.start)} ${expected[index]}`, `${formatLrcTimestamp(line.end)}`];
  });
  return [`[ti:${title.replace(/[\r\n\[\]]/g, '').slice(0, 100)}]`, '[by:Olai audio alignment]', ...body].join('\n');
}

export async function alignLyricsToAudio(asset: Asset, key: string, model: string, signal: AbortSignal): Promise<{ lrc: string; duration: number }> {
  const lyrics = asset.song ? sungLines(asset.song) : (asset.lyrics || '').replace(/^\[[^\]]+\]\s*$/gm, '');
  if (!lyrics.trim() || asset.song?.instrumental) throw new Error('纯音乐无需校准歌词。');
  let blob = asset.blob;
  if (!blob && asset.url) {
    try {
      const response = await fetch(safeMediaURL(asset.url), { signal });
      if (!response.ok) throw new Error();
      blob = await response.blob();
    } catch { throw new Error('无法读取原始音频，请下载后检查文件，或重新生成。'); }
  }
  if (!blob?.size) throw new Error('没有可用于校准的音频文件。');
  signal.throwIfAborted();
  // Decode the actual audio and send a compact mono WAV, preserving its timing.
  const audioContext = new AudioContext();
  let decoded: AudioBuffer;
  try { decoded = await audioContext.decodeAudioData(await blob.arrayBuffer()); }
  catch { throw new Error('音频格式暂时无法用于歌词校准，原歌词时间轴已保留。'); }
  finally { await audioContext.close(); }
  signal.throwIfAborted();
  const duration = decoded.duration;
  const rate = 16000;
  const frames = Math.floor(duration * rate);
  const pcm = new Uint8Array(frames * 2);
  const view = new DataView(pcm.buffer);
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
  for (let i = 0; i < frames; i++) {
    const position = i * decoded.sampleRate / rate;
    const left = Math.floor(position), right = Math.min(left + 1, decoded.length - 1);
    const fraction = position - left;
    const sample = channels.reduce((sum, data) => sum + data[left] * (1 - fraction) + data[right] * fraction, 0) / channels.length;
    view.setInt16(i * 2, Math.max(-1, Math.min(1, sample)) * 32767, true);
  }
  const bytes = new Uint8Array(await pcmToWavBlob(pcm, rate).arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  const lines = lyrics.split('\n').map(text => text.trim()).filter(Boolean);
  const response = await request('chat/completions', key, { method: 'POST', signal, body: JSON.stringify({
    model, stream: false, temperature: 0,
    messages: [
      { role: 'system', content: '你是音频歌词对齐助手。必须聆听提供的实际音频，标出每句歌词人声开始与结束的秒数，包含前奏、间奏、尾奏留白。禁止按总时长平均分配或猜测。按编号返回每一句（包括重复句），只返回 JSON: {"lines":[{"index":0,"start":12.34,"end":15.67}]}。index 从 0 开始，start/end 必须是实际秒数、递增且不重叠。未听到的句子或无法访问音频时返回 {"lines":[]}。' },
      { role: 'user', content: [
        { type: 'text', text: `音频实际时长：${duration.toFixed(3)} 秒。逐句校准以下歌词：\n${lines.map((line, i) => `${i}: ${line}`).join('\n')}` },
        { type: 'input_audio', input_audio: { data: btoa(binary), format: 'wav' } },
      ] },
    ],
  }) });
  const result = await response.json();
  const content = result.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('服务未返回有效的音频校准结果，原歌词时间轴已保留。');
  return { lrc: alignmentToLrc(content, lyrics, duration, asset.song?.title || '原创音乐'), duration };
}
