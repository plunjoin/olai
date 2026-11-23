// 个人资料：昵称与预设头像。客户端和服务端共用同一套规则，避免两端校验不一致。
// 头像不保存图片文件，只用一组预设渐变加昵称首字渲染，跨端展示且无需对象存储。

export const PROFILE_NAME_MAX = 24;

export const AVATAR_THEMES = [
  { id: 'ocean', label: '海洋蓝', background: 'linear-gradient(135deg, #7c9cff 0%, #4d63d8 100%)' },
  { id: 'sunset', label: '日落橘', background: 'linear-gradient(135deg, #ffb199 0%, #f26d6d 100%)' },
  { id: 'mint', label: '薄荷绿', background: 'linear-gradient(135deg, #7ed8b4 0%, #2f9e78 100%)' },
  { id: 'violet', label: '紫罗兰', background: 'linear-gradient(135deg, #c3a6ff 0%, #7a5cf0 100%)' },
  { id: 'amber', label: '琥珀金', background: 'linear-gradient(135deg, #ffd479 0%, #e89a32 100%)' },
  { id: 'slate', label: '石板灰', background: 'linear-gradient(135deg, #a7b6d6 0%, #5d719b 100%)' },
] as const;

export type AvatarTheme = (typeof AVATAR_THEMES)[number]['id'];

/** 上传头像在数据库里保存为 upload:<uuid>，指向当前账号的私有媒体对象。 */
export const AVATAR_UPLOAD_PREFIX = 'upload:';
/** 服务端只接受经过客户端裁切压缩的小图，避免把视频或原图当作头像。 */
export const AVATAR_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
const MEDIA_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function uploadedAvatarID(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith(AVATAR_UPLOAD_PREFIX)) return null;
  const id = value.slice(AVATAR_UPLOAD_PREFIX.length);
  return MEDIA_UUID.test(id) ? id.toLowerCase() : null;
}

export function uploadedAvatarURL(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith(AVATAR_UPLOAD_PREFIX)) return null;
  const rest = value.slice(AVATAR_UPLOAD_PREFIX.length);
  // 别人的上传头像走公开作品媒体路由，/api/media 只对本人开放。
  const published = /^gallery\.([A-Za-z0-9_-]{1,100})\.([a-f0-9-]{36})$/i.exec(rest);
  if (published && MEDIA_UUID.test(published[2])) {
    return `/api/gallery/avatar/${encodeURIComponent(published[1])}.${published[2].toLowerCase()}`;
  }
  const id = uploadedAvatarID(value);
  return id ? `/api/media/${id}` : null;
}

/** /api/media/<uuid> → upload:<uuid>，把上传结果写进资料。 */
export function avatarUploadValue(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const match = /^\/api\/media\/([a-f0-9-]{36})$/i.exec(url);
  return match && MEDIA_UUID.test(match[1]) ? `${AVATAR_UPLOAD_PREFIX}${match[1].toLowerCase()}` : null;
}

/** 去掉控制字符，把连续空白收成一个空格；服务端与输入框共用。 */
export function normalizeProfileName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** 按字符（而不是 UTF-16 单元）计数，emoji 不会被算成两个字符。
 * 空昵称是合法的：界面回落到邮箱前缀，用户可以先只换头像。 */
export function validProfileName(name: string): boolean {
  return [...name].length <= PROFILE_NAME_MAX;
}

export function profileNameLength(name: string): number {
  return [...name].length;
}

/** 只返回已知的预设头像；空值或未知值表示使用默认品牌头像。 */
export function avatarTheme(value: unknown) {
  return AVATAR_THEMES.find(theme => theme.id === value) ?? null;
}

/** 头像上显示昵称首字；拉丁字母统一大写。 */
export function avatarInitial(name: string): string {
  const first = [...normalizeProfileName(name)][0] || '?';
  return /[a-z]/i.test(first) ? first.toUpperCase() : first;
}

/** 昵称为空时回落到邮箱前缀，与旧版展示保持一致。 */
export function profileDisplayName(user: { name?: string | null; email: string }): string {
  return normalizeProfileName(user.name) || user.email.split('@')[0] || '';
}
