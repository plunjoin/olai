/**
 * 音频处理核心工具集：
 * 1. 原始 PCM (Linear PCM 16-bit 24kHz Mono) 封装标准 RIFF/WAVE 容器头
 * 2. data:audio/pcm 与各类音频 data URI 解析与 Blob 转换
 * 3. 从 Markdown 消息中提取音频媒体链接
 */

export interface ParsedAudio {
  blob: Blob;
  mime: string;
  url?: string;
  sampleRate?: number;
}

/**
 * 将裸 PCM (16-bit signed integer, Little-Endian) 数据封装为标准的 44 字节 RIFF/WAVE 文件
 */
export function pcmToWavBlob(
  pcmData: Uint8Array,
  sampleRate = 24000,
  numChannels = 1,
  bitDepth = 16
): Blob {
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmData.length;

  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  // 1. "RIFF" 标识
  writeAscii(view, 0, 'RIFF');
  // 2. 文件总长度 - 8
  view.setUint32(4, 36 + dataSize, true);
  // 3. "WAVE" 标识
  writeAscii(view, 8, 'WAVE');

  // 4. "fmt " 子块
  writeAscii(view, 12, 'fmt ');
  // 5. fmt 子块大小 (PCM 固定为 16)
  view.setUint32(16, 16, true);
  // 6. 音频格式 (1 代表 PCM)
  view.setUint16(20, 1, true);
  // 7. 声道数
  view.setUint16(22, numChannels, true);
  // 8. 采样率
  view.setUint32(24, sampleRate, true);
  // 9. 字节率 (Byte Rate)
  view.setUint32(28, byteRate, true);
  // 10. 块对齐 (Block Align)
  view.setUint16(32, blockAlign, true);
  // 11. 采样位深 (Bits per Sample)
  view.setUint16(34, bitDepth, true);

  // 12. "data" 子块
  writeAscii(view, 36, 'data');
  // 13. 音频数据长度
  view.setUint32(40, dataSize, true);

  return new Blob([header, pcmData as unknown as BlobPart], { type: 'audio/wav' });
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/**
 * Base64 字符串解码为 Uint8Array（自动剔除 data URI 前缀及换行空白）
 */
export function base64ToBytes(base64: string): Uint8Array {
  const comma = base64.indexOf(',');
  const raw = comma !== -1 ? base64.slice(comma + 1) : base64;
  const clean = raw.replace(/\s+/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * 检查二进制数据是否已经是标准 RIFF/WAVE 文件头
 */
export function isRiffWav(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45
  );
}

/**
 * 解析 data: URI。
 * 如果是 data:audio/pcm，提取采样率并自动转换为 audio/wav Blob。
 * 如果是常规音频容器（wav, mp3, ogg, mpeg 等），直接转为对应 Blob。
 */
export function parseAudioDataUri(uri: string): ParsedAudio {
  if (!uri.startsWith('data:')) {
    throw new Error('无效的 data URI');
  }

  const comma = uri.indexOf(',');
  if (comma === -1) {
    throw new Error('未找到 Base64 数据的逗号分隔符');
  }

  const meta = uri.slice(5, comma);
  const base64 = uri.slice(comma + 1);
  const bytes = base64ToBytes(base64);

  // 提取 MIME 与参数（如 audio/pcm;rate=24000）
  const parts = meta.split(';');
  let mimeType = parts[0]?.toLowerCase() || 'application/octet-stream';

  // 提取采样率，默认 24000
  let sampleRate = 24000;
  for (const part of parts.slice(1)) {
    const rateMatch = part.match(/^rate=(\d+)/i);
    if (rateMatch) {
      sampleRate = parseInt(rateMatch[1], 10);
    }
  }

  if (mimeType.includes('pcm')) {
    const wavBlob = isRiffWav(bytes)
      ? new Blob([bytes as unknown as BlobPart], { type: 'audio/wav' })
      : pcmToWavBlob(bytes, sampleRate, 1, 16);
    return {
      blob: wavBlob,
      mime: 'audio/wav',
      sampleRate,
    };
  }

  if (mimeType === 'application/octet-stream' || !mimeType.startsWith('audio/')) {
    if (isRiffWav(bytes)) mimeType = 'audio/wav';
    else if (bytes.length >= 3 && ((bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))) mimeType = 'audio/mpeg';
    else mimeType = 'audio/wav';
  }

  return {
    blob: new Blob([bytes as unknown as BlobPart], { type: mimeType }),
    mime: mimeType,
    sampleRate,
  };
}

/**
 * 将包含 PCM 的音频链接或 data URI 转换为可直接播放的 URI（若为 PCM 则同步包装为 data:audio/wav）
 */
export function convertAudioDataUriToPlayable(uri: string): string {
  if (!uri || !uri.startsWith('data:audio/')) return uri;
  if (!uri.toLowerCase().includes('pcm')) return uri;

  try {
    const comma = uri.indexOf(',');
    if (comma === -1) return uri;
    const meta = uri.slice(5, comma);
    const base64 = uri.slice(comma + 1);
    const bytes = base64ToBytes(base64);

    if (isRiffWav(bytes)) {
      return 'data:audio/wav;base64,' + base64.replace(/\s+/g, '');
    }

    let sampleRate = 24000;
    const rateMatch = meta.match(/rate=(\d+)/i);
    if (rateMatch) {
      sampleRate = parseInt(rateMatch[1], 10);
    }

    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    const byteRate = sampleRate * 2;
    writeAscii(view, 0, 'RIFF');
    view.setUint32(4, 36 + bytes.length, true);
    writeAscii(view, 8, 'WAVE');
    writeAscii(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, 2, true); // BlockAlign
    view.setUint16(34, 16, true); // 16-bit
    writeAscii(view, 36, 'data');
    view.setUint32(40, bytes.length, true);

    const wavBytes = new Uint8Array(44 + bytes.length);
    wavBytes.set(new Uint8Array(header), 0);
    wavBytes.set(bytes, 44);

    let binary = '';
    const len = wavBytes.length;
    for (let i = 0; i < len; i += 8192) {
      binary += String.fromCharCode.apply(null, Array.from(wavBytes.subarray(i, Math.min(i + 8192, len))));
    }
    return 'data:audio/wav;base64,' + btoa(binary);
  } catch {
    return uri;
  }
}

/**
 * 将可能包含 PCM 的音频链接或 data URI 转换为可直接播放的 URL
 */
export function resolvePlayableAudioUrl(urlOrDataUri: string): { url: string; revoke?: () => void } {
  if (!urlOrDataUri) return { url: '' };

  if (urlOrDataUri.startsWith('data:')) {
    try {
      const parsed = parseAudioDataUri(urlOrDataUri);
      const objectUrl = URL.createObjectURL(parsed.blob);
      return {
        url: objectUrl,
        revoke: () => URL.revokeObjectURL(objectUrl),
      };
    } catch {
      return { url: urlOrDataUri };
    }
  }

  return { url: urlOrDataUri };
}

/**
 * 确保音频 Blob 具有浏览器可解码播放的标准音频 MIME 类型
 */
export async function ensurePlayableAudioBlob(blob: Blob): Promise<Blob> {
  if (blob.type && blob.type.startsWith('audio/') && !blob.type.includes('octet-stream')) {
    return blob;
  }
  try {
    const buffer = await blob.slice(0, 16).arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let mime = 'audio/mpeg';
    if (isRiffWav(bytes)) {
      mime = 'audio/wav';
    } else if (bytes.length >= 4 && bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
      mime = 'audio/ogg';
    } else if (bytes.length >= 4 && bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43) {
      mime = 'audio/flac';
    } else if (bytes.length >= 3 && ((bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))) {
      mime = 'audio/mpeg';
    }
    return new Blob([blob], { type: mime });
  } catch {
    return new Blob([blob], { type: 'audio/wav' });
  }
}
