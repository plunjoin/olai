import { db, DailyUsage, LoginSession, sql, lt } from './database';
import { dayKey, hash } from './policy';

// A single conditional UPSERT reserves a slot, including across server instances.
let lastCleanup = 0;
export async function reserve(key: string, limit: number, expiresAt: number): Promise<boolean> {
  const now = Date.now();
  if (now - lastCleanup > 3600_000) {
    lastCleanup = now;
    await db.batch([
      db.delete(DailyUsage).where(lt(DailyUsage.expiresAt, now)),
      db.delete(LoginSession).where(lt(LoginSession.expiresAt, now)),
    ]);
  }
  if (limit === 0) return false;
  const rows = await db.insert(DailyUsage).values({ key, count: 1, expiresAt })
    .onConflictDoUpdate({ target: DailyUsage.key, set: { count: sql`${DailyUsage.count} + 1` },
      setWhere: sql`${DailyUsage.count} < ${limit}` }).returning({ count: DailyUsage.count });
  return rows.length > 0;
}
export async function reserveGeneration(owner: string, kind: string, limit: number) {
  return reserve(hash(`${owner}:${dayKey()}:${kind}`), limit, Date.now() + 2 * 86400_000);
}
