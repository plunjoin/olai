import type { APIRoute } from 'astro';
import { like, or } from 'drizzle-orm';
import { AdminLog, db, desc, sql } from '../../../lib/server/database';
import { adminFailure, pageParam, requireAdmin } from '../../../lib/server/admin';

export const prerender = false;
const LIMIT = 40;

export const GET: APIRoute = async context => {
  const admin = await requireAdmin(context);
  if (admin instanceof Response) return admin;
  try {
    const { offset } = pageParam(context.url, LIMIT);
    const query = (context.url.searchParams.get('q') || '').trim().slice(0, 200);
    const filter = query ? or(like(AdminLog.action, `%${query}%`), like(AdminLog.adminEmail, `%${query}%`), like(AdminLog.target, `%${query}%`)) : undefined;
    const [rows, [total]] = await Promise.all([
      db.select().from(AdminLog).where(filter).orderBy(desc(AdminLog.createdAt)).limit(LIMIT).offset(offset),
      db.select({ value: sql<number>`count(*)` }).from(AdminLog).where(filter),
    ]);
    return Response.json({
      logs: rows,
      total: Number(total?.value ?? 0),
      nextPage: offset + rows.length < Number(total?.value ?? 0) ? offset / LIMIT + 2 : null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return adminFailure(error);
  }
};
