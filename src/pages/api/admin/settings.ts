import type { APIRoute } from 'astro';
import { adminFailure, logAdmin, requireAdmin } from '../../../lib/server/admin';
import { refreshSettings, saveSettings, settingsForClient, SettingsError } from '../../../lib/server/settings';

export const prerender = false;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export const GET: APIRoute = async context => {
  const admin = await requireAdmin(context);
  if (admin instanceof Response) return admin;
  try {
    await refreshSettings(true);
    return json(settingsForClient());
  } catch (error) {
    return adminFailure(error);
  }
};

export const PUT: APIRoute = async context => {
  const admin = await requireAdmin(context);
  if (admin instanceof Response) return admin;
  try {
    const text = await context.request.text();
    if (text.length > 64 * 1024) return json({ error: { message: '请求内容过长。' } }, 400);
    let input: any;
    try { input = JSON.parse(text); } catch { return json({ error: { message: '请求内容无效。' } }, 400); }
    const values = input?.values ?? {};
    const reset = input?.reset ?? [];
    // 防止管理员把自己移出白名单或把列表恢复成不含自己的 .env 值，导致后台无法再进入。
    if ('ADMIN_EMAILS' in values || (Array.isArray(reset) && reset.includes('ADMIN_EMAILS'))) {
      const next = 'ADMIN_EMAILS' in values
        ? String(values.ADMIN_EMAILS).split(',').map((item: string) => item.trim().toLowerCase()).filter(Boolean)
        : String(process.env.ADMIN_EMAILS ?? import.meta.env.ADMIN_EMAILS ?? '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
      if (!next.includes(admin.email.toLowerCase()))
        return json({ error: { message: '新的管理员列表必须包含当前账号邮箱，否则会失去后台权限。' } }, 400);
    }
    const changed = await saveSettings(values, reset, admin.id);
    if (changed.length) await logAdmin(context, admin, 'settings.update', 'settings', { keys: changed });
    return json({ ...settingsForClient(), changed });
  } catch (error) {
    if (error instanceof SettingsError) return json({ error: { message: error.message } }, 400);
    return adminFailure(error);
  }
};
