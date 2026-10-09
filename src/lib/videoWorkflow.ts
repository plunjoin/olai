/**
 * 视频工作流 / 短片工坊
 * 
 * 从一句想法生成完整的多镜头短视频，分阶段进行：
 * 1. 编剧：生成脚本、人物和风格
 * 2. 导演/分镜：生成镜头列表
 * 3. 关键帧：为每个镜头生成静态图片
 * 4. 镜头视频：基于关键帧生成视频
 * 5. 配乐：可选背景音乐
 * 6. 成片：合成最终视频
 */

export type WorkflowStage = 
  | 'init'        // 初始化，输入创意
  | 'script'      // 编剧阶段
  | 'shotlist'    // 分镜阶段
  | 'keyframes'   // 关键帧生成
  | 'videos'      // 视频生成
  | 'music'       // 配乐（可选）
  | 'assembly'    // 合成
  | 'complete';   // 完成

export interface StyleBible {
  appearance: string;      // 角色外观描述
  wardrobe: string;        // 服装描述
  artStyle: string;        // 美术风格
  palette: string;         // 色调
}

export interface Shot {
  id: string;
  number: number;
  duration: number;           // 秒
  framing: string;            // 景别和机位
  cameraMovement: string;     // 镜头运动
  sceneDescription: string;   // 场景描述
  dialogue?: string;          // 对白/旁白
  soundNotes?: string;        // 音效备注
  
  // 关键帧
  keyframeUrl?: string;
  keyframeBlob?: Blob;
  keyframeStatus?: 'pending' | 'completed' | 'failed';
  keyframeError?: string;
  
  // 视频
  videoUrl?: string;
  videoBlob?: Blob;
  videoRemoteId?: string;     // Veo 任务 ID
  videoStatus?: 'pending' | 'completed' | 'failed';
  videoError?: string;
}

export interface VideoWorkflowProject {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  stage: WorkflowStage;
  
  // 阶段 1: 编剧
  idea: string;                   // 用户输入的一句话创意
  script?: string;                // 生成的脚本/logline
  styleBible?: StyleBible;        // 风格圣经
  
  // 阶段 2: 分镜
  targetLength?: number;          // 目标时长（秒），默认 30
  shots?: Shot[];
  useContinuousShot?: boolean;    // 是否使用连续长镜头模式（extend_from）
  
  // 阶段 5: 配乐
  musicUrl?: string;
  musicBlob?: Blob;
  musicStatus?: 'pending' | 'completed' | 'failed';
  musicError?: string;
  
  // 阶段 6: 成片
  finalVideoUrl?: string;
  finalVideoBlob?: Blob;
  finalVideoStatus?: 'pending' | 'completed' | 'failed';
  finalVideoError?: string;
  
  // 错误处理
  error?: string;
}

/**
 * 验证镜头列表 JSON 的 schema
 */
export function validateShotList(data: any): Shot[] {
  if (!Array.isArray(data)) {
    throw new Error('镜头列表必须是数组');
  }
  
  if (data.length === 0) {
    throw new Error('镜头列表不能为空');
  }
  
  const shots: Shot[] = [];
  for (let i = 0; i < data.length; i++) {
    const shot = data[i];
    if (!shot || typeof shot !== 'object') {
      throw new Error(`镜头 ${i + 1} 格式无效`);
    }
    
    if (typeof shot.duration !== 'number' || shot.duration <= 0 || shot.duration > 30) {
      throw new Error(`镜头 ${i + 1} 的时长必须在 0-30 秒之间`);
    }
    
    if (!shot.sceneDescription || typeof shot.sceneDescription !== 'string') {
      throw new Error(`镜头 ${i + 1} 缺少场景描述`);
    }
    
    shots.push({
      id: shot.id || `shot-${i + 1}-${Date.now()}`,
      number: i + 1,
      duration: shot.duration,
      framing: shot.framing || '中景',
      cameraMovement: shot.cameraMovement || '固定',
      sceneDescription: shot.sceneDescription,
      dialogue: shot.dialogue || '',
      soundNotes: shot.soundNotes || '',
    });
  }
  
  return shots;
}

/**
 * 构建编剧提示词
 */
export function buildScriptPrompt(idea: string, targetLength: number): string {
  return `你是一位专业的短视频编剧。根据以下创意，创作一个时长 ${targetLength} 秒的短片脚本。

创意：${idea}

请输出以下内容的 JSON：
{
  "title": "短片标题",
  "logline": "一句话简介（30字以内）",
  "script": "详细脚本，包含故事发展和情节转折",
  "styleBible": {
    "appearance": "主要角色的外观特征（发型、五官、体型等）",
    "wardrobe": "服装风格（颜色、款式、配饰）",
    "artStyle": "美术风格（例如：赛博朋克、水彩、写实、动画等）",
    "palette": "主色调（例如：暖色调、冷色调、黑白、高饱和度等）"
  }
}

要求：
1. 脚本要适合 ${targetLength} 秒的短视频
2. 风格圣经要详细具体，便于后续图像生成保持一致性
3. 只返回 JSON，不要其他说明文字`;
}

/**
 * 构建分镜提示词
 */
export function buildShotListPrompt(script: string, styleBible: StyleBible, targetLength: number): string {
  return `你是一位专业的短片导演。根据以下脚本和风格圣经，创作分镜头脚本。

脚本：
${script}

风格圣经：
- 角色外观：${styleBible.appearance}
- 服装：${styleBible.wardrobe}
- 美术风格：${styleBible.artStyle}
- 色调：${styleBible.palette}

目标总时长：${targetLength} 秒

请输出镜头列表的 JSON 数组，每个镜头包含：
[
  {
    "duration": 镜头时长（秒，3-8秒），
    "framing": "景别和机位（例如：特写、中景、远景、俯拍、仰拍等）",
    "cameraMovement": "镜头运动（例如：固定、推进、拉远、横移、跟随等）",
    "sceneDescription": "详细的场景描述，包含人物动作、环境细节、光线氛围等",
    "dialogue": "对白或旁白（如无则为空字符串）",
    "soundNotes": "音效备注（如无则为空字符串）"
  }
]

要求：
1. 所有镜头总时长应接近 ${targetLength} 秒（允许±3秒误差）
2. 每个镜头时长在 3-8 秒之间
3. 场景描述要详细具体，包含风格圣经的视觉元素
4. 合理安排景别和镜头运动，形成节奏感
5. 只返回 JSON 数组，不要其他说明文字`;
}

/**
 * 构建关键帧生成提示词
 */
export function buildKeyframePrompt(shot: Shot, styleBible: StyleBible): string {
  const styleDesc = `美术风格：${styleBible.artStyle}。色调：${styleBible.palette}。角色外观：${styleBible.appearance}。服装：${styleBible.wardrobe}。`;
  
  return `${shot.sceneDescription}

${styleDesc}

景别：${shot.framing}。画面构图专业，电影质感。`;
}

/**
 * 构建视频生成提示词（从关键帧或纯文本）
 */
export function buildVideoPrompt(shot: Shot, styleBible: StyleBible, hasKeyframe: boolean): string {
  const styleDesc = `美术风格：${styleBible.artStyle}。色调：${styleBible.palette}。`;
  const movementDesc = shot.cameraMovement !== '固定' ? `镜头${shot.cameraMovement}。` : '';
  
  if (hasKeyframe) {
    // 有关键帧时的描述应该更简洁，主要描述运动
    return `${shot.sceneDescription}

${movementDesc}${styleDesc}景别：${shot.framing}。电影质感。`;
  } else {
    // 无关键帧时需要完整描述
    return buildKeyframePrompt(shot, styleBible) + (movementDesc ? `\n\n${movementDesc}` : '');
  }
}

/**
 * 构建配乐生成提示词
 */
export function buildMusicPrompt(script: string, styleBible: StyleBible, duration: number): string {
  return `为以下短片创作背景音乐：

脚本：${script}

风格：${styleBible.artStyle}
情绪：根据脚本内容选择合适的情绪和节奏

要求：
1. 音乐时长约 ${Math.ceil(duration)} 秒
2. 纯音乐，无人声
3. 情绪与脚本内容匹配
4. 音量适中，适合作为背景音乐`;
}

/**
 * 计算镜头总时长
 */
export function calculateTotalDuration(shots: Shot[]): number {
  return shots.reduce((sum, shot) => sum + shot.duration, 0);
}

/**
 * 创建新的工作流项目
 */
export function createWorkflowProject(idea: string, targetLength: number = 30): VideoWorkflowProject {
  return {
    id: `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    title: idea.slice(0, 50),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    stage: 'init',
    idea,
    targetLength,
  };
}

/**
 * 创建空镜头
 */
export function createEmptyShot(number: number): Shot {
  return {
    id: `shot-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    number,
    duration: 4,
    framing: '中景',
    cameraMovement: '固定',
    sceneDescription: '',
    dialogue: '',
    soundNotes: '',
  };
}

/**
 * 更新镜头
 */
export function updateShot(shot: Shot, updates: Partial<Shot>): Shot {
  return { ...shot, ...updates };
}

/**
 * 复制镜头
 */
export function duplicateShot(shot: Shot, newNumber: number): Shot {
  return {
    ...shot,
    id: `shot-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    number: newNumber,
    // 清除生成的内容，需要重新生成
    keyframeUrl: undefined,
    keyframeBlob: undefined,
    keyframeStatus: undefined,
    keyframeError: undefined,
    videoUrl: undefined,
    videoBlob: undefined,
    videoRemoteId: undefined,
    videoStatus: undefined,
    videoError: undefined,
  };
}

/**
 * 移除镜头
 */
export function removeShot(shots: Shot[], shotId: string): Shot[] {
  const filtered = shots.filter(s => s.id !== shotId);
  // 重新编号
  return filtered.map((shot, index) => ({ ...shot, number: index + 1 }));
}

/**
 * 添加镜头
 */
export function addShot(shots: Shot[], afterIndex: number): Shot[] {
  const newShot = createEmptyShot(afterIndex + 2);
  const result = [
    ...shots.slice(0, afterIndex + 1),
    newShot,
    ...shots.slice(afterIndex + 1),
  ];
  // 重新编号
  return result.map((shot, index) => ({ ...shot, number: index + 1 }));
}

/**
 * 移动镜头
 */
export function moveShot(shots: Shot[], fromIndex: number, toIndex: number): Shot[] {
  if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= shots.length || toIndex < 0 || toIndex >= shots.length) {
    return shots;
  }
  
  const result = [...shots];
  const [moved] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, moved);
  
  // 重新编号
  return result.map((shot, index) => ({ ...shot, number: index + 1 }));
}

/**
 * 统计待生成的关键帧和视频数量
 */
export function countPendingGenerations(shots: Shot[]): { keyframes: number; videos: number } {
  let keyframes = 0;
  let videos = 0;
  
  for (const shot of shots) {
    if (!shot.keyframeStatus || shot.keyframeStatus === 'failed') {
      keyframes++;
    }
    if (!shot.videoStatus || shot.videoStatus === 'failed') {
      videos++;
    }
  }
  
  return { keyframes, videos };
}

/**
 * 规划连续长镜头分段
 * Omni 每段固定 10 秒，最多延续到 30 秒（可配置到 40 秒）
 */
export function planContinuousShots(shots: Shot[], maxDuration: number = 30): { segments: Shot[][]; totalGenerations: number } {
  const segments: Shot[][] = [];
  let currentSegment: Shot[] = [];
  let currentDuration = 0;
  
  for (const shot of shots) {
    if (currentDuration + shot.duration <= maxDuration) {
      currentSegment.push(shot);
      currentDuration += shot.duration;
    } else {
      if (currentSegment.length > 0) {
        segments.push(currentSegment);
      }
      currentSegment = [shot];
      currentDuration = shot.duration;
    }
  }
  
  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }
  
  // 每个 segment 需要的生成次数 = ceil(总时长 / 10)
  const totalGenerations = segments.reduce((sum, segment) => {
    const segmentDuration = segment.reduce((d, s) => d + s.duration, 0);
    return sum + Math.ceil(segmentDuration / 10);
  }, 0);
  
  return { segments, totalGenerations };
}

/**
 * 解析 Retry-After 头
 */
export function parseRetryAfter(retryAfter?: string | null): number | null {
  if (!retryAfter) return null;
  
  // 尝试解析为秒数
  const seconds = parseInt(retryAfter, 10);
  if (!isNaN(seconds) && seconds > 0) return seconds;
  
  // 尝试解析为 HTTP 日期
  try {
    const date = new Date(retryAfter);
    if (isNaN(date.getTime())) return null;
    const now = new Date();
    const diff = Math.max(0, Math.floor((date.getTime() - now.getTime()) / 1000));
    return diff;
  } catch {
    return null;
  }
}
