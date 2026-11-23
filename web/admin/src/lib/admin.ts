import { intlLocale, t } from './i18n';

export async function adminApi<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  // FormData sets its own multipart boundary; only JSON string bodies get the
  // explicit header.
  if (typeof init?.body === 'string') headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    // The console session expired while the tab was open. Reloading lets the
    // app shell decide between the console and its own login page.
    window.location.reload();
    throw new Error(t('登录已失效，请重新登录。'));
  }
  if (!response.ok) throw new Error((data as any)?.error?.message || t('请求失败，请稍后重试。'));
  return data as T;
}

export const adminWhen = (value: number | null | undefined) =>
  value ? new Date(value).toLocaleString(intlLocale(), { hour12: false }) : '—';

export function adminBytes(value: number) {
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

export const LEDGER_REASONS: Record<string, string> = {
  signup: t('注册赠送'), spend: t('生成消耗'), refund: t('失败退款'), invite: t('邀请奖励'),
  'invite-bonus': t('被邀请奖励'), 'admin-adjust': t('管理员调整'),
};

export const ADMIN_ACTIONS: Record<string, string> = {
  'points.adjust': t('调整积分'), 'user.ban': t('停用账号'), 'user.unban': t('恢复账号'),
  'settings.update': t('修改设置'), 'media.delete': t('删除媒体'),
  'models.update': t('修改模型'), 'models.sync': t('同步模型'),
  'report.resolve': t('处理举报'), 'report.dismiss': t('忽略举报'),
  'gallery.hide': t('隐藏作品'), 'gallery.unhide': t('恢复作品显示'),
  'work.create': t('发布作品'), 'work.update': t('修改作品'), 'work.delete': t('删除作品'),
  'work.hide': t('隐藏作品'), 'work.unhide': t('恢复作品显示'),
  'site.update': t('更新整站'),
  'admin.login': t('后台登录'), 'admin.password': t('修改后台密码'),
};

export const REPORT_REASONS: Record<string, string> = {
  inappropriate: t('不当内容'), copyright: t('侵权内容'), spam: t('垃圾或误导内容'), other: t('其他问题'),
};

export const REPORT_STATUS: Record<string, string> = {
  open: t('待处理'), resolved: t('已处理'), dismissed: t('已忽略'),
};

export const MODEL_KIND_NAMES: Record<string, string> = {
  chat: t('对话'), image: t('图像'), video: t('视频'), music: t('音乐'),
};

export interface AdminWork {
  id: string; recordKey: string; recordId: string;
  title: string; displayTitle?: string; prompt?: string;
  kind: string; visibility: string; hidden: boolean;
  system: boolean; userId: string; email: string;
  createdAt: number; updatedAt: number;
}

export type FeedbackMessage = { tone: 'ok' | 'error'; text: string } | null;

export function errorMessage(failure: unknown, fallback: string) {
  return failure instanceof Error ? failure.message : t(fallback);
}
