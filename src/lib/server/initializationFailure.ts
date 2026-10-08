export function initializationFailure(error?: unknown): Response {
  let code = 'SERVER_INITIALIZATION_FAILED';
  let message = '服务初始化失败，请查看服务端日志中的具体错误。';
  const visited = new Set<unknown>();
  for (let cause = error; cause && typeof cause === 'object' && !visited.has(cause);) {
    visited.add(cause);
    const detail = cause as { code?: string; message?: string; cause?: unknown };
    if (['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'ERR_DLOPEN_FAILED'].includes(detail.code || '')) {
      code = 'DEPENDENCY_MISSING';
      message = '运行环境缺少依赖或 SQLite 驱动无法加载，请在服务器安装生产依赖（npm install --omit=dev --include=optional），并使用适配当前操作系统的 node_modules。';
      break;
    }
    if (['EACCES', 'EPERM', 'SQLITE_READONLY', 'SQLITE_CANTOPEN'].includes(detail.code || '')) {
      code = 'DATABASE_FILE_UNAVAILABLE';
      message = '数据库文件无法打开或写入，请检查数据库及所在目录的权限和容器持久化卷。';
      break;
    }
    cause = detail.cause;
  }
  return Response.json({ error: { code, message } }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
}
