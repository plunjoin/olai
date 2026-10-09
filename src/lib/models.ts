import type { Model } from './types';

export type ModelCategory = 'chat' | 'image' | 'video' | 'music' | 'other';

export interface ModelCapability {
  id: string;
  name: string;
  category: ModelCategory;
  categoryLabel: string;
  tags: string[];
  description: string;
  isPopular?: boolean;
}

/**
 * 智能推断模型所属的分类
 */
export function getModelCategory(id: string): ModelCategory {
  const lower = id.toLowerCase();
  
  // 视频模型
  if (lower === 'gemini-omni-1.1-flash') return 'video';
  if (lower.includes('veo') || lower.includes('video') || lower.includes('sora') || lower.includes('animate')) {
    return 'video';
  }
  
  // 图像模型
  if (lower.includes('banana') || lower.includes('image') || lower.includes('imagen') || lower.includes('dall-e') || lower.includes('diffusion') || lower.includes('flux')) {
    return 'image';
  }
  
  // 音乐与音频模型
  if (lower.includes('lyria') || lower.includes('music') || lower.includes('audio') || lower.includes('tts') || lower.includes('speech') || lower.includes('sound') || lower.includes('voice')) {
    return 'music';
  }
  
  // 语言对话模型（包含常见的 gemini, gemma, deep-research, antigravity, gpt, claude 等）
  if (
    lower.includes('gemini') ||
    lower.includes('gemma') ||
    lower.includes('chat') ||
    lower.includes('preview') ||
    lower.includes('flash') ||
    lower.includes('pro') ||
    lower.includes('gpt') ||
    lower.includes('claude') ||
    lower.includes('qwen') ||
    lower.includes('deep-research') ||
    lower.includes('antigravity') ||
    lower.includes('it')
  ) {
    return 'chat';
  }
  
  return 'other';
}

/**
 * 格式化模型友好展示名称
 */
export function formatModelDisplayName(id: string): string {
  if (!id) return '';
  
  // 针对已知常见模型优化
  const nameMap: Record<string, string> = {
    'gemini-3.8-flash': 'Gemini 3.8 Flash',
    'gemini-3.7-flash': 'Gemini 3.7 Flash',
    'gemini-3.6-flash': 'Gemini 3.6 Flash',
    'gemini-3.5-flash': 'Gemini 3.5 Flash',
    'gemini-3.5-flash-lite': 'Gemini 3.5 Flash-Lite',
    'gemini-3.1-pro-preview': 'Gemini 3.1 Pro (Preview)',
    'gemini-flash-latest': 'Gemini Flash (Latest)',
    'gemini-pro-latest': 'Gemini Pro (Latest)',
    'deep-research-preview-04-2026': 'Deep Research (Preview)',
    'deep-research-max-preview-04-2026': 'Deep Research Max',
    'antigravity-preview-09-2026': 'Antigravity Studio (Preview)',
    'gemma-4-31b-it': 'Gemma 4 31B IT',
    'gemini-3.1-flash-image': 'Gemini 3.1 Flash Image',
    'gemini-3-pro-image': 'Gemini 3 Pro Image',
    'gemini-2.5-flash-image': 'Gemini 2.5 Flash Image',
    'veo-3.1-fast-generate-preview': 'Veo 3.1 Fast (Video)',
    'veo-3.1-generate-preview': 'Veo 3.1 Generate (Video)',
    'veo-3.1-lite-generate-preview': 'Veo 3.1 Lite (Video)',
    'lyria-3.5': 'Lyria 3.5 (Music)',
    'lyria-3-pro-preview': 'Lyria 3 Pro (Music)',
    'lyria-3-clip-preview': 'Lyria 3 Clip (Music)',
  };

  if (nameMap[id]) return nameMap[id];

  // 通用美化
  return id
    .split('-')
    .map(part => {
      if (/^\d+(\.\d+)?$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

/**
 * 提取模型能力标签
 */
export function getModelTags(id: string, category: ModelCategory): string[] {
  const tags: string[] = [];
  const lower = id.toLowerCase();

  if (lower.includes('3.8') || lower.includes('3.7') || lower.includes('3.6') || lower.includes('3.5') || lower.includes('3.1') || lower.includes('4')) {
    tags.push('Gen-3+');
  }
  if (lower.includes('pro') || lower.includes('max')) {
    tags.push('High-Precision');
  }
  if (lower.includes('flash') || lower.includes('lite') || lower.includes('fast')) {
    tags.push('Ultra-Fast');
  }
  if (lower.includes('research') || lower.includes('thinking')) {
    tags.push('Deep-Reasoning');
  }
  if (category === 'image') {
    tags.push('Diffusion & Art');
  } else if (category === 'video') {
    tags.push('Motion Synthesis');
  } else if (category === 'music') {
    tags.push('Acoustic Audio');
  } else {
    tags.push('Streaming');
  }

  return tags.slice(0, 3);
}

/**
 * 解析并丰富模型信息
 */
export function enrichModel(model: Model): ModelCapability {
  const category = getModelCategory(model.id);
  const categoryLabels: Record<ModelCategory, string> = {
    chat: '对话模型',
    image: '图像生成',
    video: '视频生成',
    music: '音乐生成',
    other: '通用能力',
  };

  const isPopular = [
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.1-pro-preview',
    'gemini-3.1-flash-image',
    'gemini-3-pro-image',
    'veo-3.1-fast-generate-preview',
    'veo-3.1-generate-preview',
    'lyria-3.5',
    'lyria-3-pro-preview',
  ].includes(model.id);

  return {
    id: model.id,
    name: model.display_name || formatModelDisplayName(model.id),
    category,
    categoryLabel: categoryLabels[category],
    tags: getModelTags(model.id, category),
    description: `上游服务提供的 ${categoryLabels[category]}，支持高并发调用`,
    isPopular,
  };
}

/**
 * 从当前动态获取的可用模型列表中，智能推荐最佳默认模型
 */
export function pickBestAvailableModel(
  availableModels: Model[],
  category: 'chat' | 'image' | 'video' | 'music',
  currentPreference?: string
): string {
  if (!availableModels || availableModels.length === 0) {
    return currentPreference || '';
  }

  const ids = availableModels.map(m => m.id);

  // 如果当前已有配置且在可用列表里，优先保持用户选择
  if (currentPreference && ids.includes(currentPreference)) {
    return currentPreference;
  }

  // 优先级排行榜
  const priorityLists: Record<'chat' | 'image' | 'video' | 'music', string[]> = {
    chat: [
      'gemini-3.5-flash',
      'gemini-flash-latest',
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.1-pro-preview',
      'gemini-pro-latest',
      'gemma-4-31b-it',
      'antigravity-preview-09-2026',
    ],
    image: [
      'gemini-3.1-flash-image',
      'gemini-nano-banana-2.1',
      'gemini-3-pro-image',
      'gemini-2.5-flash-image',
      'gemini-3.1-flash-lite-image',
    ],
    video: [
      'veo-3.1-lite-generate-preview',
      'veo-3.1-fast-generate-preview',
      'veo-3.1-generate-preview',
      'gemini-omni-1.1-flash',
    ],
    music: [
      'lyria-3.5',
      'lyria-3-pro-preview',
      'lyria-3-clip-preview',
      'gemini-3.8-flash-tts',
      'gemini-3.1-flash-tts-preview',
      'gemini-2.5-flash-preview-tts',
    ],
  };

  // 1. 尝试匹配优先级最高且存在的模型
  for (const candidate of priorityLists[category]) {
    if (ids.includes(candidate)) {
      return candidate;
    }
  }

  // 2. 匹配该分类下的第一个可用模型
  const matched = availableModels.find(m => getModelCategory(m.id) === category);
  if (matched) {
    return matched.id;
  }

  // 3. 如果是 chat 且实在没找到专属的，选第一个
  if (category === 'chat' && availableModels.length > 0) {
    return availableModels[0].id;
  }

  // 兜底返回第一个
  return availableModels[0]?.id || '';
}
