// 轻量多语言：以简体中文原文作为 key（gettext 风格），其他语言用词典映射。
// 找不到译文时回落到中文原文，因此新增文案即使暂未翻译也不会显示空白或 key。
import en from './en';
import enAdmin from './en/admin';
import enCreate from './en/create';
import enErrors from './en/errors';
import enGallery from './en/gallery';
import enShell from './en/shell';
import enWorkflow from './en/workflow';

export type Locale = 'zh-CN' | 'en';
export type LocalePreference = Locale | 'auto';

export const LOCALES: readonly { code: Locale; label: string }[] = [
  { code: 'zh-CN', label: '简体中文' },
  { code: 'en', label: 'English' },
];

const STORAGE_KEY = 'olai.locale';
// Mirror the preference into a cookie so SSR can render the same language the
// client will show. Without it a stored English preference would hydrate over
// Chinese server markup.
const LOCALE_COOKIE = 'olai_locale';
const dictionaries: Record<Locale, Record<string, string> | null> = { 'zh-CN': null, en };

export type MessageDomain = 'shell' | 'create' | 'gallery' | 'workflow' | 'admin' | 'errors';
// 同一句中文在不同模块可能含义不同（例如“关闭”既是“关闭面板”也是“开关关闭”）。
// 这类词用 tIn 指定模块，优先取该模块的译法，其余文案继续用合并后的词典。
const domainDictionaries: Record<MessageDomain, Record<string, string>> = {
  shell: enShell,
  create: enCreate,
  gallery: enGallery,
  workflow: enWorkflow,
  admin: enAdmin,
  errors: enErrors,
};

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => name in vars ? String(vars[name]) : match);
}

/** 从一组 BCP 47 语言标签（按优先级排列）中挑出受支持的语言；都不支持时用英文。 */
export function matchLocale(tags: readonly string[]): Locale {
  for (const tag of tags) {
    const lower = String(tag || '').toLowerCase();
    if (lower === 'zh' || lower.startsWith('zh-')) return 'zh-CN';
    if (lower === 'en' || lower.startsWith('en-')) return 'en';
  }
  return tags.length ? 'en' : 'zh-CN';
}

/** 解析 Accept-Language 请求头，按 q 值排序后匹配。 */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  const tags = String(header || '').split(',')
    .map(part => { const [tag, ...params] = part.trim().split(';'); const q = params.map(p => p.trim()).find(p => p.startsWith('q=')); return { tag: tag.trim(), q: q ? Number(q.slice(2)) : 1 }; })
    .filter(item => item.tag && item.tag !== '*' && !(item.q <= 0))
    .sort((a, b) => b.q - a.q)
    .map(item => item.tag);
  return matchLocale(tags);
}

export function getLocalePreference(): LocalePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && LOCALES.some(item => item.code === saved)) return saved as Locale;
  } catch { /* 无存储权限时按设备语言处理。 */ }
  return 'auto';
}

function detectLocale(): Locale {
  // 服务端渲染与测试环境没有 navigator，保持中文原文。
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return 'zh-CN';
  const preference = getLocalePreference();
  if (preference !== 'auto') return preference;
  return matchLocale(navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : []);
}

let current: Locale = detectLocale();
if (typeof document !== 'undefined') document.documentElement.lang = current;

export function getLocale(): Locale { return current; }

/** 仅供测试或服务端按请求切换；浏览器内切换语言请用 setLocalePreference。 */
export function setLocale(locale: Locale) {
  current = locale;
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}

/** 保存用户选择并刷新页面，让所有文案（含模块级常量）以新语言重新求值。 */
export function setLocalePreference(preference: LocalePreference) {
  try {
    if (preference === 'auto') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, preference);
  } catch { /* 无法保存时本次刷新后仍按设备语言显示。 */ }
  if (typeof document !== 'undefined') {
    document.cookie = preference === 'auto'
      ? `${LOCALE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
      : `${LOCALE_COOKIE}=${preference}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }
  if (typeof window !== 'undefined') window.location.reload();
}

/**
 * 翻译一段中文原文。`vars` 用于替换 `{name}` 占位符。
 * 也可以传入运行时字符串（例如服务端返回的错误）：命中词典则翻译，否则原样返回。
 */
export function t(source: string, vars?: Record<string, string | number>): string {
  return interpolate(dictionaries[current]?.[source] ?? source, vars);
}

/** 同 t()，但当一句话在不同模块含义不同时，优先使用该模块自己的译法。 */
export function tIn(domain: MessageDomain, source: string, vars?: Record<string, string | number>): string {
  // 中文界面始终显示原文；模块词典只影响其他语言的译法。
  const template = (current !== 'zh-CN' && domainDictionaries[domain]?.[source]) || dictionaries[current]?.[source] || source;
  return interpolate(template, vars);
}

/** 当前语言对应的 Intl 区域标签，用于日期与数字格式化。 */
export function intlLocale(): string { return current === 'zh-CN' ? 'zh-CN' : 'en-US'; }
