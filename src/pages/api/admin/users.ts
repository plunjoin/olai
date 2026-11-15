import type { APIRoute } from 'astro';
import { or, like } from 'drizzle-orm';
import { db, PointAccount, User, UserBan, desc, eq, sql } from '../../../lib/server/database';
import { adminFailure, pageParam, requireAdmin } from '../../../lib/server/admin';

export const prerender = false;
const LIMIT = 20;

export const GET: APIRoute = async context => {
  const admin = await requireAdmin(context);
  if (admin instanceof Response) return admin;
  try {
    const { offset } = pageParam(context.url, LIMIT);
    const query = (context.url.searchParams.get('q') || '').trim().slice(0, 200);
    const filter = query ? or(like(User.email, `%${query}%`), eq(User.id, query)) : undefined;
    const [rows, [total]] = await Promise.all([
      db.select({
        id: User.id, email: User.email, createdAt: User.createdAt,
        balance: PointAccount.balance, bannedAt: UserBan.bannedAt, banReason: UserBan.reason,
      }).from(User)
        .leftJoin(PointAccount, eq(PointAccount.userId, User.id))
        .leftJoin(UserBan, eq(UserBan.userId, User.id))
        .where(filter).orderBy(desc(User.createdAt)).limit(LIMIT).offset(offset),
      db.select({ value: sql<number>`count(*)` }).from(User).where(filter),
    ]);
    return Response.json({
      users: rows.map(row => ({ ...row, balance: Number(row.balance ?? 0) })),
      total: Number(total?.value ?? 0),
      nextPage: offset + rows.length < Number(total?.value ?? 0) ? offset / LIMIT + 2 : null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return adminFailure(error);
  }
};
