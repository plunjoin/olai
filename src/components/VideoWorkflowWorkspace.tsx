import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, Download, Edit2, Play, Plus, Save, Trash2, X } from 'lucide-react';
import {
  buildKeyframePrompt,
  buildMusicPrompt,
  buildScriptPrompt,
  buildShotListPrompt,
  buildVideoPrompt,
  calculateTotalDuration,
  createWorkflowProject,
  validateShotList,
  type Shot,
  type StyleBible,
  type VideoWorkflowProject,
  type WorkflowStage,
} from '../lib/videoWorkflow';
import { base64Blob, generateAudio, generateImage, generateVideo, mediaOutputs, publicServiceError, request, safeMediaURL, videoContent } from '../lib/api';
import { videoEngineForModel } from '../lib/video';
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
            {
              role: 'system',
              content: '你是一位专业的短视频编剧。输出格式严格为 JSON，不要添加任何其他说明文字。',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          stream: false,
        }),
      });
      
      const json = await response.json();
      const content = json.choices?.[0]?.message?.content;
      if (!content) throw new Error('未收到编剧输出');
      
      // 提取 JSON
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
            {
              role: 'system',
              content: '你是一位专业的短片导演。输出格式严格为 JSON 数组，不要添加任何其他说明文字。',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          stream: false,
        }),
      });
      
      const json = await response.json();
      const content = json.choices?.[0]?.message?.content;
      if (!content) throw new Error('未收到导演输出');
      
      // 提取 JSON 数组
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

  // 阶段 3: 生成关键帧
  const generateKeyframes = useCallback(async () => {
    if (!currentProject?.shots || !currentProject.styleBible) return;
    
    const pendingShots = currentProject.shots.filter(s => !s.keyframeStatus || s.keyframeStatus === 'failed');
    if (pendingShots.length === 0) {
      await saveProject({ ...currentProject, stage: 'keyframes' });
      return;
    }
    
    // 请求额度
    const approved = await onRequestQuota('image', pendingShots.length);
    if (!approved) return;
    
    setLoading(true);
    abortRef.current = new AbortController();
    
    try {
      const updatedShots = [...currentProject.shots];
      
      for (let i = 0; i < updatedShots.length; i++) {
        const shot = updatedShots[i];
        if (shot.keyframeStatus === 'completed') continue;
        
        setLoadingMessage(`生成关键帧 ${i + 1}/${updatedShots.length}...`);
        
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
      
      // 检查是否全部成功
      const allCompleted = updatedShots.every(s => s.keyframeStatus === 'completed');
      if (allCompleted) {
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
  const generateVideos = useCallback(async () => {
    if (!currentProject?.shots || !currentProject.styleBible) return;
    
    const pendingShots = currentProject.shots.filter(s => !s.videoStatus || s.videoStatus === 'failed');
    if (pendingShots.length === 0) {
      await saveProject({ ...currentProject, stage: 'videos' });
      return;
    }
    
    // 请求额度
    const approved = await onRequestQuota('video', pendingShots.length);
    if (!approved) return;
    
    setLoading(true);
    abortRef.current = new AbortController();
    const videoMode = videoEngineForModel(videoModel);
    const imageInputEnabled = false; // AI_VIDEO_IMAGE_INPUT 环境变量，默认 false
    
    try {
      const updatedShots = [...currentProject.shots];
      
      for (let i = 0; i < updatedShots.length; i++) {
        const shot = updatedShots[i];
        if (shot.videoStatus === 'completed') continue;
        
        setLoadingMessage(`生成视频 ${i + 1}/${updatedShots.length}...`);
        
        updatedShots[i] = { ...shot, videoStatus: 'pending' };
        await saveProject({ ...currentProject, shots: updatedShots });
        
        try {
          const hasKeyframe = !!shot.keyframeBlob && imageInputEnabled;
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
          });
          
          if (videoMode === 'task') {
            // Veo 异步任务
            const json = await response.json();
            if (!json.id) throw new Error('未返回视频任务 ID');
            
            updatedShots[i] = { ...shot, videoRemoteId: json.id, videoStatus: 'pending' };
            await saveProject({ ...currentProject, shots: updatedShots });
            
            // 轮询任务状态
            let attempts = 0;
            const maxAttempts = 120; // 2 分钟超时
            
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
                
                updatedShots[i] = {
                  ...shot,
                  videoBlob: blob,
                  videoUrl: url,
                  videoStatus: 'completed',
                  videoError: undefined,
                  videoRemoteId: json.id,
                };
                break;
              } else if (status.status === 'failed') {
                throw new Error(status.error || '视频生成失败');
              }
              
              if (attempts >= maxAttempts) {
                throw new Error('视频生成超时');
              }
            }
          } else {
            // Omni 同步模式
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
            
            updatedShots[i] = {
              ...shot,
              videoBlob: blob,
              videoUrl: url,
              videoStatus: 'completed',
              videoError: undefined,
            };
          }
        } catch (error: any) {
          if (error.name === 'AbortError') throw error;
          updatedShots[i] = {
            ...shot,
            videoStatus: 'failed',
            videoError: publicServiceError(error.message),
          };
        }
        
        await saveProject({ ...currentProject, shots: updatedShots });
      }
      
      const allCompleted = updatedShots.every(s => s.videoStatus === 'completed');
      if (allCompleted) {
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

  // 阶段 5: 生成配乐（可选）
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

  // 取消操作
  const handleCancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setLoading(false);
    setLoadingMessage('');
  }, []);

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
              <h3>分镜列表</h3>
              <p>共 {currentProject.shots.length} 个镜头，总时长 {calculateTotalDuration(currentProject.shots)} 秒</p>
              
              <div className="workflow-shots">
                {currentProject.shots.map((shot, i) => (
                  <div key={shot.id} className="workflow-shot-card">
                    <h4>镜头 {i + 1} ({shot.duration}秒)</h4>
                    <p><strong>景别：</strong>{shot.framing}</p>
                    <p><strong>运动：</strong>{shot.cameraMovement}</p>
                    <p><strong>场景：</strong>{shot.sceneDescription}</p>
                    {shot.dialogue && <p><strong>对白：</strong>{shot.dialogue}</p>}
                  </div>
                ))}
              </div>
              
              <button onClick={generateKeyframes} className="workflow-action-primary">
                下一步 - 生成关键帧
              </button>
            </div>
          )}
          
          {currentProject.stage === 'keyframes' && currentProject.shots && (
            <div className="workflow-stage-keyframes">
              <h3>关键帧</h3>
              
              <div className="workflow-keyframes">
                {currentProject.shots.map((shot, i) => (
                  <div key={shot.id} className="workflow-keyframe-card">
                    <h4>镜头 {i + 1}</h4>
                    {shot.keyframeUrl && shot.keyframeStatus === 'completed' && (
                      <img src={shot.keyframeUrl} alt={`镜头 ${i + 1} 关键帧`} />
                    )}
                    {shot.keyframeStatus === 'pending' && <p>生成中...</p>}
                    {shot.keyframeStatus === 'failed' && (
                      <div className="workflow-error">
                        <AlertCircle size={16} />
                        <p>{shot.keyframeError}</p>
                      </div>
                    )}
                    <p className="workflow-shot-desc">{shot.sceneDescription}</p>
                  </div>
                ))}
              </div>
              
              <div className="workflow-actions">
                <button onClick={generateKeyframes} disabled={loading}>
                  重新生成失败的关键帧
                </button>
                <button onClick={generateVideos} className="workflow-action-primary">
                  下一步 - 生成视频
                </button>
              </div>
            </div>
          )}
          
          {currentProject.stage === 'videos' && currentProject.shots && (
            <div className="workflow-stage-videos">
              <h3>镜头视频</h3>
              
              <div className="workflow-videos">
                {currentProject.shots.map((shot, i) => (
                  <div key={shot.id} className="workflow-video-card">
                    <h4>镜头 {i + 1} ({shot.duration}秒)</h4>
                    {shot.videoUrl && shot.videoStatus === 'completed' && (
                      <video src={shot.videoUrl} controls />
                    )}
                    {shot.videoStatus === 'pending' && <p>生成中...</p>}
                    {shot.videoStatus === 'failed' && (
                      <div className="workflow-error">
                        <AlertCircle size={16} />
                        <p>{shot.videoError}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              
              <div className="workflow-actions">
                <button onClick={generateVideos} disabled={loading}>
                  重新生成失败的视频
                </button>
                <button onClick={generateMusicTrack} className="workflow-action-primary">
                  添加配乐（可选）
                </button>
                <button onClick={() => saveProject({ ...currentProject, stage: 'complete' })}>
                  跳过配乐，完成
                </button>
              </div>
            </div>
          )}
          
          {currentProject.stage === 'complete' && (
            <div className="workflow-stage-complete">
              <h3>🎉 工作流完成</h3>
              <p>你的短片已经准备好了！</p>
              
              {currentProject.musicUrl && (
                <div className="workflow-music">
                  <h4>背景音乐</h4>
                  <audio src={currentProject.musicUrl} controls />
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
              
              <p className="workflow-note">
                注意：客户端视频合成功能开发中。当前你可以单独下载每个镜头和配乐，使用视频编辑软件进行最终合成。
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
