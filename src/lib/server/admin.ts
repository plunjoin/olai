// 管理后台共用的鉴权、审计与账号操作。所有判断都在服务端完成，
// 前端只负责展示；非管理员即使知道接口地址也无法读写。
import { randomUUID } from 'node:crypto';
import type { APIContext } from 'astro';
import { AdminLog, LoginSession, PointAccount, PointLedger, User, UserBan, and, db, eq, gte, sql } from './database';
import { balanceOf } from './points';
import { currentUser } from './auth';
import { ClientIPError, clientIP } from './policy';
import { setting } from './settings';

export type AdminUser = { id: string; email: string };
export class AccountBannedError extends Error {
  constructor() { super('账号已被停用。'); }
}

export function adminEmails(): string[] {
  return setting('ADMIN_EMAILS').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
}

export function isAdminEmail(email: string): boolean {
  return adminEmails().includes(email.trim().toLowerCase());
}

export async function adminUser(context: Pick<APIContext, 'cookies'>): Promise<AdminUser | null> {
  const user = await currentUser(context);
  return user && isAdminEmail(user.email) ? user : null;
}

/** 返回管理员或一个可直接返回的 401/403 响应。 */
export async function requireAdmin(context: APIContext): Promise<AdminUser | Response> {
  const user = await currentUser(context);
  if (!user) return Response.json({ error: { message: '请先登录管理员账号。' } }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  if (!isAdminEmail(user.email)) return Response.json({ error: { message: '没有管理权限。' } }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  return user;
}

export function adminFailure(error: unknown): Response {
  console.error('Admin request failed:', error instanceof Error ? error.message : error);
  return Response.json({ error: { message: '操作失败，请稍后重试。' } }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
}

function requestIP(context: APIContext): string {
  try { return clientIP(context.request, context.clientAddress); } catch (error) {
    if (error instanceof ClientIPError) return 'unknown';
    throw error;
  }
}

/** 审计日志只记录操作与目标，不保存密码、密钥或完整提示词。 */
export async function logAdmin(context: APIContext, admin: AdminUser, action: string, target: string, detail: Record<string, unknown>): Promise<void> {
  const text = JSON.stringify(detail).slice(0, 4000);
  await db.insert(AdminLog).values({
    id: randomUUID(), adminId: admin.id, adminEmail: admin.email,
    action, target, detail: text, ip: requestIP(context), createdAt: Date.now(),
  });
}

export async function isBanned(userId: string): Promise<boolean> {
  const [row] = await db.select({ userId: UserBan.userId }).from(UserBan).where(eq(UserBan.userId, userId)).limit(1);
  return Boolean(row);
}

/** 封禁后立即注销该账号的所有登录会话。 */
export async function banUser(userId: string, admin: AdminUser, reason: string): Promise<void> {
  const now = Date.now();
  await db.batch([
    db.insert(UserBan).values({ userId, reason, bannedBy: admin.id, bannedAt: now })
      .onConflictDoUpdate({ target: UserBan.userId, set: { reason, bannedBy: admin.id, bannedAt: now } }),
    db.delete(LoginSession).where(eq(LoginSession.userId, userId)),
  ]);
}

export async function unbanUser(userId: string): Promise<void> {
  await db.delete(UserBan).where(eq(UserBan.userId, userId));
}

export class PointsAdjustError extends Error {}

/**
 * 管理员加减积分：负数使用条件更新，余额不足则整笔失败；
 * 每笔都写入 PointLedger（reason=admin-adjust），不直接改余额。
 */
export async function adjustPoints(userId: string, delta: number, admin: AdminUser): Promise<number | null> {
  if (!Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > 1_000_000) throw new PointsAdjustError('调整数量无效。');
  const [target] = await db.select({ id: User.id }).from(User).where(eq(User.id, userId)).limit(1);
  if (!target) throw new PointsAdjustError('账号不存在。');
  await balanceOf(userId);
  const now = Date.now();
  const ref = `admin:${admin.id}:${randomUUID()}`;
  if (delta > 0) {
    await db.batch([
      db.update(PointAccount).set({ balance: sql`${PointAccount.balance} + ${delta}`, updatedAt: now })
        .where(eq(PointAccount.userId, userId)),
      db.insert(PointLedger).values({ id: randomUUID(), userId, delta, reason: 'admin-adjust', refId: ref, createdAt: now }),
    ]);
  } else {
    const [updated] = await db.update(PointAccount)
      .set({ balance: sql`${PointAccount.balance} + ${delta}`, updatedAt: now })
      .where(and(eq(PointAccount.userId, userId), gte(PointAccount.balance, -delta)))
      .returning({ balance: PointAccount.balance });
    if (!updated) return null;
    await db.insert(PointLedger).values({ id: randomUUID(), userId, delta, reason: 'admin-adjust', refId: ref, createdAt: now });
  }
  const [row] = await db.select({ balance: PointAccount.balance }).from(PointAccount).where(eq(PointAccount.userId, userId)).limit(1);
  return row?.balance ?? null;
}

export function pageParam(url: URL, limit = 20): { page: number; limit: number; offset: number } {
  const rawPage = url.searchParams.get('page') ?? '1';
  const page = /^\d+$/.test(rawPage) ? Math.min(1_000_000, Math.max(1, Number(rawPage))) : 1;
  return { page, limit, offset: (page - 1) * limit };
}
