import type { APIRoute } from 'astro';
import { db, Invite, MediaObject, PointAccount, PointLedger, StudioRecord, User, eq, gte, sql } from '../../../lib/server/database';
import { adminFailure, requireAdmin } from '../../../lib/server/admin';
import { dayKey } from '../../../lib/server/policy';

export const prerender = false;

const number = (value: unknown) => Number(value ?? 0);

export const GET: APIRoute = async context => {
  const admin = await requireAdmin(context);
  if (admin instanceof Response) return admin;
  try {
    const now = Date.now();
    const today = Date.parse(`${dayKey(now)}T00:00:00+08:00`);
    const weekAgo = now - 7 * 86400_000;
    const days: string[] = [];
    for (let index = 13; index >= 0; index--) days.push(dayKey(now - index * 86400_000));

    const [[users], [newToday], [newWeek], [balances], [issued], [spent], [spends], [invites], [media], [records]] = await Promise.all([
      db.select({ value: sql<number>`count(*)` }).from(User),
      db.select({ value: sql<number>`count(*)` }).from(User).where(gte(User.createdAt, today)),
      db.select({ value: sql<number>`count(*)` }).from(User).where(gte(User.createdAt, weekAgo)),
      db.select({ value: sql<number>`coalesce(sum(${PointAccount.balance}), 0)` }).from(PointAccount),
      db.select({ value: sql<number>`coalesce(sum(case when ${PointLedger.delta} > 0 then ${PointLedger.delta} else 0 end), 0)` }).from(PointLedger),
      db.select({ value: sql<number>`coalesce(sum(case when ${PointLedger.delta} < 0 then -${PointLedger.delta} else 0 end), 0)` }).from(PointLedger),
      db.select({ count: sql<number>`count(*)`, points: sql<number>`coalesce(sum(-${PointLedger.delta}), 0)` })
        .from(PointLedger).where(sql`${PointLedger.reason} = 'spend' and ${PointLedger.createdAt} >= ${today}`),
      db.select({ total: sql<number>`count(*)`, rewarded: sql<number>`coalesce(sum(case when ${Invite.rewardedAt} is not null then 1 else 0 end), 0)` }).from(Invite),
      db.select({ count: sql<number>`count(*)`, bytes: sql<number>`coalesce(sum(${MediaObject.size}), 0)` }).from(MediaObject),
      db.select({ count: sql<number>`count(*)` }).from(StudioRecord).where(eq(StudioRecord.store, 'assets')),
    ]);

    const daily = await db.select({
      day: sql<string>`date(${PointLedger.createdAt} / 1000, 'unixepoch', '+8 hours')`,
      points: sql<number>`coalesce(sum(case when ${PointLedger.delta} < 0 then -${PointLedger.delta} else 0 end), 0)`,
      generations: sql<number>`coalesce(sum(case when ${PointLedger.reason} = 'spend' then 1 else 0 end), 0)`,
    }).from(PointLedger).where(gte(PointLedger.createdAt, now - 14 * 86400_000))
      .groupBy(sql`date(${PointLedger.createdAt} / 1000, 'unixepoch', '+8 hours')`);
    const byDay = new Map(daily.map(row => [row.day, row]));

    const recent = await db.select({
      id: User.id, email: User.email, createdAt: User.createdAt, balance: PointAccount.balance,
    }).from(User).leftJoin(PointAccount, eq(PointAccount.userId, User.id))
      .orderBy(sql`${User.createdAt} desc`).limit(8);

    return Response.json({
      users: { total: number(users?.value), today: number(newToday?.value), week: number(newWeek?.value) },
      points: { circulating: number(balances?.value), issued: number(issued?.value), spent: number(spent?.value) },
      today: { generations: number(spends?.count), points: number(spends?.points) },
      invites: { total: number(invites?.total), rewarded: number(invites?.rewarded) },
      media: { count: number(media?.count), bytes: number(media?.bytes) },
      records: number(records?.count),
      series: days.map(day => ({ day, points: number(byDay.get(day)?.points), generations: number(byDay.get(day)?.generations) })),
      recentUsers: recent.map(row => ({ ...row, balance: number(row.balance) })),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return adminFailure(error);
  }
};
