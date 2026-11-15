import type { APIRoute } from 'astro';
import { inArray, like, or } from 'drizzle-orm';
import { db, MediaObject, User, desc, eq, sql } from '../../../lib/server/database';
import { adminFailure, pageParam, requireAdmin } from '../../../lib/server/admin';

export const prerender = false;
const LIMIT = 24;

export const GET: APIRoute = async context => {
  const admin = await requireAdmin(context);
  if (admin instanceof Response) return admin;
  try {
    const { offset } = pageParam(context.url, LIMIT);
    const query = (context.url.searchParams.get('q') || '').trim().slice(0, 200);
    const filter = query ? or(like(MediaObject.owner, `%${query}%`), like(MediaObject.mime, `%${query}%`), eq(MediaObject.id, query)) : undefined;
    const [rows, [total], [summary]] = await Promise.all([
      db.select().from(MediaObject).where(filter).orderBy(desc(MediaObject.createdAt)).limit(LIMIT).offset(offset),
      db.select({ value: sql<number>`count(*)` }).from(MediaObject).where(filter),
      db.select({ bytes: sql<number>`coalesce(sum(${MediaObject.size}), 0)` }).from(MediaObject),
    ]);
    const ids = [...new Set(rows.filter(row => row.owner.startsWith('user:')).map(row => row.owner.slice(5)))];
    const users = ids.length ? await db.select({ id: User.id, email: User.email }).from(User).where(inArray(User.id, ids)) : [];
    const emailOf = new Map(users.map(row => [row.id, row.email]));
    return Response.json({
      media: rows.map(row => ({
        id: row.id, owner: row.owner, ownerEmail: row.owner.startsWith('user:') ? emailOf.get(row.owner.slice(5)) || '' : '',
        mime: row.mime, size: row.size, createdAt: row.createdAt,
      })),
      total: Number(total?.value ?? 0), bytes: Number(summary?.bytes ?? 0),
      nextPage: offset + rows.length < Number(total?.value ?? 0) ? offset / LIMIT + 2 : null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return adminFailure(error);
  }
};
