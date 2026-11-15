import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ChevronLeft, Download, Film, Play, Plus, Trash2 } from 'lucide-react';
import { usePlayer } from '../lib/playerContext';
import WorkflowBoard from './WorkflowBoard';
import {
  calculateTotalDuration,
  countPendingGenerations,
  createWorkflowProject,
  parseRetryAfter,
  planContinuousShots,
  type Shot,
  type VideoWorkflowProject,
  type WorkflowStage,
  validateShotList,
} from '../lib/videoWorkflow';
import { assembleVideo, exportSRT } from '../lib/videoAssembly';
import { base64Blob, generateAudio, generateImage, generateVideo, mediaOutputs, publicServiceError, request, safeMediaURL, videoContent } from '../lib/api';
import { OMNI_SEGMENT_DURATION, type VideoEngineMode } from '../lib/video';
import { getAll, put, remove } from '../lib/storage';
import { intlLocale, t } from '../lib/i18n';

interface VideoWorkflowWorkspaceProps {
  videoEngineMode?: VideoEngineMode;
  generationLimit: number;
  onRequestQuota: (kind: 'image' | 'video' | 'music', count: number) => Promise<boolean>;
  onError: (message: string) => void;
}

const STAGE_LABELS: Record<WorkflowStage, string> = {
  init: t('创意输入'),
  script: t('编剧'),
  shotlist: t('分镜'),
  keyframes: t('关键帧'),
  videos: t('视频生成'),
  music: t('配乐'),
  assembly: t('合成'),
  complete: t('完成'),
};

// 环境变量配置
const AI_VIDEO_IMAGE_INPUT = import.meta.env.AI_VIDEO_IMAGE_INPUT === 'true';
const AI_VIDEO_OMNI_ASYNC = import.meta.env.AI_VIDEO_OMNI_ASYNC === 'true';
const AI_VIDEO_EXTEND_MAX_SECONDS = parseInt(import.meta.env.AI_VIDEO_EXTEND_MAX_SECONDS || '30', 10);
const MAX_CONCURRENCY = 2;

export default function VideoWorkflowWorkspace({
  videoEngineMode = 'chat',
  generationLimit,
  onRequestQuota,
  onError,
}: VideoWorkflowWorkspaceProps) {
  const [projects, setProjects] = useState<VideoWorkflowProject[]>([]);
  const [currentProject, setCurrentProject] = useState<VideoWorkflowProject | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [newIdea, setNewIdea] = useState('');
  const [newDuration, setNewDuration] = useState(30);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'failed'>('saved');
  const saveVersion = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const { play, setIsVideoExpanded } = usePlayer();

  // 加载项目列表
  useEffect(() => {
    let active = true;
    const mediaURLs: string[] = [];
    const restoreURL = (blob: Blob | undefined, fallback: string | undefined) => {
      if (!blob) return fallback;
      const url = URL.createObjectURL(blob);
      mediaURLs.push(url);
      return url;
    };
    getAll<VideoWorkflowProject>('workflows').then(records => {
      if (!active) return;
      setProjects(records.map(project => ({
        ...project,
        shots: project.shots?.map(shot => ({ ...shot, keyframeUrl: restoreURL(shot.keyframeBlob, shot.keyframeUrl), videoUrl: restoreURL(shot.videoBlob, shot.videoUrl) })),
        musicUrl: restoreURL(project.musicBlob, project.musicUrl),
        finalVideoUrl: restoreURL(project.finalVideoBlob, project.finalVideoUrl),
      })));
    }).catch(() => { if (active) onError(t('短片项目读取失败，请刷新页面重试。')); });
    return () => { active = false; mediaURLs.forEach(url => URL.revokeObjectURL(url)); };
  }, []);

  // 保存项目
  const saveProject = useCallback(async (project: VideoWorkflowProject) => {
    const updated = { ...project, updatedAt: Date.now() };
    const version = ++saveVersion.current;
    setSaveState('saving');
    setCurrentProject(updated);
    setProjects(prev => {
      const index = prev.findIndex(p => p.id === updated.id);
      if (index >= 0) {
        const next = [...prev];
        next[index] = updated;
        return next;
      }
      return [...prev, updated];
    });
    try {
      await put('workflows', updated);
      if (version === saveVersion.current) setSaveState('saved');
    } catch (error) {
      if (version === saveVersion.current) setSaveState('failed');
      throw error;
    }
  }, []);

  const saveBoard = (project: VideoWorkflowProject) => {
    void saveProject(project).catch(() => onError(t('项目保存失败，请点击重试保存。')));
  };

  // 创建新项目
  const handleCreateProject = useCallback(async (idea: string, targetLength: number) => {
    const project = createWorkflowProject(idea, targetLength);
    await saveProject(project);
  }, [saveProject]);

  // 删除项目
  const handleDeleteProject = useCallback(async (projectId: string) => {
    await remove('workflows', projectId);
    setProjects(prev => prev.filter(p => p.id !== projectId));
    if (currentProject?.id === projectId) {
      setCurrentProject(null);
    }
  }, [currentProject]);

  // 阶段 1: 生成脚本和风格圣经
  const generateScript = useCallback(async () => {
    if (!currentProject) return;
    
    setLoading(true);
    setLoadingMessage(t('编剧正在创作脚本和风格圣经...'));
    abortRef.current = new AbortController();
    
    try {
      const response = await request('chat/completions', { method: 'POST', signal: abortRef.current.signal, body: JSON.stringify({ action: 'workflow-script', idea: currentProject.idea, targetLength: currentProject.targetLength || 30, elements: currentProject.elements }) });
      const json = await response.json();
      const content = json.choices?.[0]?.message?.content;
      if (!content) throw new Error(t('未收到编剧输出'));

      let scriptData;
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error(t('输出中未找到 JSON 格式'));
        scriptData = JSON.parse(jsonMatch[0]);
      } catch (e) {
        throw new Error(t('编剧输出的 JSON 格式无效'));
      }

      if (!scriptData.script || !scriptData.styleBible) {
        throw new Error(t('脚本或风格圣经缺失'));
      }
      
      await saveProject({
        ...currentProject,
        stage: 'script',
        script: scriptData.script,
        title: scriptData.title || currentProject.title,
        styleBible: scriptData.styleBible,
      });
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        onError(publicServiceError(error.message));
      }
    } finally {
      setLoading(false);
      setLoadingMessage('');
      abortRef.current = null;
    }
  }, [currentProject, saveProject, onError]);

  // 阶段 2: 生成分镜列表
  const generateShotList = useCallback(async () => {
    if (!currentProject?.script || !currentProject.styleBible) return;
    
    setLoading(true);
    setLoadingMessage(t('导演正在规划分镜...'));
    abortRef.current = new AbortController();
    
    try {
      const response = await request('chat/completions', { method: 'POST', signal: abortRef.current.signal, body: JSON.stringify({ action: 'workflow-shots', script: currentProject.script, styleBible: currentProject.styleBible, targetLength: currentProject.targetLength || 30, elements: currentProject.elements }) });
      const json = await response.json();
      const content = json.choices?.[0]?.message?.content;
      if (!content) throw new Error(t('未收到导演输出'));

      let shotsData;
      try {
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (!jsonMatch) throw new Error(t('输出中未找到 JSON 数组'));
        shotsData = JSON.parse(jsonMatch[0]);
      } catch (e) {
        throw new Error(t('导演输出的 JSON 格式无效'));
      }
      
      const shots = validateShotList(shotsData, currentProject.elements);
      
      await saveProject({
        ...currentProject,
        stage: 'shotlist',
        shots,
      });
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        onError(publicServiceError(error.message));
      }
    } finally {
      setLoading(false);
      setLoadingMessage('');
      abortRef.current = null;
    }
  }, [currentProject, saveProject, onError]);

  // 阶段 3: 生成关键帧
  const generateKeyframes = useCallback(async (regenerateShotId?: string) => {
    if (!currentProject?.shots || !currentProject.styleBible) return;
    
    let shotsToGenerate: Shot[];
    if (regenerateShotId) {
      shotsToGenerate = currentProject.shots.filter(s => s.id === regenerateShotId);
    } else {
      shotsToGenerate = currentProject.shots.filter(s => !s.keyframeStatus || s.keyframeStatus === 'failed');
    }
    
    if (shotsToGenerate.length === 0) {
      await saveProject({ ...currentProject, stage: 'keyframes' });
      return;
    }
    
    const approved = await onRequestQuota('image', shotsToGenerate.length);
    if (!approved) return;
    
    setLoading(true);
    abortRef.current = new AbortController();
    
    try {
      const updatedShots = [...currentProject.shots];
      
      for (let i = 0; i < updatedShots.length; i++) {
        const shot = updatedShots[i];
        if (!shotsToGenerate.find(s => s.id === shot.id)) continue;
        
        setLoadingMessage(t('生成关键帧 {index}/{total}...', { index: shot.number, total: updatedShots.length }));
        
        updatedShots[i] = { ...shot, keyframeStatus: 'pending' };
        await saveProject({ ...currentProject, shots: updatedShots });
        
        try {
          const context = { action: 'workflow-keyframe', shot, styleBible: currentProject.styleBible, elements: currentProject.elements };
          const response = await generateImage({
            prompt: '', context,
            imageSize: '1K',
            aspectRatio: '16:9',
            signal: abortRef.current.signal,
          });
          
          const json = await response.json();
          const outputs = mediaOutputs(json, 'image');
          
          if (outputs.length === 0) {
            throw new Error(t('未生成关键帧图片'));
          }
          
          const output = outputs[0];
          let blob: Blob;
          let url: string;
          
          if (output.base64) {
            blob = base64Blob(output.base64, output.mime);
            url = URL.createObjectURL(blob);
          } else if (output.url) {
            url = safeMediaURL(output.url);
            const r = await fetch(url);
            blob = await r.blob();
          } else {
            throw new Error(t('关键帧数据格式无效'));
          }
          
          updatedShots[i] = {
            ...shot,
            keyframeBlob: blob,
            keyframeUrl: url,
            keyframeStatus: 'completed',
            keyframeError: undefined,
          };
        } catch (error: any) {
          if (error.name === 'AbortError') throw error;
          updatedShots[i] = {
            ...shot,
            keyframeStatus: 'failed',
            keyframeError: publicServiceError(error.message),
          };
        }
        
        await saveProject({ ...currentProject, shots: updatedShots });
      }
      
      const allCompleted = updatedShots.every(s => s.keyframeStatus === 'completed');
      if (allCompleted && !regenerateShotId) {
        await saveProject({ ...currentProject, stage: 'keyframes', shots: updatedShots });
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        onError(publicServiceError(error.message));
      }
    } finally {
      setLoading(false);
      setLoadingMessage('');
      abortRef.current = null;
    }
  }, [currentProject, onRequestQuota, saveProject, onError]);

  // 阶段 4: 生成视频
  const generateVideos = useCallback(async (regenerateShotId?: string) => {
    if (!currentProject?.shots || !currentProject.styleBible) return;
    
    let shotsToGenerate: Shot[];
    if (regenerateShotId) {
      shotsToGenerate = currentProject.shots.filter(s => s.id === regenerateShotId);
    } else {
      shotsToGenerate = currentProject.shots.filter(s => !s.videoStatus || s.videoStatus === 'failed');
    }
    
    if (shotsToGenerate.length === 0) {
      await saveProject({ ...currentProject, stage: 'videos' });
      return;
    }
    
    // 计算实际生成次数（连续长镜头模式）
    const isOmni = videoEngineMode === 'task';
    let generationCount = shotsToGenerate.length;
    
    if (currentProject.useContinuousShot && isOmni && AI_VIDEO_OMNI_ASYNC) {
      const { totalGenerations } = planContinuousShots(shotsToGenerate, AI_VIDEO_EXTEND_MAX_SECONDS);
      generationCount = totalGenerations;
    }
    
    const approved = await onRequestQuota('video', generationCount);
    if (!approved) return;
    
    setLoading(true);
    abortRef.current = new AbortController();
    const videoMode = videoEngineMode;
    
    try {
      const updatedShots = [...currentProject.shots];
      
      // 连续长镜头模式
      if (currentProject.useContinuousShot && isOmni && AI_VIDEO_OMNI_ASYNC) {
        const { segments } = planContinuousShots(shotsToGenerate, AI_VIDEO_EXTEND_MAX_SECONDS);
        
        for (const segment of segments) {
          let extendFrom: string | undefined;
          let accumulatedDuration = 0;
          
          for (const shot of segment) {
            const shotIndex = updatedShots.findIndex(s => s.id === shot.id);
            if (shotIndex === -1) continue;
            
            accumulatedDuration += shot.duration;
            const segmentsNeeded = Math.ceil(accumulatedDuration / OMNI_SEGMENT_DURATION);
            
            setLoadingMessage(t('连续长镜头：生成镜头 {index}/{total} ({seconds} 秒)...', { index: shot.number, total: updatedShots.length, seconds: segmentsNeeded * OMNI_SEGMENT_DURATION }));
            
            updatedShots[shotIndex] = { ...shot, videoStatus: 'pending' };
            await saveProject({ ...currentProject, shots: updatedShots });
            
            try {
              const hasKeyframe = !!shot.keyframeBlob && AI_VIDEO_IMAGE_INPUT && !extendFrom;
              const context = { action: 'workflow-video', shot, styleBible: currentProject.styleBible, hasKeyframe, elements: currentProject.elements };
              
              const response = await generateVideo({
                prompt: '', context,
                options: {
                  aspect_ratio: '16:9',
                  resolution: '720p',
                },
                signal: abortRef.current.signal,
                mode: videoMode,
                inputImage: hasKeyframe ? shot.keyframeBlob : undefined,
                extendFrom,
              });
              
              const json = await response.json();
              if (!json.id) throw new Error(t('未返回视频任务 ID'));
              
              extendFrom = json.id;
              updatedShots[shotIndex] = { ...shot, videoRemoteId: json.id, videoStatus: 'pending' };
              await saveProject({ ...currentProject, shots: updatedShots });
              
              // 轮询任务状态
              let attempts = 0;
              const maxAttempts = 120;
              
              while (attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                attempts++;
                
                const statusResponse = await request(`videos/${json.id}`, {
                  signal: abortRef.current?.signal,
                });
                const status = await statusResponse.json();
                
                if (status.status === 'completed') {
                  const blob = await videoContent(json.id, abortRef.current?.signal);
                  const url = URL.createObjectURL(blob);
                  
                  updatedShots[shotIndex] = {
                    ...shot,
                    videoBlob: blob,
                    videoUrl: url,
                    videoStatus: 'completed',
                    videoError: undefined,
                    videoRemoteId: json.id,
                  };
                  break;
                } else if (status.status === 'failed') {
                  throw new Error(status.error?.message || t('视频生成失败'));
                }
                
                if (attempts >= maxAttempts) {
                  throw new Error(t('视频生成超时'));
                }
              }
            } catch (error: any) {
              if (error.name === 'AbortError') throw error;
              
              // 处理 429 限流
              if (error.status === 429) {
                const retryAfter = parseRetryAfter(error.headers?.get?.('Retry-After'));
                const waitMessage = retryAfter
                  ? t('请等待 {seconds} 秒后重试', { seconds: retryAfter })
                  : t('已达到每日额度上限，请明天再试');
                updatedShots[shotIndex] = {
                  ...shot,
                  videoStatus: 'failed',
                  videoError: t('视频生成额度已用完。{message}', { message: waitMessage }),
                };
              } else {
                updatedShots[shotIndex] = {
                  ...shot,
                  videoStatus: 'failed',
                  videoError: publicServiceError(error.message),
                };
              }
            }
            
            await saveProject({ ...currentProject, shots: updatedShots });
          }
        }
      } else {
        // 普通模式：并发生成（限制并发数）
        const pending = [...shotsToGenerate];
        const running: Promise<void>[] = [];
        
        while (pending.length > 0 || running.length > 0) {
          while (running.length < MAX_CONCURRENCY && pending.length > 0) {
            const shot = pending.shift()!;
            const shotIndex = updatedShots.findIndex(s => s.id === shot.id);
            if (shotIndex === -1) continue;
            
            const task = (async () => {
              setLoadingMessage(t('生成视频 {index}/{total}...', { index: shot.number, total: updatedShots.length }));
              
              updatedShots[shotIndex] = { ...shot, videoStatus: 'pending' };
              await saveProject({ ...currentProject, shots: updatedShots });
              
              try {
                const hasKeyframe = !!shot.keyframeBlob && AI_VIDEO_IMAGE_INPUT;
                const context = { action: 'workflow-video', shot, styleBible: currentProject.styleBible, hasKeyframe, elements: currentProject.elements };
                
                const response = await generateVideo({
                  prompt: '', context,
                  options: {
                    aspect_ratio: '16:9',
                    seconds: Math.min(Math.max(shot.duration, 4), 8),
                    resolution: '720p',
                  },
                  signal: abortRef.current?.signal,
                  mode: videoMode,
                  inputImage: hasKeyframe ? shot.keyframeBlob : undefined,
                });
                
                if (videoMode === 'task') {
                  const json = await response.json();
                  if (!json.id) throw new Error(t('未返回视频任务 ID'));
                  
                  updatedShots[shotIndex] = { ...shot, videoRemoteId: json.id, videoStatus: 'pending' };
                  await saveProject({ ...currentProject, shots: updatedShots });
                  
                  let attempts = 0;
                  const maxAttempts = 120;
                  
                  while (attempts < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    attempts++;
                    
                    const statusResponse = await request(`videos/${json.id}`, {
                      signal: abortRef.current?.signal,
                    });
                    const status = await statusResponse.json();
                    
                    if (status.status === 'completed') {
                      const blob = await videoContent(json.id, abortRef.current?.signal);
                      const url = URL.createObjectURL(blob);
                      
                      updatedShots[shotIndex] = {
                        ...shot,
                        videoBlob: blob,
                        videoUrl: url,
                        videoStatus: 'completed',
                        videoError: undefined,
                        videoRemoteId: json.id,
                      };
                      break;
                    } else if (status.status === 'failed') {
                      throw new Error(status.error?.message || t('视频生成失败'));
                    }
                    
                    if (attempts >= maxAttempts) {
                      throw new Error(t('视频生成超时'));
                    }
                  }
                } else {
                  const json = await response.json();
                  const outputs = mediaOutputs(json, 'video');
                  
                  if (outputs.length === 0) {
                    throw new Error(t('未生成视频'));
                  }
                  
                  const output = outputs[0];
                  let blob: Blob;
                  let url: string;
                  
                  if (output.base64) {
                    blob = base64Blob(output.base64, output.mime);
                    url = URL.createObjectURL(blob);
                  } else if (output.url) {
                    url = safeMediaURL(output.url);
                    const r = await fetch(url);
                    blob = await r.blob();
                  } else {
                    throw new Error(t('视频数据格式无效'));
                  }
                  
                  updatedShots[shotIndex] = {
                    ...shot,
                    videoBlob: blob,
                    videoUrl: url,
                    videoStatus: 'completed',
                    videoError: undefined,
                  };
                }
              } catch (error: any) {
                if (error.name === 'AbortError') throw error;
                
                if (error.status === 429) {
                  const retryAfter = parseRetryAfter(error.headers?.get?.('Retry-After'));
                  const waitMessage = retryAfter
                    ? t('请等待 {seconds} 秒后重试', { seconds: retryAfter })
                    : t('已达到每日额度上限，请明天再试');
                  updatedShots[shotIndex] = {
                    ...shot,
                    videoStatus: 'failed',
                    videoError: t('视频生成额度已用完。{message}', { message: waitMessage }),
                  };
                } else {
                  updatedShots[shotIndex] = {
                    ...shot,
                    videoStatus: 'failed',
                    videoError: publicServiceError(error.message),
                  };
                }
              }
              
              await saveProject({ ...currentProject, shots: updatedShots });
            })();
            
            running.push(task);
          }
          
          if (running.length > 0) {
            await Promise.race(running);
            const idx = running.findIndex(p => 
              (p as any).status === 'fulfilled' || (p as any).status === 'rejected'
            );
            if (idx !== -1) running.splice(idx, 1);
          }
        }
      }
      
      const allCompleted = updatedShots.every(s => s.videoStatus === 'completed');
      if (allCompleted && !regenerateShotId) {
        await saveProject({ ...currentProject, stage: 'videos', shots: updatedShots });
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        onError(publicServiceError(error.message));
      }
    } finally {
      setLoading(false);
      setLoadingMessage('');
      abortRef.current = null;
    }
  }, [currentProject, videoEngineMode, onRequestQuota, saveProject, onError]);

  // 阶段 5: 生成配乐
  const generateMusicTrack = useCallback(async () => {
    if (!currentProject?.script || !currentProject.styleBible || !currentProject.shots) return;
    
    const approved = await onRequestQuota('music', 1);
    if (!approved) return;
    
    setLoading(true);
    setLoadingMessage(t('作曲中...'));
    abortRef.current = new AbortController();
    
    try {
      const totalDuration = calculateTotalDuration(currentProject.shots);
      const context = { action: 'workflow-music', script: currentProject.script, styleBible: currentProject.styleBible, duration: totalDuration };
      
      const response = await generateAudio({
        prompt: '', context,
        duration: totalDuration,
        signal: abortRef.current.signal,
      });
      
      const json = await response.json();
      const outputs = mediaOutputs(json, 'music');
      
      if (outputs.length === 0) {
        throw new Error(t('未生成音乐'));
      }
      
      const output = outputs[0];
      let blob: Blob;
      let url: string;
      
      if (output.base64) {
        blob = base64Blob(output.base64, output.mime);
        url = URL.createObjectURL(blob);
      } else if (output.url) {
        url = safeMediaURL(output.url);
        const r = await fetch(url);
        blob = await r.blob();
      } else {
        throw new Error(t('音乐数据格式无效'));
      }
      
      // 读取音频时长
      const audio = new Audio();
      audio.src = url;
      await new Promise((resolve, reject) => {
        audio.addEventListener('loadedmetadata', resolve);
        audio.addEventListener('error', reject);
      });
      
      await saveProject({
        ...currentProject,
        stage: 'music',
        musicBlob: blob,
        musicUrl: url,
        musicStatus: 'completed',
      });
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        await saveProject({
          ...currentProject,
          musicStatus: 'failed',
          musicError: publicServiceError(error.message),
        });
        onError(publicServiceError(error.message));
      }
    } finally {
      setLoading(false);
      setLoadingMessage('');
      abortRef.current = null;
    }
  }, [currentProject, onRequestQuota, saveProject, onError]);

  // 阶段 6: 合成成片
  const assembleFinal = useCallback(async (includeSubtitles: boolean) => {
    if (!currentProject?.shots) return;
    
    setLoading(true);
    setLoadingMessage(t('准备合成...'));
    
    try {
      const completedShots = currentProject.shots.filter(s => s.videoBlob && s.videoStatus === 'completed');
      
      if (completedShots.length === 0) {
        throw new Error(t('没有可用的视频镜头'));
      }
      
      const totalDuration = calculateTotalDuration(completedShots);
      
      const finalBlob = await assembleVideo({
        shots: completedShots,
        musicBlob: currentProject.musicBlob,
        musicDuration: currentProject.musicBlob ? totalDuration : undefined,
        includeSubtitles,
        targetResolution: '720p',
        targetFPS: 30,
        onProgress: (message) => {
          setLoadingMessage(message);
        },
      });
      
      const url = URL.createObjectURL(finalBlob);
      
      await saveProject({
        ...currentProject,
        stage: 'complete',
        finalVideoBlob: finalBlob,
        finalVideoUrl: url,
        finalVideoStatus: 'completed',
      });
    } catch (error: any) {
      await saveProject({
        ...currentProject,
        finalVideoStatus: 'failed',
        finalVideoError: error.message,
      });
      onError(error.message);
    } finally {
      setLoading(false);
      setLoadingMessage('');
    }
  }, [currentProject, saveProject, onError]);

  // 取消操作
  const handleCancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setLoading(false);
    setLoadingMessage('');
  }, []);

  // 下载成片
  const downloadFinalVideo = useCallback(() => {
    if (!currentProject?.finalVideoBlob) return;
    
    const url = URL.createObjectURL(currentProject.finalVideoBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentProject.title}.mp4`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [currentProject]);

  // 渲染项目列表
  if (!currentProject) {
    return (
      <div className="workflow-container">
        <div className="workflow-header">
          <h2>{t('短片工坊')}</h2>
          <p className="workflow-subtitle">{t('把人物、场景和灵感，拖进你的故事')}</p>
        </div>

        <div className="workflow-projects">
          <form className="wf-create-project" onSubmit={event => { event.preventDefault(); if (newIdea.trim()) void handleCreateProject(newIdea.trim(), newDuration).catch(() => onError(t('创建项目失败，请重试。'))); }}>
            <div className="wf-create-icon"><Film size={28} /></div>
            <h3>{t('开始一个新故事')}</h3>
            <p>{t('写下一句话创意，交给 AI 构思，或自己动手搭建分镜。')}</p>
            <label htmlFor="workflow-idea">{t('故事创意')}</label>
            <textarea id="workflow-idea" value={newIdea} onChange={event => setNewIdea(event.target.value)} placeholder={t('例如：一个穿黄色雨衣的女孩，在雨后的老街找到一封来自未来的信…')} rows={3} required />
            <div className="wf-create-footer"><label>{t('目标时长')}<select value={newDuration} onChange={event => setNewDuration(Number(event.target.value))}><option value={15}>{t('{seconds} 秒', { seconds: 15 })}</option><option value={30}>{t('{seconds} 秒', { seconds: 30 })}</option><option value={60}>{t('{seconds} 秒', { seconds: 60 })}</option><option value={90}>{t('{seconds} 秒', { seconds: 90 })}</option></select></label><button type="submit" className="workflow-action-primary" disabled={!newIdea.trim()}><Plus size={17} />{t('创建短片')}</button></div>
          </form>
          
          {projects.length > 0 && (
            <div className="workflow-project-list">
              <h3>{t('我的短片')}</h3>
              {projects.map(project => (
                <div key={project.id} className="workflow-project-card">
                  <div className="workflow-project-info">
                    <h4>{project.title}</h4>
                    <p>{STAGE_LABELS[project.stage]}</p>
                    <span className="workflow-project-time">
                      {new Date(project.updatedAt).toLocaleString(intlLocale())}
                    </span>
                  </div>
                  <div className="workflow-project-actions">
                    <button onClick={() => setCurrentProject(project)}>
                      {t('继续')}
                    </button>
                    <button aria-label={t('删除项目：{title}', { title: project.title })} onClick={() => void handleDeleteProject(project.id).catch(() => onError(t('删除项目失败，请重试。')))}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const pending = countPendingGenerations(currentProject.shots || []);
  const isOmni = videoEngineMode === 'task';
  
  // 计算连续长镜头模式的生成次数
  let continuousGenerations = 0;
  if (currentProject.useContinuousShot && isOmni && AI_VIDEO_OMNI_ASYNC && currentProject.shots) {
    const shotsToGenerate = currentProject.shots.filter(s => !s.videoStatus || s.videoStatus === 'failed');
    if (shotsToGenerate.length > 0) {
      const { totalGenerations } = planContinuousShots(shotsToGenerate, AI_VIDEO_EXTEND_MAX_SECONDS);
      continuousGenerations = totalGenerations;
    }
  }

  // 渲染当前项目
  return (
    <div className="workflow-container workflow-editor-page">
      <div className="workflow-header">
        <button disabled={loading} onClick={() => setCurrentProject(null)} className="workflow-back">
          <ChevronLeft size={20} />
          {t('返回列表')}
        </button>
        <h2>{currentProject.title}</h2>
        <div className="wf-project-meta"><p className="workflow-stage">{STAGE_LABELS[currentProject.stage]}</p><span role="status">{saveState === 'saving' ? t('保存中…') : saveState === 'failed' ? t('保存失败') : t('已自动保存')}</span>{saveState === 'failed' && <button className="wf-small-button" onClick={() => saveBoard(currentProject)}>{t('重试保存')}</button>}</div>
      </div>
      
      {loading && (
        <div className="workflow-loading">
          <div className="workflow-loading-spinner" />
          <p>{loadingMessage}</p>
          <button onClick={handleCancel} className="workflow-cancel">
            {t('取消')}
          </button>
        </div>
      )}
      
      {!loading && (
        <div className="workflow-content">
          <WorkflowBoard key={currentProject.id} project={currentProject} onChange={saveBoard} />
          {currentProject.stage === 'init' && (
            <div className="workflow-stage-init">
              <h3>{t('创意')}</h3>
              <p>{currentProject.idea}</p>
              <p>{t('目标时长：{seconds} 秒', { seconds: currentProject.targetLength ?? '' })}</p>
              <button onClick={generateScript} className="workflow-action-primary">
                {t('开始创作 - 生成脚本')}
              </button>
            </div>
          )}
          
          {currentProject.stage === 'script' && currentProject.script && currentProject.styleBible && (
            <div className="workflow-stage-script">
              <h3>{t('脚本')}</h3>
              <div className="workflow-script-content">
                <p>{currentProject.script}</p>
              </div>

              <h3>{t('风格圣经')}</h3>
              <div className="workflow-style-bible">
                <div><strong>{t('角色外观：')}</strong>{currentProject.styleBible.appearance}</div>
                <div><strong>{t('服装：')}</strong>{currentProject.styleBible.wardrobe}</div>
                <div><strong>{t('美术风格：')}</strong>{currentProject.styleBible.artStyle}</div>
                <div><strong>{t('色调：')}</strong>{currentProject.styleBible.palette}</div>
              </div>

              <button onClick={generateShotList} className="workflow-action-primary">
                {t('下一步 - 生成分镜')}
              </button>
            </div>
          )}
          
          {currentProject.stage === 'shotlist' && currentProject.shots && (
            <div className="workflow-stage-shotlist">
              <h3>{t('准备生成画面')}</h3>
              <p>
                {t('共 {count} 个镜头，总时长 {duration} 秒', { count: currentProject.shots.length, duration: calculateTotalDuration(currentProject.shots) })}
                {isOmni && AI_VIDEO_OMNI_ASYNC && (
                  <span className="workflow-note-inline">
                    {t('（连续镜头每段固定 {seconds} 秒）', { seconds: OMNI_SEGMENT_DURATION })}
                  </span>
                )}
              </p>
              
              {isOmni && AI_VIDEO_OMNI_ASYNC && (
                <label className="workflow-checkbox">
                  <input
                    type="checkbox"
                    checked={currentProject.useContinuousShot || false}
                    onChange={(e) => saveBoard({ ...currentProject, useContinuousShot: e.target.checked })}
                  />
                  <span>
                    {t('连续长镜头模式（最多 {seconds} 秒，使用 extend_from 保持连续性）', { seconds: AI_VIDEO_EXTEND_MAX_SECONDS })}
                  </span>
                </label>
              )}
              
              <div className="workflow-actions">
                <button disabled={!currentProject.shots.length || currentProject.shots.some(shot => !shot.sceneDescription.trim())} onClick={() => generateKeyframes()} className="workflow-action-primary">
                  {t('下一步 - 生成关键帧（{count} 个）', { count: pending.keyframes })}
                </button>
              </div>
              {(!currentProject.shots.length || currentProject.shots.some(shot => !shot.sceneDescription.trim())) && <p className="wf-hint">{t('添加镜头并填写每个镜头的画面描述后，即可生成关键帧。')}</p>}
            </div>
          )}
          
          {currentProject.stage === 'keyframes' && currentProject.shots && (
            <div className="workflow-stage-keyframes">
              <h3>{t('关键帧')}</h3>

              <div className="workflow-keyframes">
                {currentProject.shots.map((shot, i) => (
                  <div key={shot.id} className="workflow-keyframe-card">
                    <h4>{t('镜头 {number} ({duration}秒)', { number: shot.number, duration: shot.duration })}</h4>
                    {shot.keyframeUrl && shot.keyframeStatus === 'completed' && (
                      <img src={shot.keyframeUrl} alt={t('镜头 {number} 关键帧', { number: i + 1 })} />
                    )}
                    {shot.keyframeStatus === 'pending' && <p>{t('生成中...')}</p>}
                    {shot.keyframeStatus === 'failed' && (
                      <div className="workflow-error">
                        <AlertCircle size={16} />
                        <div>
                          <p>{shot.keyframeError}</p>
                          <button onClick={() => generateKeyframes(shot.id)}>{t('重新生成')}</button>
                        </div>
                      </div>
                    )}
                    <p className="workflow-shot-desc">{shot.sceneDescription}</p>
                  </div>
                ))}
              </div>
              
              <div className="workflow-actions">
                <button onClick={() => generateKeyframes()}>
                  {t('重新生成失败的关键帧')}
                </button>
                <button onClick={() => generateVideos()} className="workflow-action-primary">
                  {t('下一步 - 生成视频')}
                  {currentProject.useContinuousShot && continuousGenerations > 0 && (
                    <span> {t('({count} 次生成)', { count: continuousGenerations })}</span>
                  )}
                  {!currentProject.useContinuousShot && pending.videos > 0 && (
                    <span> {t('({count} 个)', { count: pending.videos })}</span>
                  )}
                </button>
              </div>

              {isOmni && generationLimit <= 5 && (
                <p className="workflow-warning">
                  {t('⚠️ Omni 每日额度有限（约 3-5 次），请谨慎使用。当前剩余额度：{remaining}', { remaining: generationLimit })}
                </p>
              )}
            </div>
          )}
          
          {currentProject.stage === 'videos' && currentProject.shots && (
            <div className="workflow-stage-videos">
              <h3>{t('镜头视频')}</h3>

              <div className="workflow-videos">
                {currentProject.shots.map((shot) => (
                  <div key={shot.id} className="workflow-video-card">
                    <h4>{t('镜头 {number} ({duration}秒)', { number: shot.number, duration: shot.duration })}</h4>
                    {shot.videoUrl && shot.videoStatus === 'completed' && (
                      <button
                        type="button"
                        className="workflow-play-media"
                        onClick={() => { setIsVideoExpanded(true); play({ id: `wf-${currentProject.id}-${shot.id}`, kind: 'video', src: shot.videoUrl!, title: t('镜头 {number} · {title}', { number: shot.number, title: currentProject.title }) }); }}
                      >
                        <Play size={16} />{t('播放镜头视频')}
                      </button>
                    )}
                    {shot.videoStatus === 'pending' && <p>{t('生成中...')}</p>}
                    {shot.videoStatus === 'failed' && (
                      <div className="workflow-error">
                        <AlertCircle size={16} />
                        <div>
                          <p>{shot.videoError}</p>
                          <button onClick={() => generateVideos(shot.id)}>{t('重新生成')}</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="workflow-actions">
                <button onClick={() => generateVideos()}>
                  {t('重新生成失败的视频')}
                </button>
                <button onClick={generateMusicTrack} className="workflow-action-primary">
                  {t('添加配乐（可选）')}
                </button>
                <button onClick={() => assembleFinal(false)}>
                  {t('跳过配乐，开始合成')}
                </button>
              </div>
            </div>
          )}
          
          {(currentProject.stage === 'music' || currentProject.stage === 'assembly') && (
            <div className="workflow-stage-assembly">
              <h3>{t('合成成片')}</h3>

              {currentProject.musicUrl && (
                <div className="workflow-music">
                  <h4>{t('背景音乐')}</h4>
                  <button
                    type="button"
                    className="workflow-play-media"
                    onClick={() => play({ id: `wf-music-${currentProject.id}`, kind: 'audio', src: currentProject.musicUrl!, title: t('背景音乐 · {title}', { title: currentProject.title }) })}
                  >
                    <Play size={16} />{t('播放背景音乐')}
                  </button>
                </div>
              )}

              <p>
                {t('准备合成 {count} 个镜头{music}', {
                  count: currentProject.shots?.filter(s => s.videoStatus === 'completed').length ?? 0,
                  music: currentProject.musicUrl ? t('和背景音乐') : '',
                })}
              </p>

              <div className="workflow-actions">
                <button onClick={() => assembleFinal(false)} className="workflow-action-primary">
                  {t('合成视频（无字幕）')}
                </button>
                <button onClick={() => assembleFinal(true)} className="workflow-action-primary">
                  {t('合成视频（含字幕）')}
                </button>
                {currentProject.shots && (
                  <button onClick={() => exportSRT(currentProject.shots!, currentProject.title)}>
                    {t('导出 SRT 字幕')}
                  </button>
                )}
              </div>
            </div>
          )}
          
          {currentProject.stage === 'complete' && (
            <div className="workflow-stage-complete">
              <h3>{t('🎉 工作流完成')}</h3>

              {currentProject.finalVideoUrl && currentProject.finalVideoStatus === 'completed' && (
                <div className="workflow-final-video">
                  <h4>{t('成片')}</h4>
                  <button
                    type="button"
                    className="workflow-play-media"
                    onClick={() => { setIsVideoExpanded(true); play({ id: `wf-final-${currentProject.id}`, kind: 'video', src: currentProject.finalVideoUrl!, title: t('成片 · {title}', { title: currentProject.title }) }); }}
                  >
                    <Play size={16} />{t('播放成片')}
                  </button>
                  <button onClick={downloadFinalVideo} className="workflow-download">
                    <Download size={16} />
                    {t('下载成片')}
                  </button>
                </div>
              )}
              
              {currentProject.finalVideoStatus === 'failed' && (
                <div className="workflow-error">
                  <AlertCircle size={16} />
                  <p>{currentProject.finalVideoError}</p>
                </div>
              )}
              
              <div className="workflow-final-shots">
                <h4>{t('所有镜头')}</h4>
                {currentProject.shots?.map((shot, i) => (
                  <div key={shot.id} className="workflow-final-shot">
                    <span>{t('镜头 {number}', { number: i + 1 })}</span>
                    {shot.videoUrl && (
                      <button
                        type="button"
                        className="workflow-play-media"
                        onClick={() => { setIsVideoExpanded(true); play({ id: `wf-final-shot-${currentProject.id}-${shot.id}`, kind: 'video', src: shot.videoUrl!, title: t('镜头 {number} · {title}', { number: i + 1, title: currentProject.title }) }); }}
                      >
                        <Play size={15} />{t('播放')}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
