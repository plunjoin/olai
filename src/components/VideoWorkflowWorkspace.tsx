import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowDown, ArrowUp, ChevronLeft, Copy, Download, Edit2, Film, Play, Plus, Save, Trash2, X } from 'lucide-react';
import {
  addShot,
  buildKeyframePrompt,
  buildMusicPrompt,
  buildScriptPrompt,
  buildShotListPrompt,
  buildVideoPrompt,
  calculateTotalDuration,
  countPendingGenerations,
  createWorkflowProject,
  duplicateShot,
  moveShot,
  parseRetryAfter,
  planContinuousShots,
  removeShot,
  type Shot,
  type StyleBible,
  type VideoWorkflowProject,
  type WorkflowStage,
  updateShot,
  validateShotList,
} from '../lib/videoWorkflow';
import { assembleVideo, exportSRT, planAssembly } from '../lib/videoAssembly';
import { base64Blob, generateAudio, generateImage, generateVideo, mediaOutputs, publicServiceError, request, safeMediaURL, videoContent } from '../lib/api';
import { OMNI_MAX_EXTEND_DURATION, OMNI_SEGMENT_DURATION, videoEngineForModel } from '../lib/video';
import { getAll, put, remove } from '../lib/storage';

interface VideoWorkflowWorkspaceProps {
  apiKey: string;
  chatModel: string;
  imageModel: string;
  videoModel: string;
  musicModel: string;
  generationLimit: number;
  onRequestQuota: (kind: 'image' | 'video' | 'music', count: number) => Promise<boolean>;
  onError: (message: string) => void;
}

const STAGE_LABELS: Record<WorkflowStage, string> = {
  init: '创意输入',
  script: '编剧',
  shotlist: '分镜',
  keyframes: '关键帧',
  videos: '视频生成',
  music: '配乐',
  assembly: '合成',
  complete: '完成',
};

// 环境变量配置
const AI_VIDEO_IMAGE_INPUT = import.meta.env.AI_VIDEO_IMAGE_INPUT === 'true';
const AI_VIDEO_OMNI_ASYNC = import.meta.env.AI_VIDEO_OMNI_ASYNC === 'true';
const AI_VIDEO_EXTEND_MAX_SECONDS = parseInt(import.meta.env.AI_VIDEO_EXTEND_MAX_SECONDS || '30', 10);
const MAX_CONCURRENCY = 2; // 限制并发数

export default function VideoWorkflowWorkspace({
  apiKey,
  chatModel,
  imageModel,
  videoModel,
  musicModel,
  generationLimit,
  onRequestQuota,
  onError,
}: VideoWorkflowWorkspaceProps) {
  const [projects, setProjects] = useState<VideoWorkflowProject[]>([]);
  const [currentProject, setCurrentProject] = useState<VideoWorkflowProject | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [editingShot, setEditingShot] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 加载项目列表
  useEffect(() => {
    getAll<VideoWorkflowProject>('workflows').then(setProjects).catch(console.error);
  }, []);

  // 保存项目
  const saveProject = useCallback(async (project: VideoWorkflowProject) => {
    const updated = { ...project, updatedAt: Date.now() };
    await put('workflows', updated);
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
  }, []);

  // 创建新项目
  const handleCreateProject = useCallback(async (idea: string, targetLength: number) => {
    const project = createWorkflowProject(idea, targetLength);
    await saveProject(project);
    setCurrentProject(project);
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
    setLoadingMessage('编剧正在创作脚本和风格圣经...');
    abortRef.current = new AbortController();
    
    try {
      const prompt = buildScriptPrompt(currentProject.idea, currentProject.targetLength || 30);
      const response = await request('chat/completions', apiKey, {
        method: 'POST',
        signal: abortRef.current.signal,
        body: JSON.stringify({
          model: chatModel,
          messages: [
            { role: 'system', content: '你是一位专业的短视频编剧。输出格式严格为 JSON，不要添加任何其他说明文字。' },
            { role: 'user', content: prompt },
          ],
          stream: false,
        }),
      });
      
      const json = await response.json();
      const content = json.choices?.[0]?.message?.content;
      if (!content) throw new Error('未收到编剧输出');
      
      let scriptData;
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('输出中未找到 JSON 格式');
        scriptData = JSON.parse(jsonMatch[0]);
      } catch (e) {
        throw new Error('编剧输出的 JSON 格式无效');
      }
      
      if (!scriptData.script || !scriptData.styleBible) {
        throw new Error('脚本或风格圣经缺失');
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
  }, [currentProject, apiKey, chatModel, saveProject, onError]);

  // 阶段 2: 生成分镜列表
  const generateShotList = useCallback(async () => {
    if (!currentProject?.script || !currentProject.styleBible) return;
    
    setLoading(true);
    setLoadingMessage('导演正在规划分镜...');
    abortRef.current = new AbortController();
    
    try {
      const prompt = buildShotListPrompt(
        currentProject.script,
        currentProject.styleBible,
        currentProject.targetLength || 30
      );
      
      const response = await request('chat/completions', apiKey, {
        method: 'POST',
        signal: abortRef.current.signal,
        body: JSON.stringify({
          model: chatModel,
          messages: [
            { role: 'system', content: '你是一位专业的短片导演。输出格式严格为 JSON 数组，不要添加任何其他说明文字。' },
            { role: 'user', content: prompt },
          ],
          stream: false,
        }),
      });
      
      const json = await response.json();
      const content = json.choices?.[0]?.message?.content;
      if (!content) throw new Error('未收到导演输出');
      
      let shotsData;
      try {
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (!jsonMatch) throw new Error('输出中未找到 JSON 数组');
        shotsData = JSON.parse(jsonMatch[0]);
      } catch (e) {
        throw new Error('导演输出的 JSON 格式无效');
      }
      
      const shots = validateShotList(shotsData);
      
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
  }, [currentProject, apiKey, chatModel, saveProject, onError]);

  // 镜头编辑操作
  const handleUpdateShot = useCallback(async (shotId: string, updates: Partial<Shot>) => {
    if (!currentProject?.shots) return;
    
    const updatedShots = currentProject.shots.map(s => 
      s.id === shotId ? updateShot(s, updates) : s
    );
    
    await saveProject({ ...currentProject, shots: updatedShots });
  }, [currentProject, saveProject]);

  const handleAddShot = useCallback(async (afterIndex: number) => {
    if (!currentProject?.shots) return;
    
    const updatedShots = addShot(currentProject.shots, afterIndex);
    await saveProject({ ...currentProject, shots: updatedShots });
  }, [currentProject, saveProject]);

  const handleDuplicateShot = useCallback(async (shotId: string) => {
    if (!currentProject?.shots) return;
    
    const index = currentProject.shots.findIndex(s => s.id === shotId);
    if (index === -1) return;
    
    const shot = currentProject.shots[index];
    const newShot = duplicateShot(shot, index + 2);
    const updatedShots = [
      ...currentProject.shots.slice(0, index + 1),
      newShot,
      ...currentProject.shots.slice(index + 1),
    ].map((s, i) => ({ ...s, number: i + 1 }));
    
    await saveProject({ ...currentProject, shots: updatedShots });
  }, [currentProject, saveProject]);

  const handleRemoveShot = useCallback(async (shotId: string) => {
    if (!currentProject?.shots) return;
    
    const updatedShots = removeShot(currentProject.shots, shotId);
    await saveProject({ ...currentProject, shots: updatedShots });
  }, [currentProject, saveProject]);

  const handleMoveShot = useCallback(async (shotId: string, direction: 'up' | 'down') => {
    if (!currentProject?.shots) return;
    
    const index = currentProject.shots.findIndex(s => s.id === shotId);
    if (index === -1) return;
    
    const toIndex = direction === 'up' ? index - 1 : index + 1;
    const updatedShots = moveShot(currentProject.shots, index, toIndex);
    
    await saveProject({ ...currentProject, shots: updatedShots });
  }, [currentProject, saveProject]);

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
        
        setLoadingMessage(`生成关键帧 ${shot.number}/${updatedShots.length}...`);
        
        updatedShots[i] = { ...shot, keyframeStatus: 'pending' };
        await saveProject({ ...currentProject, shots: updatedShots });
        
        try {
          const prompt = buildKeyframePrompt(shot, currentProject.styleBible!);
          const response = await generateImage({
            key: apiKey,
            model: imageModel,
            prompt,
            imageSize: '1K',
            aspectRatio: '16:9',
            signal: abortRef.current.signal,
          });
          
          const json = await response.json();
          const outputs = mediaOutputs(json, 'image');
          
          if (outputs.length === 0) {
            throw new Error('未生成关键帧图片');
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
            throw new Error('关键帧数据格式无效');
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
  }, [currentProject, apiKey, imageModel, onRequestQuota, saveProject, onError]);

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
    const isOmni = /omni/i.test(videoModel);
    let generationCount = shotsToGenerate.length;
    
    if (currentProject.useContinuousShot && isOmni && AI_VIDEO_OMNI_ASYNC) {
      const { totalGenerations } = planContinuousShots(shotsToGenerate, AI_VIDEO_EXTEND_MAX_SECONDS);
      generationCount = totalGenerations;
    }
    
    const approved = await onRequestQuota('video', generationCount);
    if (!approved) return;
    
    setLoading(true);
    abortRef.current = new AbortController();
    const videoMode = videoEngineForModel(videoModel, AI_VIDEO_OMNI_ASYNC);
    
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
            
            setLoadingMessage(`连续长镜头：生成镜头 ${shot.number}/${updatedShots.length} (${segmentsNeeded * OMNI_SEGMENT_DURATION}秒)...`);
            
            updatedShots[shotIndex] = { ...shot, videoStatus: 'pending' };
            await saveProject({ ...currentProject, shots: updatedShots });
            
            try {
              const hasKeyframe = !!shot.keyframeBlob && AI_VIDEO_IMAGE_INPUT && !extendFrom;
              const prompt = buildVideoPrompt(shot, currentProject.styleBible!, hasKeyframe);
              
              const response = await generateVideo({
                key: apiKey,
                model: videoModel,
                prompt,
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
              if (!json.id) throw new Error('未返回视频任务 ID');
              
              extendFrom = json.id;
              updatedShots[shotIndex] = { ...shot, videoRemoteId: json.id, videoStatus: 'pending' };
              await saveProject({ ...currentProject, shots: updatedShots });
              
              // 轮询任务状态
              let attempts = 0;
              const maxAttempts = 120;
              
              while (attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                attempts++;
                
                const statusResponse = await request(`videos/${json.id}`, apiKey, {
                  signal: abortRef.current?.signal,
                });
                const status = await statusResponse.json();
                
                if (status.status === 'completed') {
                  const blob = await videoContent(json.id, apiKey, abortRef.current?.signal);
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
                  throw new Error(status.error?.message || '视频生成失败');
                }
                
                if (attempts >= maxAttempts) {
                  throw new Error('视频生成超时');
                }
              }
            } catch (error: any) {
              if (error.name === 'AbortError') throw error;
              
              // 处理 429 限流
              if (error.status === 429) {
                const retryAfter = parseRetryAfter(error.headers?.get?.('Retry-After'));
                const waitMessage = retryAfter 
                  ? `请等待 ${retryAfter} 秒后重试` 
                  : '已达到每日额度上限，请明天再试';
                updatedShots[shotIndex] = {
                  ...shot,
                  videoStatus: 'failed',
                  videoError: `视频生成额度已用完。${waitMessage}`,
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
              setLoadingMessage(`生成视频 ${shot.number}/${updatedShots.length}...`);
              
              updatedShots[shotIndex] = { ...shot, videoStatus: 'pending' };
              await saveProject({ ...currentProject, shots: updatedShots });
              
              try {
                const hasKeyframe = !!shot.keyframeBlob && AI_VIDEO_IMAGE_INPUT;
                const prompt = buildVideoPrompt(shot, currentProject.styleBible!, hasKeyframe);
                
                const response = await generateVideo({
                  key: apiKey,
                  model: videoModel,
                  prompt,
                  options: {
                    aspect_ratio: '16:9',
                    seconds: Math.min(Math.max(shot.duration, 4), 8),
                    resolution: '720p',
                  },
                  signal: abortRef.current.signal,
                  mode: videoMode,
                  inputImage: hasKeyframe ? shot.keyframeBlob : undefined,
                });
                
                if (videoMode === 'task') {
                  const json = await response.json();
                  if (!json.id) throw new Error('未返回视频任务 ID');
                  
                  updatedShots[shotIndex] = { ...shot, videoRemoteId: json.id, videoStatus: 'pending' };
                  await saveProject({ ...currentProject, shots: updatedShots });
                  
                  let attempts = 0;
                  const maxAttempts = 120;
                  
                  while (attempts < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    attempts++;
                    
                    const statusResponse = await request(`videos/${json.id}`, apiKey, {
                      signal: abortRef.current?.signal,
                    });
                    const status = await statusResponse.json();
                    
                    if (status.status === 'completed') {
                      const blob = await videoContent(json.id, apiKey, abortRef.current?.signal);
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
                      throw new Error(status.error?.message || '视频生成失败');
                    }
                    
                    if (attempts >= maxAttempts) {
                      throw new Error('视频生成超时');
                    }
                  }
                } else {
                  const json = await response.json();
                  const outputs = mediaOutputs(json, 'video');
                  
                  if (outputs.length === 0) {
                    throw new Error('未生成视频');
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
                    throw new Error('视频数据格式无效');
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
                    ? `请等待 ${retryAfter} 秒后重试` 
                    : '已达到每日额度上限，请明天再试';
                  updatedShots[shotIndex] = {
                    ...shot,
                    videoStatus: 'failed',
                    videoError: `视频生成额度已用完。${waitMessage}`,
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
  }, [currentProject, apiKey, videoModel, onRequestQuota, saveProject, onError]);

  // 阶段 5: 生成配乐
  const generateMusicTrack = useCallback(async () => {
    if (!currentProject?.script || !currentProject.styleBible || !currentProject.shots) return;
    
    const approved = await onRequestQuota('music', 1);
    if (!approved) return;
    
    setLoading(true);
    setLoadingMessage('作曲中...');
    abortRef.current = new AbortController();
    
    try {
      const totalDuration = calculateTotalDuration(currentProject.shots);
      const prompt = buildMusicPrompt(currentProject.script, currentProject.styleBible, totalDuration);
      
      const response = await generateAudio({
        key: apiKey,
        model: musicModel,
        prompt,
        duration: totalDuration,
        signal: abortRef.current.signal,
      });
      
      const json = await response.json();
      const outputs = mediaOutputs(json, 'music');
      
      if (outputs.length === 0) {
        throw new Error('未生成音乐');
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
        throw new Error('音乐数据格式无效');
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
  }, [currentProject, apiKey, musicModel, onRequestQuota, saveProject, onError]);

  // 阶段 6: 合成成片
  const assembleFinal = useCallback(async (includeSubtitles: boolean) => {
    if (!currentProject?.shots) return;
    
    setLoading(true);
    setLoadingMessage('准备合成...');
    
    try {
      const completedShots = currentProject.shots.filter(s => s.videoBlob && s.videoStatus === 'completed');
      
      if (completedShots.length === 0) {
        throw new Error('没有可用的视频镜头');
      }
      
      const totalDuration = calculateTotalDuration(completedShots);
      
      const finalBlob = await assembleVideo({
        shots: completedShots,
        musicBlob: currentProject.musicBlob,
        musicDuration: currentProject.musicBlob ? totalDuration : undefined,
        includeSubtitles,
        targetResolution: '720p',
        targetFPS: 30,
        onProgress: (message, percent) => {
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
          <h2>视频工作流 / 短片工坊</h2>
          <p className="workflow-subtitle">从一句话创意到完整短片</p>
        </div>
        
        <div className="workflow-projects">
          <button
            className="workflow-new-project"
            onClick={() => {
              const idea = prompt('输入你的创意（一句话）：');
              if (idea) handleCreateProject(idea, 30);
            }}
          >
            <Plus size={24} />
            <span>创建新工作流</span>
          </button>
          
          {projects.length > 0 && (
            <div className="workflow-project-list">
              <h3>我的工作流项目</h3>
              {projects.map(project => (
                <div key={project.id} className="workflow-project-card">
                  <div className="workflow-project-info">
                    <h4>{project.title}</h4>
                    <p>{STAGE_LABELS[project.stage]}</p>
                    <span className="workflow-project-time">
                      {new Date(project.updatedAt).toLocaleString('zh-CN')}
                    </span>
                  </div>
                  <div className="workflow-project-actions">
                    <button onClick={() => setCurrentProject(project)}>
                      继续
                    </button>
                    <button onClick={() => handleDeleteProject(project.id)}>
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
  const isOmni = /omni/i.test(videoModel);
  
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
    <div className="workflow-container">
      <div className="workflow-header">
        <button onClick={() => setCurrentProject(null)} className="workflow-back">
          <ChevronLeft size={20} />
          返回列表
        </button>
        <h2>{currentProject.title}</h2>
        <p className="workflow-stage">{STAGE_LABELS[currentProject.stage]}</p>
      </div>
      
      {loading && (
        <div className="workflow-loading">
          <div className="workflow-loading-spinner" />
          <p>{loadingMessage}</p>
          <button onClick={handleCancel} className="workflow-cancel">
            取消
          </button>
        </div>
      )}
      
      {!loading && (
        <div className="workflow-content">
          {currentProject.stage === 'init' && (
            <div className="workflow-stage-init">
              <h3>创意</h3>
              <p>{currentProject.idea}</p>
              <p>目标时长：{currentProject.targetLength} 秒</p>
              <button onClick={generateScript} className="workflow-action-primary">
                开始创作 - 生成脚本
              </button>
            </div>
          )}
          
          {currentProject.stage === 'script' && currentProject.script && currentProject.styleBible && (
            <div className="workflow-stage-script">
              <h3>脚本</h3>
              <div className="workflow-script-content">
                <p>{currentProject.script}</p>
              </div>
              
              <h3>风格圣经</h3>
              <div className="workflow-style-bible">
                <div><strong>角色外观：</strong>{currentProject.styleBible.appearance}</div>
                <div><strong>服装：</strong>{currentProject.styleBible.wardrobe}</div>
                <div><strong>美术风格：</strong>{currentProject.styleBible.artStyle}</div>
                <div><strong>色调：</strong>{currentProject.styleBible.palette}</div>
              </div>
              
              <button onClick={generateShotList} className="workflow-action-primary">
                下一步 - 生成分镜
              </button>
            </div>
          )}
          
          {currentProject.stage === 'shotlist' && currentProject.shots && (
            <div className="workflow-stage-shotlist">
              <h3>分镜列表 - 可编辑</h3>
              <p>
                共 {currentProject.shots.length} 个镜头，总时长 {calculateTotalDuration(currentProject.shots)} 秒
                {isOmni && AI_VIDEO_OMNI_ASYNC && (
                  <span className="workflow-note-inline">
                    （Omni 每段固定 {OMNI_SEGMENT_DURATION} 秒）
                  </span>
                )}
              </p>
              
              {isOmni && AI_VIDEO_OMNI_ASYNC && (
                <label className="workflow-checkbox">
                  <input
                    type="checkbox"
                    checked={currentProject.useContinuousShot || false}
                    onChange={(e) => saveProject({ ...currentProject, useContinuousShot: e.target.checked })}
                  />
                  <span>
                    连续长镜头模式（最多 {AI_VIDEO_EXTEND_MAX_SECONDS} 秒，使用 extend_from 保持连续性）
                  </span>
                </label>
              )}
              
              <div className="workflow-shots">
                {currentProject.shots.map((shot, i) => (
                  <div key={shot.id} className="workflow-shot-edit-card">
                    <div className="workflow-shot-header">
                      <h4>镜头 {shot.number}</h4>
                      <div className="workflow-shot-actions">
                        {i > 0 && (
                          <button onClick={() => handleMoveShot(shot.id, 'up')} title="上移">
                            <ArrowUp size={16} />
                          </button>
                        )}
                        {i < currentProject.shots!.length - 1 && (
                          <button onClick={() => handleMoveShot(shot.id, 'down')} title="下移">
                            <ArrowDown size={16} />
                          </button>
                        )}
                        <button onClick={() => handleDuplicateShot(shot.id)} title="复制">
                          <Copy size={16} />
                        </button>
                        <button onClick={() => handleRemoveShot(shot.id)} title="删除">
                          <Trash2 size={16} />
                        </button>
                        <button onClick={() => setEditingShot(editingShot === shot.id ? null : shot.id)} title="编辑">
                          <Edit2 size={16} />
                        </button>
                      </div>
                    </div>
                    
                    {editingShot === shot.id ? (
                      <div className="workflow-shot-edit-form">
                        <label>
                          时长（秒）：
                          <input
                            type="number"
                            min="3"
                            max="30"
                            step="0.5"
                            value={shot.duration}
                            onChange={(e) => handleUpdateShot(shot.id, { duration: parseFloat(e.target.value) })}
                          />
                        </label>
                        <label>
                          景别：
                          <input
                            type="text"
                            value={shot.framing}
                            onChange={(e) => handleUpdateShot(shot.id, { framing: e.target.value })}
                          />
                        </label>
                        <label>
                          镜头运动：
                          <input
                            type="text"
                            value={shot.cameraMovement}
                            onChange={(e) => handleUpdateShot(shot.id, { cameraMovement: e.target.value })}
                          />
                        </label>
                        <label>
                          场景描述：
                          <textarea
                            value={shot.sceneDescription}
                            onChange={(e) => handleUpdateShot(shot.id, { sceneDescription: e.target.value })}
                            rows={3}
                          />
                        </label>
                        <label>
                          对白/旁白：
                          <input
                            type="text"
                            value={shot.dialogue || ''}
                            onChange={(e) => handleUpdateShot(shot.id, { dialogue: e.target.value })}
                          />
                        </label>
                        <label>
                          音效备注：
                          <input
                            type="text"
                            value={shot.soundNotes || ''}
                            onChange={(e) => handleUpdateShot(shot.id, { soundNotes: e.target.value })}
                          />
                        </label>
                        <button onClick={() => setEditingShot(null)} className="workflow-save-edit">
                          保存
                        </button>
                      </div>
                    ) : (
                      <div className="workflow-shot-view">
                        <p><strong>时长：</strong>{shot.duration} 秒</p>
                        <p><strong>景别：</strong>{shot.framing}</p>
                        <p><strong>运动：</strong>{shot.cameraMovement}</p>
                        <p><strong>场景：</strong>{shot.sceneDescription}</p>
                        {shot.dialogue && <p><strong>对白：</strong>{shot.dialogue}</p>}
                        {shot.soundNotes && <p><strong>音效：</strong>{shot.soundNotes}</p>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              
              <div className="workflow-actions">
                <button onClick={() => handleAddShot(currentProject.shots!.length - 1)}>
                  添加镜头
                </button>
                <button onClick={generateKeyframes} className="workflow-action-primary">
                  下一步 - 生成关键帧（{pending.keyframes} 个）
                </button>
              </div>
            </div>
          )}
          
          {currentProject.stage === 'keyframes' && currentProject.shots && (
            <div className="workflow-stage-keyframes">
              <h3>关键帧</h3>
              
              <div className="workflow-keyframes">
                {currentProject.shots.map((shot, i) => (
                  <div key={shot.id} className="workflow-keyframe-card">
                    <h4>镜头 {shot.number} ({shot.duration}秒)</h4>
                    {shot.keyframeUrl && shot.keyframeStatus === 'completed' && (
                      <img src={shot.keyframeUrl} alt={`镜头 ${i + 1} 关键帧`} />
                    )}
                    {shot.keyframeStatus === 'pending' && <p>生成中...</p>}
                    {shot.keyframeStatus === 'failed' && (
                      <div className="workflow-error">
                        <AlertCircle size={16} />
                        <div>
                          <p>{shot.keyframeError}</p>
                          <button onClick={() => generateKeyframes(shot.id)}>重新生成</button>
                        </div>
                      </div>
                    )}
                    <p className="workflow-shot-desc">{shot.sceneDescription}</p>
                  </div>
                ))}
              </div>
              
              <div className="workflow-actions">
                <button onClick={() => generateKeyframes()}>
                  重新生成失败的关键帧
                </button>
                <button onClick={() => generateVideos()} className="workflow-action-primary">
                  下一步 - 生成视频
                  {currentProject.useContinuousShot && continuousGenerations > 0 && (
                    <span> ({continuousGenerations} 次生成)</span>
                  )}
                  {!currentProject.useContinuousShot && pending.videos > 0 && (
                    <span> ({pending.videos} 个)</span>
                  )}
                </button>
              </div>
              
              {isOmni && generationLimit <= 5 && (
                <p className="workflow-warning">
                  ⚠️ Omni 每日额度有限（约 3-5 次），请谨慎使用。当前剩余额度：{generationLimit}
                </p>
              )}
            </div>
          )}
          
          {currentProject.stage === 'videos' && currentProject.shots && (
            <div className="workflow-stage-videos">
              <h3>镜头视频</h3>
              
              <div className="workflow-videos">
                {currentProject.shots.map((shot, i) => (
                  <div key={shot.id} className="workflow-video-card">
                    <h4>镜头 {shot.number} ({shot.duration}秒)</h4>
                    {shot.videoUrl && shot.videoStatus === 'completed' && (
                      <video src={shot.videoUrl} controls />
                    )}
                    {shot.videoStatus === 'pending' && <p>生成中...</p>}
                    {shot.videoStatus === 'failed' && (
                      <div className="workflow-error">
                        <AlertCircle size={16} />
                        <div>
                          <p>{shot.videoError}</p>
                          <button onClick={() => generateVideos(shot.id)}>重新生成</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              
              <div className="workflow-actions">
                <button onClick={() => generateVideos()}>
                  重新生成失败的视频
                </button>
                <button onClick={generateMusicTrack} className="workflow-action-primary">
                  添加配乐（可选）
                </button>
                <button onClick={() => assembleFinal(false)}>
                  跳过配乐，开始合成
                </button>
              </div>
            </div>
          )}
          
          {(currentProject.stage === 'music' || currentProject.stage === 'assembly') && (
            <div className="workflow-stage-assembly">
              <h3>合成成片</h3>
              
              {currentProject.musicUrl && (
                <div className="workflow-music">
                  <h4>背景音乐</h4>
                  <audio src={currentProject.musicUrl} controls />
                </div>
              )}
              
              <p>
                准备合成 {currentProject.shots?.filter(s => s.videoStatus === 'completed').length} 个镜头
                {currentProject.musicUrl && '和背景音乐'}
              </p>
              
              <div className="workflow-actions">
                <button onClick={() => assembleFinal(false)} className="workflow-action-primary">
                  合成视频（无字幕）
                </button>
                <button onClick={() => assembleFinal(true)} className="workflow-action-primary">
                  合成视频（含字幕）
                </button>
                {currentProject.shots && (
                  <button onClick={() => exportSRT(currentProject.shots!, currentProject.title)}>
                    导出 SRT 字幕
                  </button>
                )}
              </div>
            </div>
          )}
          
          {currentProject.stage === 'complete' && (
            <div className="workflow-stage-complete">
              <h3>🎉 工作流完成</h3>
              
              {currentProject.finalVideoUrl && currentProject.finalVideoStatus === 'completed' && (
                <div className="workflow-final-video">
                  <h4>成片</h4>
                  <video src={currentProject.finalVideoUrl} controls />
                  <button onClick={downloadFinalVideo} className="workflow-download">
                    <Download size={16} />
                    下载成片
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
                <h4>所有镜头</h4>
                {currentProject.shots?.map((shot, i) => (
                  <div key={shot.id} className="workflow-final-shot">
                    <span>镜头 {i + 1}</span>
                    {shot.videoUrl && <video src={shot.videoUrl} controls />}
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
