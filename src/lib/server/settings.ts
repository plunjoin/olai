// 运行时配置：数据库覆盖优先，.env 作为默认值。
// 只保存“在后台改过”的键；未改过的键继续读环境变量，因此现有部署无需迁移。
// 读取走同步内存缓存，写入后立即更新；多实例部署靠 middleware 的定时刷新同步。
export type SettingType = 'int' | 'bool' | 'text' | 'csv' | 'url' | 'enum' | 'secret';

export interface SettingDef {
  key: string;
  group: string;
  label: string;
  help?: string;
  type: SettingType;
  default: string;
  min?: number;
  max?: number;
  choices?: readonly string[];
  /** 密钥类配置只告知“是否已配置”，永远不会回传具体值。 */
  secret?: boolean;
  /** 修改后需要重启或重新构建才能完全生效。 */
  restart?: boolean;
}

const AI_MODEL_HELP = '留空使用内置默认模型。';
const BYTES_HELP = '字节数，例如 268435456 表示 256 MiB。';

export const SETTING_DEFS: readonly SettingDef[] = [
  // 站点与安全
  { key: 'SITE_ORIGIN', group: '站点', label: '公开站点地址', type: 'url', default: '',
    help: '反向代理部署时填写，例如 https://olai.example.com。留空使用请求地址。' },
  { key: 'TRUST_PROXY', group: '站点', label: '信任反向代理', type: 'bool', default: 'false',
    help: '仅在可信代理会覆盖 X-Forwarded-For 且服务不能被直接访问时开启。' },
  { key: 'ADMIN_EMAILS', group: '站点', label: '管理员邮箱', type: 'csv', default: '',
    help: '逗号分隔。留空时回退到 .env 中的 ADMIN_EMAILS；请保留至少一个可用管理员。' },

  // AI 服务
  { key: 'AI_API_BASE_URL', group: 'AI 服务', label: '网关地址', type: 'url', default: '',
    help: 'OpenAI 兼容接口地址，例如 https://example.com/v1。仅服务端使用。' },
  { key: 'AI_API_KEY', group: 'AI 服务', label: '网关密钥', type: 'secret', default: '', secret: true },
  { key: 'AI_SYSTEM_PROMPT', group: 'AI 服务', label: '对话系统提示词', type: 'text', default: '', max: 8000,
    help: '留空使用内置的小o默认人格。' },
  { key: 'AI_CHAT_MODEL', group: 'AI 服务', label: '对话模型', type: 'text', default: '', max: 200, help: AI_MODEL_HELP },
  { key: 'AI_IMAGE_MODEL', group: 'AI 服务', label: '图片模型', type: 'text', default: '', max: 200, help: AI_MODEL_HELP },
  { key: 'AI_VIDEO_MODEL', group: 'AI 服务', label: '视频模型', type: 'text', default: '', max: 200, help: AI_MODEL_HELP },
  { key: 'AI_MUSIC_MODEL', group: 'AI 服务', label: '音乐模型', type: 'text', default: '', max: 200, help: AI_MODEL_HELP },
  { key: 'AI_IMAGE_API_MODE', group: 'AI 服务', label: '图片接口模式', type: 'enum', default: 'auto',
    choices: ['auto', 'native', 'upstream', 'interactions'] },
  { key: 'AI_AUDIO_API_MODE', group: 'AI 服务', label: '音乐接口模式', type: 'enum', default: 'auto', choices: ['auto', 'upstream'] },
  { key: 'AI_SHORT_FILM', group: 'AI 服务', label: '开放短片工坊', type: 'bool', default: 'false' },
  { key: 'AI_VIDEO_OMNI_ASYNC', group: 'AI 服务', label: 'Omni 异步视频', type: 'bool', default: 'false',
    restart: true, help: '前端在构建时读取，修改后需要重新构建前端。' },

  // 每日额度与限流
  { key: 'GUEST_DAILY_GENERATION_LIMIT', group: '额度与限流', label: '游客每日生成次数', type: 'int', default: '1', min: 0, max: 100000 },
  { key: 'USER_DAILY_GENERATION_LIMIT', group: '额度与限流', label: '登录用户每日生成次数', type: 'int', default: '15', min: 0, max: 100000 },
  { key: 'GUEST_DAILY_CHAT_LIMIT', group: '额度与限流', label: '游客每日对话条数', type: 'int', default: '100', min: 0, max: 1000000 },
  { key: 'USER_DAILY_CHAT_LIMIT', group: '额度与限流', label: '登录用户每日对话条数', type: 'int', default: '100', min: 0, max: 1000000 },
  { key: 'CHAT_RATE_LIMIT', group: '额度与限流', label: '每 IP 每分钟对话数', type: 'int', default: '30', min: 0, max: 100000, help: '0 表示不限速。' },
  { key: 'CHAT_CONCURRENT_LIMIT', group: '额度与限流', label: '每 IP 并发对话数', type: 'int', default: '20', min: 0, max: 10000, help: '0 表示不限制。' },

  // 积分与邀请
  { key: 'POINT_SIGNUP_BONUS', group: '积分与邀请', label: '注册赠送积分', type: 'int', default: '100', min: 0, max: 10000000 },
  { key: 'POINT_IMAGE_1K', group: '积分与邀请', label: '图片 1K 单价', type: 'int', default: '1', min: 0, max: 1000000 },
  { key: 'POINT_IMAGE_2K', group: '积分与邀请', label: '图片 2K 单价', type: 'int', default: '2', min: 0, max: 1000000 },
  { key: 'POINT_IMAGE_4K', group: '积分与邀请', label: '图片 4K 单价', type: 'int', default: '4', min: 0, max: 1000000 },
  { key: 'POINT_VIDEO_360P', group: '积分与邀请', label: '视频 360p 每秒', type: 'int', default: '1', min: 0, max: 1000000 },
  { key: 'POINT_VIDEO_720P', group: '积分与邀请', label: '视频 720p 每秒', type: 'int', default: '2', min: 0, max: 1000000 },
  { key: 'POINT_VIDEO_1080P', group: '积分与邀请', label: '视频 1080p 每秒', type: 'int', default: '4', min: 0, max: 1000000 },
  { key: 'POINT_VIDEO_4K', group: '积分与邀请', label: '视频 4K 每秒', type: 'int', default: '8', min: 0, max: 1000000 },
  { key: 'POINT_MUSIC_PER_MINUTE', group: '积分与邀请', label: '音乐每分钟', type: 'int', default: '2', min: 0, max: 1000000 },
  { key: 'POINT_CHAT', group: '积分与邀请', label: '每条对话积分', type: 'int', default: '0', min: 0, max: 1000000, help: '0 表示对话不扣积分。' },
  { key: 'POINT_INVITE_REWARD', group: '积分与邀请', label: '邀请人奖励', type: 'int', default: '30', min: 0, max: 1000000 },
  { key: 'POINT_INVITE_BONUS', group: '积分与邀请', label: '被邀请人奖励', type: 'int', default: '20', min: 0, max: 1000000 },
  { key: 'POINT_INVITE_DAILY_LIMIT', group: '积分与邀请', label: '邀请奖励每日上限', type: 'int', default: '5', min: 0, max: 10000, help: '每个邀请人每天最多发放几次；0 表示暂停。' },

  // GitHub 登录
  { key: 'GITHUB_CLIENT_ID', group: 'GitHub 登录', label: 'Client ID', type: 'text', default: '', max: 200 },
  { key: 'GITHUB_CLIENT_SECRET', group: 'GitHub 登录', label: 'Client Secret', type: 'secret', default: '', secret: true },
  { key: 'GITHUB_PROXY', group: 'GitHub 登录', label: 'GitHub 请求代理', type: 'text', default: '', max: 500,
    help: '例如 http://127.0.0.1:7890。留空时读取 HTTPS_PROXY。' },
  { key: 'GITHUB_RESOLVE_IP', group: 'GitHub 登录', label: 'GitHub 固定 IP', type: 'text', default: '', max: 100,
    help: '没有代理时的备选方案；网络恢复后请留空。' },

  // 出站邮件
  { key: 'MAIL_HOST', group: '出站邮件', label: 'SMTP 主机', type: 'text', default: '', max: 253,
    help: '例如 mail.bllii.com。留空时回退到 .env。' },
  { key: 'MAIL_PORT', group: '出站邮件', label: 'SMTP 端口', type: 'int', default: '465', min: 1, max: 65535,
    help: '常用 465（隐式 TLS）或 587（STARTTLS）。' },
  { key: 'MAIL_SECURE', group: '出站邮件', label: '隐式 TLS', type: 'bool', default: 'true',
    help: '端口 465 请开启；端口 587 请关闭，改用 STARTTLS。' },
  { key: 'MAIL_USER', group: '出站邮件', label: 'SMTP 用户名', type: 'text', default: '', max: 200,
    help: 'SMTP 登录账号，例如 admin@bllii.com。留空时回退到 .env。' },
  { key: 'MAIL_PASS', group: '出站邮件', label: 'SMTP 密码', type: 'secret', default: '', secret: true },
  { key: 'MAIL_FROM', group: '出站邮件', label: '发件人地址', type: 'text', default: 'noreply@olai.cc', max: 254,
    help: '对外显示的发件人，例如 noreply@olai.cc。' },

  // 私有 OSS
  { key: 'OSS_ENABLED', group: '私有 OSS', label: '启用私有 OSS', type: 'bool', default: 'false' },
  { key: 'OSS_BUCKET', group: '私有 OSS', label: 'Bucket', type: 'text', default: 'magicfang-linux-dev', max: 63 },
  { key: 'OSS_REGION', group: '私有 OSS', label: 'Region', type: 'text', default: '', max: 100, help: '例如 oss-cn-hangzhou，必须与桶的实际地域一致。' },
  { key: 'OSS_ACCESS_KEY_ID', group: '私有 OSS', label: 'AccessKey ID', type: 'text', default: '', max: 200 },
  { key: 'OSS_ACCESS_KEY_SECRET', group: '私有 OSS', label: 'AccessKey Secret', type: 'secret', default: '', secret: true },
  { key: 'OSS_PREFIX', group: '私有 OSS', label: '对象前缀', type: 'text', default: 'opt/olai', max: 200 },
  { key: 'OSS_MAX_FILE_BYTES', group: '私有 OSS', label: '单文件大小上限', type: 'int', default: '268435456', min: 1, max: 1073741824, help: BYTES_HELP },
  { key: 'OSS_IMPORT_HOSTS', group: '私有 OSS', label: '允许导入的主机', type: 'csv', default: '', help: '逗号分隔的精确主机名；留空只允许网关主机。' },
  { key: 'OSS_MEDIA_RATE_LIMIT', group: '私有 OSS', label: '上传每分钟次数', type: 'int', default: '60', min: 0, max: 1000000 },
  { key: 'OSS_MEDIA_DAILY_BYTES', group: '私有 OSS', label: '每日上传字节', type: 'int', default: '1073741824', min: 1, max: 107374182400, help: BYTES_HELP },
  { key: 'OSS_MEDIA_READ_RATE_LIMIT', group: '私有 OSS', label: '浏览每分钟次数', type: 'int', default: '60', min: 0, max: 1000000 },
  { key: 'OSS_MEDIA_READ_DAILY_BYTES', group: '私有 OSS', label: '每日浏览字节', type: 'int', default: '1073741824', min: 1, max: 107374182400, help: BYTES_HELP },
];

export const SETTING_GROUPS = ['站点', 'AI 服务', '额度与限流', '积分与邀请', 'GitHub 登录', '出站邮件', '私有 OSS'] as const;
const DEFS = new Map(SETTING_DEFS.map(def => [def.key, def]));

/** 与 policy.env 相同的读取顺序，但本模块不能依赖 policy（policy 依赖本模块）。 */
function rawEnv(name: string, fallback = ''): string {
  return process.env[name] ?? (import.meta.env as Record<string, string | undefined>)[name] ?? fallback;
}

const overrides = new Map<string, string>();
let loadedAt = 0;
let loading: Promise<void> | null = null;
const REFRESH_MS = 10_000;

/** 读取配置：后台覆盖优先，其次 .env / 构建期变量，最后默认值。 */
export function setting(name: string, fallback = ''): string {
  const value = overrides.get(name);
  return value === undefined ? rawEnv(name, fallback) : value;
}

export function settingInt(name: string, fallback: number): number {
  return Number(setting(name, String(fallback)));
}

/** 拉取数据库中的覆盖项；middleware 会节流调用，多实例部署也能在 10 秒内同步。 */
export async function refreshSettings(force = false): Promise<void> {
  if (!force && Date.now() - loadedAt < REFRESH_MS) return;
  if (loading) return loading;
  loading = (async () => {
    try {
      const { db, AppSetting } = await import('./database');
      const rows = await db.select({ key: AppSetting.key, value: AppSetting.value }).from(AppSetting);
      overrides.clear();
      for (const row of rows) if (DEFS.has(row.key)) overrides.set(row.key, row.value);
      loadedAt = Date.now();
    } catch (error) {
      // 数据库不可用时继续使用 .env；具体错误由初始化流程统一报告。
      console.error('Settings refresh failed:', error instanceof Error ? error.message : error);
    } finally {
      loading = null;
    }
  })();
  return loading;
}

export interface PublicSetting extends SettingDef {
  value?: string;
  configured: boolean;
  source: 'database' | 'env' | 'default';
}

export function settingsForClient(): { groups: string[]; settings: PublicSetting[] } {
  return {
    groups: [...SETTING_GROUPS],
    settings: SETTING_DEFS.map(def => {
      const hasOverride = overrides.has(def.key);
      const raw = hasOverride ? overrides.get(def.key)! : rawEnv(def.key, def.default);
      const source: PublicSetting['source'] = hasOverride ? 'database' : rawEnv(def.key, '') ? 'env' : 'default';
      if (def.secret) return { ...def, configured: Boolean(raw.trim()), source };
      return { ...def, value: raw, configured: Boolean(raw.trim()), source };
    }),
  };
}

export class SettingsError extends Error {}

function validate(def: SettingDef, raw: string): string {
  const value = raw.trim();
  if (def.secret) {
    if (value.length > 1000 || /[\r\n\0]/.test(value)) throw new SettingsError(`${def.label}格式无效。`);
    return value;
  }
  if (value === '') {
    if (def.type === 'enum' || def.type === 'bool') throw new SettingsError(`${def.label}不能为空。`);
    if (def.key === 'ADMIN_EMAILS') throw new SettingsError('至少保留一个管理员邮箱；如需回退请使用“恢复默认”。');
    return '';
  }
  switch (def.type) {
    case 'int': {
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new SettingsError(`${def.label}必须是非负整数。`);
      const number = Number(value);
      if (def.min !== undefined && number < def.min) throw new SettingsError(`${def.label}不能小于 ${def.min}。`);
      if (def.max !== undefined && number > def.max) throw new SettingsError(`${def.label}不能大于 ${def.max}。`);
      return String(number);
    }
    case 'bool':
      if (value !== 'true' && value !== 'false') throw new SettingsError(`${def.label}只能是 true 或 false。`);
      return value;
    case 'enum':
      if (!def.choices?.includes(value)) throw new SettingsError(`${def.label}取值无效。`);
      return value;
    case 'url': {
      let url: URL;
      try { url = new URL(value); } catch { throw new SettingsError(`${def.label}必须是完整地址，例如 https://example.com。`); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
        throw new SettingsError(`${def.label}必须是不含账号、查询和锚点的 http(s) 地址。`);
      if (def.key === 'SITE_ORIGIN' && url.pathname !== '/')
        throw new SettingsError('公开站点地址只能是 origin，不能包含路径。');
      return value.replace(/\/$/, '');
    }
    case 'csv': {
      if (value.length > 2000) throw new SettingsError(`${def.label}内容过长。`);
      const items = value.split(',').map(item => item.trim()).filter(Boolean);
      if (items.some(item => item.length > 254 || /\s/.test(item))) throw new SettingsError(`${def.label}格式无效。`);
      if (def.key === 'ADMIN_EMAILS') {
        if (!items.length) throw new SettingsError('至少保留一个管理员邮箱；如需回退请使用“恢复默认”。');
        if (items.some(item => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item))) throw new SettingsError('管理员邮箱格式无效。');
      }
      return items.join(',');
    }
    default:
      if (value.length > (def.max ?? 4000)) throw new SettingsError(`${def.label}内容过长。`);
      if (def.key === 'MAIL_FROM' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
        throw new SettingsError('发件人地址格式无效。');
      if (def.key === 'MAIL_HOST' && (value.includes('/') || value.includes(':') || /\s/.test(value) || value.startsWith('.') || value.endsWith('.')))
        throw new SettingsError('SMTP 主机格式无效。');
      return value;
  }
}

/**
 * 保存后台修改。values 中的空字符串表示显式清空；重置某项回到 .env/默认值请用 reset。
 * 返回实际发生变化的键，便于审计。
 */
export async function saveSettings(values: Record<string, unknown>, reset: unknown[], adminId: string): Promise<string[]> {
  const { db, AppSetting, eq } = await import('./database');
  const writes: { key: string; value: string }[] = [];
  const removals: string[] = [];
  for (const [key, value] of Object.entries(values || {})) {
    const def = DEFS.get(key);
    if (!def) throw new SettingsError('包含未知配置项。');
    if (typeof value !== 'string') throw new SettingsError(`${def.label}格式无效。`);
    writes.push({ key, value: validate(def, value) });
  }
  for (const key of Array.isArray(reset) ? reset : []) {
    if (typeof key !== 'string' || !DEFS.has(key)) throw new SettingsError('包含未知配置项。');
    removals.push(key);
  }
  if (!writes.length && !removals.length) return [];
  const now = Date.now();
  await db.transaction(async tx => {
    for (const item of writes) {
      await tx.insert(AppSetting)
        .values({ key: item.key, value: item.value, updatedAt: now, updatedBy: adminId })
        .onConflictDoUpdate({ target: AppSetting.key, set: { value: item.value, updatedAt: now, updatedBy: adminId } });
    }
    for (const key of removals) await tx.delete(AppSetting).where(eq(AppSetting.key, key));
  });
  // 立即更新本进程缓存，后台保存后马上按新价格/新额度生效。
  for (const item of writes) overrides.set(item.key, item.value);
  for (const key of removals) overrides.delete(key);
  loadedAt = Date.now();
  return [...writes.map(item => item.key), ...removals];
}

export function settingKeys(): string[] { return [...DEFS.keys()]; }
