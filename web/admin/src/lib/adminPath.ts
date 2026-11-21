// 管理后台安全入口：默认 /admin，可在后台改成自定义路径。
// 这里只放纯函数，服务端配置、中间件和前端都能复用。

export const DEFAULT_ADMIN_PATH = '/admin';
export const ADMIN_PATH_MAX = 100;

// 这些前缀已被站点页面或 站点内部路由占用，不能作为自定义入口。
const RESERVED_SEGMENTS = new Set([
  'api', '_', 'admin', 'assets', 'login', 'account', 'home', 'download', 'setup',
  'chat', 'image', 'video', 'music', 'gallery', 'library', 'workflow',
]);

/**
 * 规范化后台入口：必须以 / 开头，只允许字母、数字、- 和 _，可包含多级路径。
 * 非法时返回 null；末尾斜杠会被去掉。
 */
export function normalizeAdminPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().replace(/\/+$/, '');
  if (value.length < 4 || value.length > ADMIN_PATH_MAX) return null;
  if (!value.startsWith('/')) return null;
  if (!/^\/[A-Za-z0-9][A-Za-z0-9_-]*(?:\/[A-Za-z0-9][A-Za-z0-9_-]*)*$/.test(value)) return null;
  const first = value.slice(1).split('/')[0].toLowerCase();
  // 允许默认入口本身；其他占用前缀（例如 /admin/xxx、/api/xxx）一律拒绝。
  if (RESERVED_SEGMENTS.has(first) && value.toLowerCase() !== DEFAULT_ADMIN_PATH) return null;
  return value;
}

/** 后台实际生效的入口；配置损坏时回落到默认值，避免后台彻底打不开。 */
export function adminPathFromSetting(raw: unknown): string {
  return normalizeAdminPath(raw) ?? DEFAULT_ADMIN_PATH;
}

/** 请求路径去掉末尾斜杠，便于与配置入口比较。 */
export function normalizeRequestPath(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  const trimmed = pathname.replace(/\/+$/, '') || '/';
  try { return decodeURI(trimmed); } catch { return trimmed; }
}

/** 是否指向当前后台入口（大小写不敏感，避免 /Admin 之类的绕过）。 */
export function matchesAdminPath(pathname: string, entry: string): boolean {
  return normalizeRequestPath(pathname).toLowerCase() === adminPathFromSetting(entry).toLowerCase();
}

/** 自定义入口生效时，旧的 /admin（含其子路径）必须视为不存在。 */
export function isOldAdminPath(pathname: string, entry: string): boolean {
  const normalizedEntry = adminPathFromSetting(entry).toLowerCase();
  if (normalizedEntry === DEFAULT_ADMIN_PATH) return false;
  const path = normalizeRequestPath(pathname).toLowerCase();
  return path === DEFAULT_ADMIN_PATH || path.startsWith(`${DEFAULT_ADMIN_PATH}/`);
}
