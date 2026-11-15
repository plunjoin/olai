import type { APIRoute } from 'astro';
import { db, PointLedger, StudioRecord, User, desc, eq, sql } from '../../../lib/server/database';
import { adminFailure, pageParam, requireAdmin } from '../../../lib/server/admin';

export const prerender = false;
const LIMIT = 30;

export const GET: APIRoute = async context => {
  const admin = await requireAdmin(context);
  if (admin instanceof Response) return admin;
  try {
    const { offset } = pageParam(context.url, LIMIT);
    const [spends, [spendTotal], records, [recordTotal]] = await Promise.all([
      db.select({
        id: PointLedger.id, userId: PointLedger.userId, email: User.email,
        delta: PointLedger.delta, refId: PointLedger.refId, createdAt: PointLedger.createdAt,
      }).from(PointLedger).innerJoin(User, eq(User.id, PointLedger.userId))
        .where(eq(PointLedger.reason, 'spend')).orderBy(desc(PointLedger.createdAt)).limit(LIMIT).offset(offset),
      db.select({ count: sql<number>`count(*)`, points: sql<number>`coalesce(sum(-${PointLedger.delta}), 0)` })
        .from(PointLedger).where(eq(PointLedger.reason, 'spend')),
      db.select({
        key: StudioRecord.key, userId: StudioRecord.userId, email: User.email,
        recordId: StudioRecord.recordId, updatedAt: StudioRecord.updatedAt,
      }).from(StudioRecord).innerJoin(User, eq(User.id, StudioRecord.userId))
        .where(eq(StudioRecord.store, 'assets')).orderBy(desc(StudioRecord.updatedAt)).limit(LIMIT),
      db.select({ count: sql<number>`count(*)` }).from(StudioRecord).where(eq(StudioRecord.store, 'assets')),
    ]);
    return Response.json({
      spends,
      totals: { generations: Number(spendTotal?.count ?? 0), points: Number(spendTotal?.points ?? 0), records: Number(recordTotal?.count ?? 0) },
      records,
      nextPage: offset + spends.length < Number(spendTotal?.count ?? 0) ? offset / LIMIT + 2 : null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return adminFailure(error);
  }
};
