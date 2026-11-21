import { getLocale } from './i18n';

/** 对话首页空白状态的一张灵感卡片，由服务端每天用默认对话模型生成。 */
export interface PromptSuggestion {
  title: string;
  prompt: string;
}

const SUGGESTION_COUNT = 4;

let cached: PromptSuggestion[] | null = null;
let inflight: Promise<PromptSuggestion[]> | null = null;

function sanitize(value: unknown): PromptSuggestion[] {
  if (!Array.isArray(value)) return [];
  const items: PromptSuggestion[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const title = typeof (entry as PromptSuggestion).title === 'string' ? (entry as PromptSuggestion).title.trim() : '';
    const prompt = typeof (entry as PromptSuggestion).prompt === 'string' ? (entry as PromptSuggestion).prompt.trim() : '';
    if (!title || !prompt || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    items.push({ title, prompt });
    if (items.length === SUGGESTION_COUNT) break;
  }
  return items.length === SUGGESTION_COUNT ? items : [];
}

/**
 * 读取今天首页要展示的灵感卡片。进程内只请求一次；失败或格式不完整时返回空数组，
 * 调用方继续使用内置的四张默认卡片。
 */
export function loadSuggestions(): Promise<PromptSuggestion[]> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = fetch(`/api/suggestions?locale=${encodeURIComponent(getLocale())}`, { credentials: 'same-origin' })
      .then(async response => {
        if (!response.ok) throw new Error('suggestions');
        const body = await response.json();
        const items = sanitize(body?.suggestions);
        if (items.length) cached = items;
        return items;
      })
      .catch(() => [] as PromptSuggestion[])
      .finally(() => { inflight = null; });
  }
  return inflight;
}
