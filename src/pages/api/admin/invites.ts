import type { APIRoute } from 'astro';
import { inArray } from 'drizzle-orm';
import { db, Invite, User, desc, sql } from '../../../lib/server/database';
import { adminFailure, pageParam, requireAdmin } from '../../../lib/server/admin';

export const prerender = false;
const LIMIT = 30;

export const GET: APIRoute = async context => {
  const admin = await requireAdmin(context);
  if (admin instanceof Response) return admin;
  try {
    const { offset } = pageParam(context.url, LIMIT);
    const [rows, [total], top] = await Promise.all([
      db.select().from(Invite).orderBy(desc(Invite.createdAt)).limit(LIMIT).offset(offset),
      db.select({ value: sql<number>`count(*)` }).from(Invite),
      db.select({
        inviterId: Invite.inviterId, total: sql<number>`count(*)`,
        rewarded: sql<number>`coalesce(sum(case when ${Invite.rewardedAt} is not null then 1 else 0 end), 0)`,
      }).from(Invite).groupBy(Invite.inviterId).orderBy(sql`count(*) desc`).limit(10),
    ]);
    const ids = [...new Set(rows.flatMap(row => [row.inviterId, row.inviteeId]).concat(top.map(row => row.inviterId)))];
    const emails = ids.length ? await db.select({ id: User.id, email: User.email }).from(User).where(inArray(User.id, ids)) : [];
    const emailOf = new Map(emails.map(row => [row.id, row.email]));
    return Response.json({
      invites: rows.map(row => ({
        id: row.id, code: row.code, createdAt: row.createdAt, rewardedAt: row.rewardedAt,
        inviterId: row.inviterId, inviterEmail: emailOf.get(row.inviterId) || '',
        inviteeId: row.inviteeId, inviteeEmail: emailOf.get(row.inviteeId) || '',
      })),
      top: top.map(row => ({ ...row, email: emailOf.get(row.inviterId) || '' })),
      total: Number(total?.value ?? 0),
      nextPage: offset + rows.length < Number(total?.value ?? 0) ? offset / LIMIT + 2 : null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return adminFailure(error);
  }
};
