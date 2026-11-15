import type { APIRoute } from 'astro';
import { publicCatalog } from '../../lib/server/models';

export const prerender = false;

// 公开的模型选择列表：只包含公开 ID、别名、类型与积分价格。
export const GET: APIRoute = async () => {
  try {
    return Response.json(await publicCatalog(), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ models: [] }, { headers: { 'Cache-Control': 'no-store' } });
  }
};
