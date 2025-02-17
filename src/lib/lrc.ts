/**
 * LRC 歌词处理与智能时间轴对齐工具库
 */

export interface LyricLine {
  time: number; // 秒数，如 14.5
  text: string;
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
  const timeRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g;

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
      const fractionalStr = match[3] || '0';
      const fractional = fractionalStr.length === 3 ? parseInt(fractionalStr, 10) / 1000 : parseInt(fractionalStr, 10) / 100;

      const time = minutes * 60 + seconds + fractional;
      result.push({ time, text });
    }
  }

  // 按时间升序排序
  return result.sort((a, b) => a.time - b.time);
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
    cleanLines = ['(纯音乐演奏 - 请享受旋律)'];
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
