const LOCAL_ORIGIN = 'https://olai.invalid';

/** 只接受站内绝对路径；协议相对、反斜杠、javascript: 等写法一律回退。 */
export function safeNextPath(value: string | null | undefined, fallback = '/'): string {
  if (!value?.startsWith('/')) return fallback;
  try {
    const url = new URL(value, LOCAL_ORIGIN);
    // 反斜杠会被 URL 解析成外站；/..//evil.com 这类点段会归一化成 //evil.com。
    if (url.origin !== LOCAL_ORIGIN || url.pathname.startsWith('//')) return fallback;
    // 路由匹配前会解码路径；/%6Cogin 这类写法必须在解码后再判断。
    let decoded: string;
    try { decoded = decodeURI(url.pathname); } catch { return fallback; }
    // 双重编码在解码后仍残留 %xx，路由含义不可靠，直接回退。
    if (decoded !== url.pathname && /%[0-9a-fA-F]{2}/.test(decoded)) return fallback;
    if (decoded === '/login' || decoded.startsWith('/login/')) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}

/** 已登录时登录页的跳转目标；null 表示保留表单（验证/重置/第三方登录错误流程）。 */
export function loginRedirectTarget(hasUser: boolean, params: URLSearchParams): string | null {
  if (!hasUser) return null;
  if (params.has('verify') || params.has('reset') || params.has('github_error') || params.has('google_error')) return null;
  return safeNextPath(params.get('next'));
}
