import type { APIRoute } from 'astro';
import { adminFailure, logAdmin, requireAdmin } from '../../../lib/server/admin';
import { catalogForAdmin, ModelsError, saveModels, syncModels } from '../../../lib/server/models';

export const prerender = false;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export const GET: APIRoute = async context => {
  const admin = await requireAdmin(context);
  if (admin instanceof Response) return admin;
  try {
    return json(await catalogForAdmin());
  } catch (error) {
    return adminFailure(error);
  }
};

// POST 从网关拉取最新模型列表；已有模型的别名、类型与价格保持不变。
export const POST: APIRoute = async context => {
  const admin = await requireAdmin(context);
  if (admin instanceof Response) return admin;
  try {
    const result = await syncModels();
    await logAdmin(context, admin, 'models.sync', 'models', result);
    return json({ ...(await catalogForAdmin()), sync: result });
  } catch (error) {
    if (error instanceof ModelsError) return json({ error: { message: error.message } }, 400);
    return adminFailure(error);
  }
};

export const PUT: APIRoute = async context => {
  const admin = await requireAdmin(context);
  if (admin instanceof Response) return admin;
  try {
    const text = await context.request.text();
    if (text.length > 256 * 1024) return json({ error: { message: '请求内容过长。' } }, 400);
    let input: any;
    try { input = JSON.parse(text); } catch { return json({ error: { message: '请求内容无效。' } }, 400); }
    const result = await saveModels(input?.models);
    await logAdmin(context, admin, 'models.update', 'models', result);
    return json({ ...(await catalogForAdmin()), updated: result.updated });
  } catch (error) {
    if (error instanceof ModelsError) return json({ error: { message: error.message } }, 400);
    return adminFailure(error);
  }
};
