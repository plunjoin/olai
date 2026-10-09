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
 * 懒加载 ffmpeg.wasm
 */
export async function loadFFmpeg(onProgress?: (message: string) => void): Promise<FFmpeg> {
  if (ffmpegReady && ffmpegInstance) {
    return ffmpegInstance;
  }
  
  if (ffmpegLoading) {
    // 等待加载完成
    while (ffmpegLoading) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (ffmpegReady && ffmpegInstance) {
      return ffmpegInstance;
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
    
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    
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
  
  // 创建 concat 列表
  const concatList = completedShots
    .map((_, i) => `file 'input${i}.mp4'`)
    .join('\n');
  await ffmpeg.writeFile('concat.txt', concatList);
  
  // 如果有音乐，写入音乐文件
  if (musicBlob) {
    await ffmpeg.writeFile('music.mp3', await fetchFile(musicBlob));
  }
  
  // 如果有字幕，写入 SRT 文件
  if (includeSubtitles && plan.subtitleText) {
    await ffmpeg.writeFile('subtitles.srt', plan.subtitleText);
  }
  
  onProgress?.('合成视频中...', 20);
  
  // 构建 ffmpeg 命令
  const args: string[] = [
    '-f', 'concat',
    '-safe', '0',
    '-i', 'concat.txt',
  ];
  
  // 添加音乐输入
  if (musicBlob && plan.musicTrimDuration) {
    args.push('-i', 'music.mp3');
  }
  
  // 视频滤镜：缩放到目标分辨率
  let videoFilter = `scale=${plan.targetWidth}:${plan.targetHeight}:force_original_aspect_ratio=decrease,pad=${plan.targetWidth}:${plan.targetHeight}:(ow-iw)/2:(oh-ih)/2,fps=${plan.targetFPS}`;
  
  // 添加字幕
  if (includeSubtitles && plan.subtitleText) {
    videoFilter += `,subtitles=subtitles.srt:force_style='FontSize=20,PrimaryColour=&HFFFFFF&,OutlineColour=&H000000&,Outline=2'`;
  }
  
  args.push('-vf', videoFilter);
  
  // 音频处理
  if (musicBlob && plan.musicTrimDuration) {
    // 混合原视频音频和背景音乐
    // 背景音乐音量降低（ducking）
    let audioFilter = `[0:a]volume=1.0[a0];[1:a]volume=0.3`;
    
    // 如果需要淡出
    if (plan.needsMusicFade) {
      const fadeStart = plan.musicTrimDuration - 2; // 最后2秒淡出
      audioFilter += `,afade=t=out:st=${fadeStart}:d=2`;
    }
    
    audioFilter += `[a1];[a0][a1]amix=inputs=2:duration=first[aout]`;
    
    args.push('-filter_complex', audioFilter);
    args.push('-map', '0:v');
    args.push('-map', '[aout]');
  } else {
    // 只使用视频原音频
    args.push('-c:a', 'aac');
  }
  
  // 输出选项
  args.push(
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '23',
    '-movflags', '+faststart',
    '-y',
    'output.mp4'
  );
  
  // 执行 ffmpeg 命令
  await ffmpeg.exec(args);
  
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
    await ffmpeg.deleteFile('concat.txt');
    await ffmpeg.deleteFile('output.mp4');
    if (musicBlob) await ffmpeg.deleteFile('music.mp3');
    if (includeSubtitles) await ffmpeg.deleteFile('subtitles.srt');
  } catch (e) {
    // Ignore cleanup errors
  }
  
  onProgress?.('合成完成！', 100);
  
  return new Blob([typeof data === 'string' ? data : new Uint8Array(data)], { type: 'video/mp4' });
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
