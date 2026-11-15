import type { APIRoute } from 'astro';
import { adjustPoints, adminFailure, logAdmin, PointsAdjustError, requireAdmin } from '../../../../../lib/server/admin';

export const prerender = false;

export const POST: APIRoute = async context => {
  const admin = await requireAdmin(context);
  if (admin instanceof Response) return admin;
  try {
    const text = await context.request.text();
    if (text.length > 4096) return Response.json({ error: { message: '请求内容过长。' } }, { status: 400 });
    let input: any;
    try { input = JSON.parse(text); } catch { return Response.json({ error: { message: '请求内容无效。' } }, { status: 400 }); }
    const delta = Number(input?.delta);
    const note = typeof input?.note === 'string' ? input.note.trim() : '';
    if (!Number.isSafeInteger(delta) || delta === 0) return Response.json({ error: { message: '调整数量必须是非零整数。' } }, { status: 400 });
    if (!note || note.length > 200) return Response.json({ error: { message: '请填写 1–200 字的调整原因。' } }, { status: 400 });
    const userId = context.params.id || '';
    if (userId === admin.id) return Response.json({ error: { message: '不能调整自己的积分。' } }, { status: 400 });
    const balance = await adjustPoints(userId, delta, admin);
    if (balance === null) return Response.json({ error: { message: '余额不足，不能扣减为负数。' } }, { status: 409 });
    await logAdmin(context, admin, 'points.adjust', userId, { delta, balance, note });
    return Response.json({ balance }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof PointsAdjustError) return Response.json({ error: { message: error.message } }, { status: 400 });
    return adminFailure(error);
  }
};
