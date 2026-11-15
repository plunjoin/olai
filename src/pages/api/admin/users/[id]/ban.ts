import type { APIRoute } from 'astro';
import { adminFailure, banUser, logAdmin, requireAdmin, unbanUser } from '../../../../../lib/server/admin';

export const prerender = false;

export const POST: APIRoute = async context => {
  const admin = await requireAdmin(context);
  if (admin instanceof Response) return admin;
  try {
    const text = await context.request.text();
    if (text.length > 4096) return Response.json({ error: { message: '请求内容过长。' } }, { status: 400 });
    let input: any;
    try { input = JSON.parse(text); } catch { return Response.json({ error: { message: '请求内容无效。' } }, { status: 400 }); }
    const userId = context.params.id || '';
    if (userId === admin.id) return Response.json({ error: { message: '不能停用自己的账号。' } }, { status: 400 });
    const banned = input?.banned === true;
    if (banned) {
      const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
      if (!reason || reason.length > 200) return Response.json({ error: { message: '请填写 1–200 字的停用原因。' } }, { status: 400 });
      await banUser(userId, admin, reason);
      await logAdmin(context, admin, 'user.ban', userId, { reason });
    } else {
      await unbanUser(userId);
      await logAdmin(context, admin, 'user.unban', userId, {});
    }
    return Response.json({ banned }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return adminFailure(error);
  }
};
