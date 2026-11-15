import type { APIRoute } from 'astro';
import { inArray } from 'drizzle-orm';
import {
  db, Invite, MediaObject, OAuthAccount, PointAccount, PointLedger, StudioRecord, User, UserBan,
  desc, eq, sql,
} from '../../../../lib/server/database';
import { adminFailure, requireAdmin } from '../../../../lib/server/admin';

export const prerender = false;

export const GET: APIRoute = async context => {
  const admin = await requireAdmin(context);
  if (admin instanceof Response) return admin;
  try {
    const id = context.params.id || '';
    const [user] = await db.select({
      id: User.id, email: User.email, createdAt: User.createdAt,
      balance: PointAccount.balance, banReason: UserBan.reason, bannedAt: UserBan.bannedAt,
    }).from(User).leftJoin(PointAccount, eq(PointAccount.userId, User.id))
      .leftJoin(UserBan, eq(UserBan.userId, User.id)).where(eq(User.id, id)).limit(1);
    if (!user) return Response.json({ error: { message: '账号不存在。' } }, { status: 404 });

    const [ledger, invites, oauth, [spend], [media], [records], [invitedBy]] = await Promise.all([
      db.select({ delta: PointLedger.delta, reason: PointLedger.reason, refId: PointLedger.refId, createdAt: PointLedger.createdAt })
        .from(PointLedger).where(eq(PointLedger.userId, id)).orderBy(desc(PointLedger.createdAt)).limit(30),
      db.select({ inviteeId: Invite.inviteeId, code: Invite.code, createdAt: Invite.createdAt, rewardedAt: Invite.rewardedAt })
        .from(Invite).where(eq(Invite.inviterId, id)).orderBy(desc(Invite.createdAt)).limit(50),
      db.select({ provider: OAuthAccount.provider, createdAt: OAuthAccount.createdAt })
        .from(OAuthAccount).where(eq(OAuthAccount.userId, id)),
      db.select({ count: sql<number>`count(*)`, points: sql<number>`coalesce(sum(-${PointLedger.delta}), 0)` })
        .from(PointLedger).where(sql`${PointLedger.userId} = ${id} and ${PointLedger.reason} = 'spend'`),
      db.select({ count: sql<number>`count(*)`, bytes: sql<number>`coalesce(sum(${MediaObject.size}), 0)` })
        .from(MediaObject).where(eq(MediaObject.owner, `user:${id}`)),
      db.select({ count: sql<number>`count(*)` }).from(StudioRecord)
        .where(sql`${StudioRecord.userId} = ${id} and ${StudioRecord.store} = 'assets'`),
      db.select({ inviterId: Invite.inviterId, code: Invite.code, createdAt: Invite.createdAt, rewardedAt: Invite.rewardedAt })
        .from(Invite).where(eq(Invite.inviteeId, id)).limit(1),
    ]);

    const ids = [...new Set(invites.map(row => row.inviteeId).concat(invitedBy ? [invitedBy.inviterId] : []))];
    const emails = ids.length
      ? await db.select({ id: User.id, email: User.email }).from(User).where(inArray(User.id, ids))
      : [];
    const emailOf = new Map(emails.map(row => [row.id, row.email]));

    return Response.json({
      user: {
        id: user.id, email: user.email, createdAt: user.createdAt, balance: Number(user.balance ?? 0),
        banned: user.bannedAt ? { reason: user.banReason, bannedAt: user.bannedAt } : null,
      },
      oauth,
      stats: {
        spendCount: Number(spend?.count ?? 0), spendPoints: Number(spend?.points ?? 0),
        mediaCount: Number(media?.count ?? 0), mediaBytes: Number(media?.bytes ?? 0),
        recordCount: Number(records?.count ?? 0),
      },
      ledger,
      invites: invites.map(row => ({ ...row, email: emailOf.get(row.inviteeId) || '', rewarded: Boolean(row.rewardedAt) })),
      invitedBy: invitedBy ? {
        email: emailOf.get(invitedBy.inviterId) || '', code: invitedBy.code,
        createdAt: invitedBy.createdAt, rewardedAt: invitedBy.rewardedAt,
      } : null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return adminFailure(error);
  }
};
