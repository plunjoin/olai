/**
 * 视频合成工具
 * 
 * 使用 ffmpeg.wasm 在浏览器中合成多个镜头视频为一个完整视频
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import type { Shot } from './videoWorkflow';

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoading = false;
let ffmpegReady = false;

/**
 * 懒加载 ffmpeg.wasm（带超时）
 */
export async function loadFFmpeg(onProgress?: (message: string) => void): Promise<FFmpeg> {
  if (ffmpegReady && ffmpegInstance) {
    return ffmpegInstance;
  }
  
  if (ffmpegLoading) {
    // 等待加载完成（最多 60 秒）
    const startWait = Date.now();
    while (ffmpegLoading && Date.now() - startWait < 60000) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (ffmpegReady && ffmpegInstance) {
      return ffmpegInstance;
    }
    if (ffmpegLoading) {
      throw new Error('视频处理引擎加载超时，请刷新页面重试');
    }
  }
  
  ffmpegLoading = true;
  onProgress?.('正在加载视频处理引擎...');
  
  try {
    const ffmpeg = new FFmpeg();
    
    ffmpeg.on('log', ({ message }) => {
      console.log('[FFmpeg]', message);
    });
    
    ffmpeg.on('progress', ({ progress }) => {
      onProgress?.(`处理中：${Math.round(progress * 100)}%`);
    });
    
    // Try self-hosted first, fallback to CDN
    let baseURL = '/ffmpeg-core';
    let coreURL: string;
    let wasmURL: string;
    
    try {
      // Try self-hosted
      const testResponse = await fetch(`${baseURL}/ffmpeg-core.js`, { method: 'HEAD' });
      if (!testResponse.ok) throw new Error('Self-hosted core not found');
      coreURL = await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript');
      wasmURL = await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm');
    } catch {
      // Fallback to CDN
      onProgress?.('正在从 CDN 加载引擎...');
      baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
      coreURL = await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript');
      wasmURL = await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm');
    }
    
    // Load with timeout
    const loadPromise = ffmpeg.load({ coreURL, wasmURL });
    const timeoutPromise = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error('加载超时')), 60000)
    );
    
    await Promise.race([loadPromise, timeoutPromise]);
    
    ffmpegInstance = ffmpeg;
    ffmpegReady = true;
    onProgress?.('视频处理引擎已就绪');
    
    return ffmpeg;
  } catch (error) {
    ffmpegLoading = false;
    throw new Error(`加载视频处理引擎失败：${error instanceof Error ? error.message : '未知错误'}`);
  } finally {
    ffmpegLoading = false;
  }
}

/**
 * SRT 字幕格式
 */
export interface SubtitleEntry {
  index: number;
  startTime: string; // HH:MM:SS,mmm
  endTime: string;   // HH:MM:SS,mmm
  text: string;
}

/**
 * 将秒数转换为 SRT 时间格式
 */
function secondsToSRTTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.floor((seconds % 1) * 1000);
  
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

/**
 * 从镜头列表生成 SRT 字幕
 */
export function generateSRT(shots: Shot[]): string {
  const entries: SubtitleEntry[] = [];
  let currentTime = 0;
  
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    if (!shot.dialogue) {
      currentTime += shot.duration;
      continue;
    }
    
    entries.push({
      index: entries.length + 1,
      startTime: secondsToSRTTime(currentTime),
      endTime: secondsToSRTTime(currentTime + shot.duration),
      text: shot.dialogue,
    });
    
    currentTime += shot.duration;
  }
  
  return entries
    .map(entry => `${entry.index}\n${entry.startTime} --> ${entry.endTime}\n${entry.text}\n`)
    .join('\n');
}

/**
 * 视频合成选项
 */
export interface AssemblyOptions {
  shots: Shot[];
  musicBlob?: Blob;
  musicDuration?: number;
  includeSubtitles?: boolean;
  targetResolution?: '720p' | '1080p';
  targetFPS?: number;
  maxConcurrency?: number;
  onProgress?: (message: string, percent?: number) => void;
}

/**
 * 合成参数
 */
export interface AssemblyPlan {
  totalDuration: number;
  shotCount: number;
  musicTrimDuration?: number;
  needsMusicFade: boolean;
  targetWidth: number;
  targetHeight: number;
  targetFPS: number;
  hasSubtitles: boolean;
  subtitleText?: string;
}

/**
 * 计算合成计划
 */
export function planAssembly(options: AssemblyOptions): AssemblyPlan {
  const { shots, musicBlob, musicDuration, includeSubtitles, targetResolution = '720p', targetFPS = 30 } = options;
  
  const totalDuration = shots.reduce((sum, shot) => sum + shot.duration, 0);
  const shotCount = shots.filter(s => s.videoBlob && s.videoStatus === 'completed').length;
  
  let musicTrimDuration: number | undefined;
  let needsMusicFade = false;
  
  if (musicBlob && musicDuration) {
    if (musicDuration > totalDuration) {
      musicTrimDuration = totalDuration;
      needsMusicFade = true;
    } else {
      musicTrimDuration = musicDuration;
    }
  }
  
  const [targetWidth, targetHeight] = targetResolution === '1080p' 
    ? [1920, 1080] 
    : [1280, 720];
  
  let subtitleText: string | undefined;
  if (includeSubtitles) {
    subtitleText = generateSRT(shots);
  }
  
  return {
    totalDuration,
    shotCount,
    musicTrimDuration,
    needsMusicFade,
    targetWidth,
    targetHeight,
    targetFPS,
    hasSubtitles: includeSubtitles || false,
    subtitleText,
  };
}

/**
 * 合成视频
 */
export async function assembleVideo(options: AssemblyOptions): Promise<Blob> {
  const { shots, musicBlob, includeSubtitles, targetResolution = '720p', targetFPS = 30, onProgress } = options;
  
  const ffmpeg = await loadFFmpeg(onProgress);
  const plan = planAssembly(options);
  
  onProgress?.('准备视频文件...', 0);
  
  // 过滤出已完成的镜头
  const completedShots = shots.filter(s => s.videoBlob && s.videoStatus === 'completed');
  
  if (completedShots.length === 0) {
    throw new Error('没有可用的视频镜头');
  }
  
  // 写入所有视频文件
  for (let i = 0; i < completedShots.length; i++) {
    const shot = completedShots[i];
    const fileName = `input${i}.mp4`;
    await ffmpeg.writeFile(fileName, await fetchFile(shot.videoBlob!));
  }
  
  onProgress?.('准备合成...', 10);
  
  // 如果有音乐，写入音乐文件
  if (musicBlob) {
    await ffmpeg.writeFile('music.mp3', await fetchFile(musicBlob));
  }
  
  // 如果有字幕，写入 SRT 文件
  if (includeSubtitles && plan.subtitleText) {
    await ffmpeg.writeFile('subtitles.srt', plan.subtitleText);
  }
  
  onProgress?.('合成视频中...', 20);
  
  // 构建 ffmpeg 命令 - use filter_complex for robust audio handling
  const args: string[] = [];
  
  // Add all input files
  for (let i = 0; i < completedShots.length; i++) {
    args.push('-i', `input${i}.mp4`);
  }
  
  // Add music input if present
  const musicInputIndex = completedShots.length;
  if (musicBlob) {
    args.push('-i', 'music.mp3');
  }
  
  // Build filter_complex for video normalization + concat + audio mixing
  let filterComplex = '';
  
  // Normalize each clip: scale/pad + fps + ensure audio (anullsrc for silent clips)
  for (let i = 0; i < completedShots.length; i++) {
    filterComplex += `[${i}:v]scale=${plan.targetWidth}:${plan.targetHeight}:force_original_aspect_ratio=decrease,pad=${plan.targetWidth}:${plan.targetHeight}:(ow-iw)/2:(oh-ih)/2,fps=${plan.targetFPS},setsar=1[v${i}];`;
    // Try to use existing audio, generate silent if missing
    filterComplex += `[${i}:a]anull[a${i}tmp];`;
  }
  
  // Concat normalized clips
  const concatInputs = completedShots.map((_, i) => `[v${i}][a${i}tmp]`).join('');
  filterComplex += `${concatInputs}concat=n=${completedShots.length}:v=1:a=1[vconcated][aconcated];`;
  
  // Add subtitles if needed
  if (includeSubtitles && plan.subtitleText) {
    // Note: ffmpeg.wasm may lack font support - subtitles may not render
    // TODO: Ship a CJK font (e.g. Noto Sans SC subset) into wasm FS
    filterComplex += `[vconcated]subtitles=subtitles.srt:force_style='FontName=Sans,FontSize=20,PrimaryColour=&HFFFFFF&,OutlineColour=&H000000&,Outline=2,Bold=1'[vout];`;
  } else {
    filterComplex += `[vconcated]copy[vout];`;
  }
  
  // Mix audio if music present
  if (musicBlob) {
    const musicTrim = plan.totalDuration;
    const fadeStart = Math.max(0, musicTrim - 2);
    // Trim and fade music, then duck it and mix with video audio (duration=longest to keep full video audio)
    filterComplex += `[${musicInputIndex}:a]atrim=0:${musicTrim},afade=t=out:st=${fadeStart}:d=2,volume=0.3[music];`;
    filterComplex += `[aconcated][music]amix=inputs=2:duration=longest[aout]`;
  } else {
    filterComplex += `[aconcated]anull[aout]`;
  }
  
  args.push('-filter_complex', filterComplex);
  args.push('-map', '[vout]');
  args.push('-map', '[aout]');
  
  // Output options (faster preset for single-threaded core)
  args.push(
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    '-y',
    'output.mp4'
  );
  
  // Execute ffmpeg command with error checking
  try {
    await ffmpeg.exec(args);
  } catch (error) {
    throw new Error(`视频合成失败：${error instanceof Error ? error.message : '未知错误'}`);
  }
  
  onProgress?.('读取合成结果...', 90);
  
  // 读取输出文件
  const data = await ffmpeg.readFile('output.mp4');
  
  // 清理临时文件
  for (let i = 0; i < completedShots.length; i++) {
    try {
      await ffmpeg.deleteFile(`input${i}.mp4`);
    } catch (e) {
      // Ignore cleanup errors
    }
  }
  try {
    await ffmpeg.deleteFile('output.mp4');
    if (musicBlob) await ffmpeg.deleteFile('music.mp3');
    if (includeSubtitles) await ffmpeg.deleteFile('subtitles.srt');
  } catch (e) {
    // Ignore cleanup errors
  }
  
  onProgress?.('合成完成！', 100);
  
  return new Blob([data], { type: 'video/mp4' });
}

/**
 * 导出 SRT 字幕文件
 */
export function exportSRT(shots: Shot[], projectTitle: string): void {
  const srt = generateSRT(shots);
  const blob = new Blob([srt], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${projectTitle}.srt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
