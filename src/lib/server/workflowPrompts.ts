import { ELEMENT_LABELS, type WorkflowElement, type Shot, type StyleBible } from '../videoWorkflow';

export function buildElementPrompt(elements: WorkflowElement[] = []): string {
  if (!elements.length) return '';
  return '\n\n创作元素（保持名称与设定一致）：\n' + elements.map(element =>
    `- ${ELEMENT_LABELS[element.kind]} [${element.id}] ${element.name}：${element.description}`
  ).join('\n');
}

/**
 * 构建编剧提示词
 */
export function buildScriptPrompt(idea: string, targetLength: number, elements: WorkflowElement[] = []): string {
  return `你是一位专业的短视频编剧。根据以下创意，创作一个时长 ${targetLength} 秒的短片脚本。

创意：${idea}
${buildElementPrompt(elements)}

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
export function buildShotListPrompt(script: string, styleBible: StyleBible, targetLength: number, elements: WorkflowElement[] = []): string {
  return `你是一位专业的短片导演。根据以下脚本和风格圣经，创作分镜头脚本。

脚本：
${script}
${buildElementPrompt(elements)}

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
    "soundNotes": "音效备注（如无则为空字符串）",
    "elementIds": ["本镜头使用的创作元素 ID，仅选上面提供的 ID，无则为空数组"]
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
export function buildKeyframePrompt(shot: Shot, styleBible: StyleBible, elements: WorkflowElement[] = []): string {
  const styleDesc = `美术风格：${styleBible.artStyle}。色调：${styleBible.palette}。角色外观：${styleBible.appearance}。服装：${styleBible.wardrobe}。`;
  
  return `${shot.sceneDescription}

${styleDesc}

景别：${shot.framing}。画面构图专业，电影质感。${buildElementPrompt(elements.filter(element => shot.elementIds?.includes(element.id)))}`;
}

/**
 * 构建视频生成提示词（从关键帧或纯文本）
 */
export function buildVideoPrompt(shot: Shot, styleBible: StyleBible, hasKeyframe: boolean, elements: WorkflowElement[] = []): string {
  const styleDesc = `美术风格：${styleBible.artStyle}。色调：${styleBible.palette}。`;
  const movementDesc = shot.cameraMovement !== '固定' ? `镜头${shot.cameraMovement}。` : '';
  
  if (hasKeyframe) {
    // 有关键帧时的描述应该更简洁，主要描述运动
    return `${shot.sceneDescription}

${movementDesc}${styleDesc}景别：${shot.framing}。电影质感。${buildElementPrompt(elements.filter(element => shot.elementIds?.includes(element.id)))}`;
  } else {
    // 无关键帧时需要完整描述
    return buildKeyframePrompt(shot, styleBible, elements) + (movementDesc ? `\n\n${movementDesc}` : '');
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

