import { randomInt, randomUUID } from 'node:crypto';
import { and, db, desc, eq, gte, isNull, sql, Invite, InviteCode, PointAccount, PointLedger } from './database';
import { dayKey } from './policy';
import { inviteBonus, inviteDailyLimit, inviteReward, signupBonus } from './pricing';

// 积分账本：余额只在 PointAccount 保存一份快照，PointLedger 只追加不修改。
// 扣费使用条件 UPDATE（余额足够才扣），与每日额度同样的原子写法，多实例安全。
// 发放 / 退款用 batch 写入余额和流水；唯一索引 (reason, refId) 保证同一笔只发一次。

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const codePattern = /^[A-HJ-NP-Z2-9]{6,12}$/;
const dayStart = () => Date.parse(`${dayKey()}T00:00:00+08:00`);

export interface AccountSummary { points: number; inviteCode: string }

function randomCode(): string {
  let code = '';
  for (let index = 0; index < 8; index++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

async function createAccount(userId: string): Promise<number> {
  const now = Date.now();
  const bonus = signupBonus();
  const created = await db.insert(PointAccount).values({ userId, balance: bonus, updatedAt: now })
    .onConflictDoNothing({ target: PointAccount.userId }).returning({ balance: PointAccount.balance });
  if (created[0]) {
    await db.insert(PointLedger).values({ id: randomUUID(), userId, delta: bonus, reason: 'signup', refId: userId, createdAt: now })
      .onConflictDoNothing();
    return created[0].balance;
  }
  // 另一个请求刚创建了账户：读回它的余额，绝不重复发放注册奖励。
  const [row] = await db.select({ balance: PointAccount.balance }).from(PointAccount).where(eq(PointAccount.userId, userId)).limit(1);
  return row?.balance ?? 0;
}

export async function balanceOf(userId: string): Promise<number> {
  const [row] = await db.select({ balance: PointAccount.balance }).from(PointAccount).where(eq(PointAccount.userId, userId)).limit(1);
  return row ? row.balance : createAccount(userId);
}

/**
 * 原子扣费。返回扣费后的余额；余额不足返回 null，账户不会被扣减。
 * refId 与请求一一对应，同一笔扣费只可能成功一次。
 */
export async function chargePoints(userId: string, cost: number, refId: string): Promise<number | null> {
  if (!Number.isSafeInteger(cost) || cost < 0) throw new Error('积分价格无效。');
  if (cost === 0) return balanceOf(userId);
  await balanceOf(userId);
  const [updated] = await db.update(PointAccount)
    .set({ balance: sql`${PointAccount.balance} - ${cost}`, updatedAt: Date.now() })
    .where(and(eq(PointAccount.userId, userId), gte(PointAccount.balance, cost)))
    .returning({ balance: PointAccount.balance });
  if (!updated) return null;
  try {
    await db.insert(PointLedger).values({ id: randomUUID(), userId, delta: -cost, reason: 'spend', refId, createdAt: Date.now() });
  } catch (error) {
    // 流水写入失败就把余额补回去，避免“扣了积分却没有记录”。
    await db.update(PointAccount).set({ balance: sql`${PointAccount.balance} + ${cost}`, updatedAt: Date.now() })
      .where(eq(PointAccount.userId, userId));
    throw error;
  }
  return updated.balance;
}

/** 同一笔退款只入账一次；重复调用（含并发）由唯一索引拒绝，余额不变。 */
export async function refundPoints(userId: string, cost: number, refId: string): Promise<void> {
  if (!Number.isSafeInteger(cost) || cost <= 0) return;
  try {
    await credit(userId, cost, 'refund', refId);
  } catch {
    // 已经退过或账户不存在：退款是幂等的，不向调用方报错。
  }
}

async function credit(userId: string, amount: number, reason: string, refId: string): Promise<void> {
  if (amount <= 0) return;
  await balanceOf(userId);
  const now = Date.now();
  await db.batch([
    db.update(PointAccount).set({ balance: sql`${PointAccount.balance} + ${amount}`, updatedAt: now })
      .where(eq(PointAccount.userId, userId)),
    db.insert(PointLedger).values({ id: randomUUID(), userId, delta: amount, reason, refId, createdAt: now }),
  ]);
}

export async function ensureInviteCode(userId: string): Promise<string> {
  const [existing] = await db.select({ code: InviteCode.code }).from(InviteCode).where(eq(InviteCode.userId, userId)).limit(1);
  if (existing) return existing.code;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const inserted = await db.insert(InviteCode).values({ code, userId, createdAt: Date.now() })
      .onConflictDoNothing().returning({ code: InviteCode.code });
    if (inserted[0]) return inserted[0].code;
    const [again] = await db.select({ code: InviteCode.code }).from(InviteCode).where(eq(InviteCode.userId, userId)).limit(1);
    if (again) return again.code;
  }
  throw new Error('邀请码生成失败，请重试。');
}

export async function accountSummary(userId: string): Promise<AccountSummary> {
  return { points: await balanceOf(userId), inviteCode: await ensureInviteCode(userId) };
}

export function normalizeInviteCode(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}
export function validInviteCode(code: string): boolean {
  return codePattern.test(code);
}

export async function inviterByCode(code: string): Promise<string | null> {
  if (!validInviteCode(code)) return null;
  const [row] = await db.select({ userId: InviteCode.userId }).from(InviteCode).where(eq(InviteCode.code, code)).limit(1);
  return row?.userId ?? null;
}

/** 记录邀请关系；奖励延迟到被邀请人完成首次生成后发放。 */
export async function acceptInvite(inviterId: string, inviteeId: string, code: string): Promise<void> {
  if (!inviterId || inviterId === inviteeId) return;
  await db.insert(Invite).values({ id: randomUUID(), inviterId, inviteeId, code, createdAt: Date.now(), rewardedAt: null })
    .onConflictDoNothing({ target: Invite.inviteeId });
}

/**
 * 被邀请人首次成功生成后发放双方奖励。
 * 按邀请人每日上限控制；发放后标记 rewardedAt，并发调用不会重复发放。
 */
export async function maybeRewardInvite(inviteeId: string): Promise<void> {
  const [invite] = await db.select().from(Invite)
    .where(and(eq(Invite.inviteeId, inviteeId), isNull(Invite.rewardedAt))).limit(1);
  if (!invite) return;
  const [today] = await db.select({ count: sql<number>`count(*)` }).from(Invite)
    .where(and(eq(Invite.inviterId, invite.inviterId), gte(Invite.rewardedAt, dayStart())));
  if (Number(today?.count ?? 0) >= inviteDailyLimit()) return;
  const reward = inviteReward(), bonus = inviteBonus();
  try {
    if (reward > 0) await credit(invite.inviterId, reward, 'invite', `invite:${inviteeId}`);
    if (bonus > 0) await credit(inviteeId, bonus, 'invite-bonus', `invite-bonus:${inviteeId}`);
  } catch {
    // 已发放过（唯一索引拒绝）：继续标记，不重复入账。
  }
  await db.update(Invite).set({ rewardedAt: Date.now() })
    .where(and(eq(Invite.inviteeId, inviteeId), isNull(Invite.rewardedAt)));
}

export async function inviteStats(userId: string): Promise<{ invited: number; rewarded: number; pending: number }> {
  const rows = await db.select({ rewardedAt: Invite.rewardedAt }).from(Invite).where(eq(Invite.inviterId, userId));
  const rewarded = rows.filter(row => row.rewardedAt).length;
  return { invited: rows.length, rewarded, pending: rows.length - rewarded };
}

export async function recentPoints(userId: string, limit = 50) {
  return db.select({ delta: PointLedger.delta, reason: PointLedger.reason, createdAt: PointLedger.createdAt })
    .from(PointLedger).where(eq(PointLedger.userId, userId))
    .orderBy(desc(PointLedger.createdAt)).limit(limit);
}
