import type { APIRoute } from 'astro';
import { db, MediaObject, eq } from '../../../../lib/server/database';
import { adminFailure, logAdmin, requireAdmin } from '../../../../lib/server/admin';
import { deleteOSS, ossEnabled } from '../../../../lib/server/oss';

export const prerender = false;

export const DELETE: APIRoute = async context => {
  const admin = await requireAdmin(context);
  if (admin instanceof Response) return admin;
  try {
    const id = context.params.id || '';
    const [row] = await db.select().from(MediaObject).where(eq(MediaObject.id, id)).limit(1);
    if (!row) return Response.json({ error: { message: '媒体不存在。' } }, { status: 404 });
    if (ossEnabled()) {
      try { await deleteOSS(row.objectKey); } catch {
        return Response.json({ error: { message: '对象存储删除失败，记录已保留，请稍后重试。' } }, { status: 502 });
      }
    }
    await db.delete(MediaObject).where(eq(MediaObject.id, id));
    await logAdmin(context, admin, 'media.delete', id, { owner: row.owner, mime: row.mime, size: row.size });
    return Response.json({ deleted: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return adminFailure(error);
  }
};
