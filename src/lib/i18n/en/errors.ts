// English translations, keyed by the Simplified Chinese source string.
// Scope: error and status messages produced outside components — client libraries in src/lib
// and messages returned by the server API, which the client translates on display via t().
const dict: Record<string, string> = {
  // Client request layer
  '请求失败（{status}）': 'Request failed ({status})',
  '{error}（HTTP {status}）': '{error} (HTTP {status})',
  '上游创作服务额度已用完或请求受限，请稍后重试。': 'The upstream creation service is out of quota or rate-limited. Please try again later.',
  '创作服务暂时无法完成请求，请重试或检查服务连接。': 'The creation service could not complete the request. Try again or check the connection.',
  '生成失败': 'Generation failed',
  '生成失败，请重试。': 'Generation failed. Please try again.',
  '服务返回了无法解析的流式数据，请重试。': 'The service sent a malformed stream. Please try again.',
  '服务未返回对话内容。': 'The service returned no reply.',
  '服务未返回响应流。': 'The service returned no response stream.',
  '无效的音频数据': 'Invalid audio data',
  '服务未返回可播放的视频文件。': 'The service returned no playable video file.',
  '视频内容为空。': 'The video is empty.',
  '服务返回了不支持的媒体链接。': 'The service returned an unsupported media link.',

  // Storage & media transport
  '云端记录接口未返回 JSON（HTTP {status}），请检查服务配置。': 'The cloud records endpoint did not return JSON (HTTP {status}). Check the server configuration.',
  '云端记录接口返回的数据格式无效。': 'The cloud records endpoint returned invalid data.',
  '云端保存失败。': 'Cloud save failed.',
  '记录正文超过 64 MB，请先下载备份。': 'This record is larger than 64 MB. Download a backup first.',
  '文件编码后超过单条记录 64 MB 的上限，请先下载备份。': 'The encoded file exceeds the 64 MB per-record limit. Download a backup first.',
  '记录包含媒体编码后超过 64 MB 的上限，请先下载备份。': 'This record with its media exceeds the 64 MB limit. Download a backup first.',
  '上传超时，请检查网络后重试。': 'Upload timed out. Check your network and try again.',
  '游客{item}「{name}」同步未完成，未同步的内容仍保留在本地。{detail}': 'Guest {item} “{name}” did not sync; unsynced content is still saved locally. {detail}',
  '会话': 'conversation',
  '作品': 'work',
  '账号附件迁移未完成：{detail}': 'Account media migration did not finish: {detail}',
  '媒体存储接口返回的数据无效。': 'The media storage endpoint returned invalid data.',
  '媒体上传失败（HTTP {status}）。': 'Media upload failed (HTTP {status}).',
  '媒体存储接口没有返回本站预览地址。': 'The media storage endpoint returned no local preview URL.',
  '本地媒体读取失败，原始数据仍保留在浏览器。': 'Could not read local media. The original data is still saved in your browser.',
  '短片媒体读取失败，请重新同步后重试。': 'Could not read the short-film media. Sync again and retry.',

  // Server: generation & records
  '请提供有效的创作内容和参数。': 'Provide valid creative content and parameters.',
  '此创作功能尚未开放。': 'This creation feature is not available yet.',
  '媒体编码无效或超过大小限制。': 'Invalid media encoding, or the size limit was exceeded.',
  '浏览器临时媒体需要从原设备重新同步。': 'Browser-temporary media must be re-synced from the original device.',

  // Server: media
  '私有媒体服务暂不可用。': 'The private media service is unavailable right now.',
  '媒体不存在或无权访问。': 'This media does not exist or you do not have access.',
  '今日媒体{action}流量已达上限，请明日再试或联系管理员调整额度。': 'Today’s media {action} traffic limit has been reached. Try again tomorrow or ask the administrator to raise the limit.',
  '媒体访问过于频繁，请 60 秒后重试。': 'Too many media requests. Try again in 60 seconds.',
  '不允许跨站调用。': 'Cross-site requests are not allowed.',
  '无法确定媒体访问身份。': 'Could not identify the media viewer.',
  '账号已切换，请刷新页面后继续。': 'The account changed. Refresh the page to continue.',
  '不支持此媒体类型。': 'Unsupported media type.',
  '附件编号无效。': 'Invalid attachment ID.',
  '媒体为空或超过大小限制。': 'The media is empty or exceeds the size limit.',
  '媒体引用无效或过多。': 'Invalid or too many media references.',
  '媒体大小无效。': 'Invalid media size.',
  '媒体内容为空。': 'The media is empty.',
  '媒体上传超时，请重试。': 'Media upload timed out. Please try again.',
  '同时上传的文件较多，请稍后重试。': 'Too many uploads in progress. Please try again shortly.',
  '媒体范围无效。': 'Invalid media range.',
  '媒体读取失败或浏览流量已达上限。': 'Media read failed, or the viewing traffic limit has been reached.',

  // Server: gallery, points, policy
  '分页参数无效。': 'Invalid pagination parameters.',
  '公开作品暂不可用。': 'The public gallery is unavailable right now.',
  '积分价格无效。': 'Invalid credit price.',
  '邀请码生成失败，请重试。': 'Could not generate an invite code. Please try again.',
  '每日额度环境变量必须是非负整数。': 'Daily quota environment variables must be non-negative integers.',
  '请配置可信代理后再使用转发 IP 标头。': 'Configure a trusted proxy before using forwarded IP headers.',
  '无法确定客户端 IP，请检查代理配置。': 'Could not determine the client IP. Check the proxy configuration.',
  '请求的创作参数不受支持。': 'The requested creation parameters are not supported.',
  '接口路径或方法不受支持。': 'Unsupported API path or method.',
  '创作服务暂时无法完成请求，请稍后重试。': 'The creation service could not complete the request. Please try again later.',
  '创作服务请求受限，请稍后重试。': 'The creation service is rate-limited. Please try again later.',

  // Server: startup
  '服务初始化失败，请查看服务端日志中的具体错误。': 'Service initialization failed. Check the server logs for details.',
  '运行环境缺少依赖或 SQLite 驱动无法加载，请在服务器安装生产依赖（npm install --omit=dev --include=optional），并使用适配当前操作系统的 node_modules。': 'The runtime is missing dependencies or the SQLite driver failed to load. Install production dependencies on the server (npm install --omit=dev --include=optional) and use a node_modules build that matches this OS.',
  '数据库文件无法打开或写入，请检查数据库及所在目录的权限和容器持久化卷。': 'The database file cannot be opened or written. Check permissions on the database and its directory, and the container’s persistent volume.',

  // Auth: verification and password reset
  '请输入有效邮箱。': 'Enter a valid email address.',
  '如果该邮箱已注册，我们已发送重置邮件。': 'If this email is registered, we have sent a reset message.',
  '验证邮件已发送，请查收后再登录。': 'We have sent a verification email. Check it, then sign in.',
  '如果该邮箱需要验证，我们已发送验证邮件。': 'If this email still needs verification, we have sent a message.',
  '验证链接无效或已过期，请重新申请验证邮件。': 'This verification link is invalid or has expired. Request a new email.',
  '重置链接无效或已过期，请重新申请。': 'This reset link is invalid or has expired. Request a new one.',
  '此账号使用 GitHub 登录，请继续用 GitHub 登录。': 'This account signs in with GitHub. Continue with GitHub.',
  '邮件服务尚未配置，暂时无法发送验证邮件。请联系管理员。': 'Email sending is not configured yet. Contact an administrator.',
  '邮件服务尚未配置，暂时无法注册。请联系管理员。': 'Email sending is not configured yet, so registration is unavailable. Contact an administrator.',
  '邮件服务尚未配置，暂时无法发送邮件。请联系管理员。': 'Email sending is not configured yet. Contact an administrator.',
  '验证邮件发送失败，请稍后重试。': 'Could not send the verification email. Please try again later.',
  '请先验证邮箱。如未收到邮件，可重新发送验证邮件。': 'Verify your email first. If you did not receive it, you can request another message.',
};
export default dict;
