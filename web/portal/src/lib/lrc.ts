/**
 * LRC 歌词处理与智能时间轴对齐工具库
 */
import { t } from './i18n';

export interface LyricLine {
  time: number; // 秒数，如 14.5
  text: string;
}

export interface LrcMetadata {
  [key: string]: string;
}

/**
 * 格式化秒数为 LRC 标准时间戳 [mm:ss.xx]
 */
export function formatLrcTimestamp(seconds: number): string {
  const safeSec = Math.max(0, seconds);
  const mins = Math.floor(safeSec / 60);
  const remainingSecs = safeSec % 60;
  const secs = Math.floor(remainingSecs);
  let hundredths = Math.round((remainingSecs - secs) * 100);

  let finalSecs = secs;
  if (hundredths >= 100) {
    finalSecs += 1;
    hundredths = 0;
  }
  let finalMins = mins;
  if (finalSecs >= 60) {
    finalMins += 1;
    finalSecs = 0;
  }

  const mm = finalMins.toString().padStart(2, '0');
  const ss = finalSecs.toString().padStart(2, '0');
  const xx = hundredths.toString().padStart(2, '0');
  return `[${mm}:${ss}.${xx}]`;
}

/**
 * 解析标准 LRC 文本为结构化歌词数组
 */
export function parseLRC(lrcText: string): LyricLine[] {
  if (!lrcText || typeof lrcText !== 'string') return [];

  const lines = lrcText.split('\n');
  const result: LyricLine[] = [];
  // 与 iLRC 一致：分钟支持 1–3 位，毫秒支持 0–3 位（缺位按右侧补零）。
  const timeRegex = /\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 匹配该行中的所有时间戳（一行可能支持多个时间标签）
    const matches = Array.from(trimmed.matchAll(timeRegex));
    if (matches.length === 0) continue;

    // 提取歌词文本（去掉所有 [mm:ss.xx] 标签）
    const text = trimmed.replace(timeRegex, '').trim();

    for (const match of matches) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const fractionalStr = (match[3] || '0').padEnd(3, '0').slice(0, 3);
      const fractional = parseInt(fractionalStr, 10) / 1000;

      const time = minutes * 60 + seconds + fractional;
      result.push({ time, text });
    }
  }

  // 按时间升序排序
  return result.sort((a, b) => a.time - b.time);
}

/**
 * 提取 LRC 头部的元数据（[ti:]、[ar:]、[al:]、[by:]、自定义标签）。
 * 手动保存时原样带回，避免校对后丢失歌曲信息。
 */
export function parseLrcMetadata(lrcText: string): LrcMetadata {
  const meta: LrcMetadata = {};
  if (!lrcText || typeof lrcText !== 'string') return meta;
  for (const raw of lrcText.split('\n')) {
    const match = raw.trim().match(/^\[([a-zA-Z][\w-]*)\s*:\s*(.*)\]$/);
    if (!match) continue;
    const value = match[2].trim();
    if (value) meta[match[1].toLowerCase()] = value;
  }
  return meta;
}

/**
 * 解析用户在时间输入框里填写的值，支持 01:23.45、1:23、83.45。
 * 返回秒数，无法识别时返回 null。
 */
export function parseLrcTimeInput(value: string): number | null {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  const clock = trimmed.match(/^(\d{1,3}):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (clock) {
    const minutes = parseInt(clock[1], 10);
    const seconds = parseInt(clock[2], 10);
    if (seconds >= 60) return null;
    const fractional = parseInt((clock[3] || '0').padEnd(3, '0').slice(0, 3), 10) / 1000;
    return minutes * 60 + seconds + fractional;
  }
  const seconds = Number(trimmed);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

/**
 * 将提示词或歌词文本智能切分并分布为标准 LRC 格式
 * @param prompt 用户输入的歌词或描述
 * @param durationSeconds 歌曲总时长（秒），默认 30
 * @param title 歌曲标题
 */
export function generateLrcFromPrompt(
  prompt: string,
  durationSeconds = 30,
  title = 'AI Original'
): string {
  if (!prompt || typeof prompt !== 'string') return '';

  // 1. 清洗与提取实际歌词/发音行
  const rawLines = prompt
    .split('\n')
    .map(line => line.trim())
    .filter(line => {
      if (!line) return false;
      // 过滤风格参数说明行
      if (/^风格[：:]/i.test(line)) return false;
      if (/^style[：:]/i.test(line)) return false;
      return true;
    });

  // 2. 如果只有单行长句（例如朗读提示），按中英文标点拆分成断句
  let cleanLines: string[] = [];
  if (rawLines.length <= 1 && rawLines[0]) {
    const text = rawLines[0].replace(/^请用[^：:]+[：:]/i, ''); // 移除“请用平静声音朗读：”等前缀
    const sentences = text
      .split(/([。！？；…!?;]+)/)
      .filter(Boolean);

    let temp = '';
    for (const piece of sentences) {
      temp += piece;
      if (/[。！？；…!?;\n]/.test(piece)) {
        if (temp.trim()) cleanLines.push(temp.trim());
        temp = '';
      }
    }
    if (temp.trim()) cleanLines.push(temp.trim());
  } else {
    cleanLines = rawLines;
  }

  if (cleanLines.length === 0) {
    cleanLines = [t('(纯音乐演奏 - 请享受旋律)')];
  }

  // 3. 计算时间分布（前导 2.5 秒留白，尾部留白 3 秒）
  const total = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 30;
  const startOffset = Math.min(2.5, total * 0.1);
  const endOffset = total - Math.min(2.5, total * .1);
  const availableSpan = Math.max(.001, endOffset - startOffset);

  const step = availableSpan / Math.max(1, cleanLines.length);

  const header = [
    `[ti:${title.slice(0, 30)}]`,
    `[ar:Olai Studio]`,
    `[al:AI Audio Collection]`,
    `[by:Olai AI]`,
  ];

  const body = cleanLines.map((line, idx) => {
    const time = startOffset + idx * step;
    return `${formatLrcTimestamp(time)} ${line}`;
  });

  return [...header, ...body].join('\n');
}

/**
 * 不带方括号的 LRC 时钟，用于校对界面显示，如 01:23.45
 */
export function formatLrcClock(seconds: number): string {
  return formatLrcTimestamp(seconds).slice(1, -1);
}

/**
 * 用校对后的歌词行重建 LRC 文本。
 * 保存时按时间升序排列，同一时间的行保持原有先后顺序。
 * 原文件的 [ti:]、[ar:]、[al:]、[by:] 与自定义标签会带回来，标准标签按固定顺序输出。
 * [offset:] 不保留：校对后的时间戳就是最终时间，避免其他播放器再次平移。
 */
export function buildLrcFromLines(
  lines: LyricLine[],
  options: { title?: string; by?: string; meta?: LrcMetadata } = {},
): string {
  const clean = (value: string) => String(value ?? '').replace(/[\r\n\[\]]/g, '').trim();
  const metadata: LrcMetadata = {};
  for (const [rawKey, rawValue] of Object.entries(options.meta || {})) {
    const key = rawKey.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!key || key === 'offset') continue;
    const value = clean(rawValue);
    if (value) metadata[key] = value;
  }
  const title = clean(options.title || metadata.ti || '');
  if (title) metadata.ti = title.slice(0, 100);
  else delete metadata.ti;
  const by = clean(options.by || metadata.by || 'Olai manual timing');
  if (by) metadata.by = by.slice(0, 60);
  else delete metadata.by;

  const header: string[] = [];
  for (const key of ['ti', 'ar', 'al', 'by']) {
    if (metadata[key]) {
      header.push(`[${key}:${metadata[key]}]`);
      delete metadata[key];
    }
  }
  for (const [key, value] of Object.entries(metadata)) {
    header.push(`[${key}:${value.slice(0, 200)}]`);
  }

  const body = lines
    .map((line, order) => ({ time: Math.max(0, Number.isFinite(line.time) ? line.time : 0), text: line.text.trim(), order }))
    .filter(line => line.text)
    .sort((a, b) => a.time - b.time || a.order - b.order)
    .map(line => `${formatLrcTimestamp(line.time)} ${line.text}`);
  return [...header, ...body].join('\n');
}

/**
 * 触发浏览器直接下载 .lrc 歌词文件
 */
export function downloadLrcBlob(lrcContent: string, filename = 'lyrics.lrc'): void {
  const blob = new Blob([lrcContent], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
