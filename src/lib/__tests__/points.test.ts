import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { db, eq, Invite, InviteCode, PointAccount, PointLedger, User } from '../server/database';
import { acceptInvite, balanceOf, chargePoints, ensureInviteCode, inviteStats, inviterByCode, maybeRewardInvite, refundPoints } from '../server/points';

const created: string[] = [];

async function createUser() {
  const id = randomUUID();
  created.push(id);
  await db.insert(User).values({ id, email: `${id}@points.test`, passwordHash: 'test', createdAt: Date.now() });
  return id;
}
async function ledger(userId: string, reason: string) {
  return (await db.select().from(PointLedger).where(eq(PointLedger.userId, userId))).filter(row => row.reason === reason);
}

afterEach(async () => {
  for (const id of created.splice(0)) {
    await db.delete(PointLedger).where(eq(PointLedger.userId, id));
    await db.delete(PointAccount).where(eq(PointAccount.userId, id));
    await db.delete(InviteCode).where(eq(InviteCode.userId, id));
    await db.delete(Invite).where(eq(Invite.inviterId, id));
    await db.delete(Invite).where(eq(Invite.inviteeId, id));
    await db.delete(User).where(eq(User.id, id));
  }
});

describe('points ledger', () => {
  it('grants the signup bonus exactly once', async () => {
    const id = await createUser();
    expect(await balanceOf(id)).toBe(100);
    expect(await balanceOf(id)).toBe(100);
    expect(await ledger(id, 'signup')).toHaveLength(1);
  });

  it('charges atomically and refuses to overdraw', async () => {
    const id = await createUser();
    expect(await chargePoints(id, 30, randomUUID())).toBe(70);
    expect(await chargePoints(id, 100, randomUUID())).toBeNull();
    expect(await balanceOf(id)).toBe(70);
    expect(await ledger(id, 'spend')).toHaveLength(1);
  });

  it('refunds a charge only once', async () => {
    const id = await createUser();
    const ref = randomUUID();
    await chargePoints(id, 30, ref);
    await refundPoints(id, 30, ref);
    await refundPoints(id, 30, ref);
    expect(await balanceOf(id)).toBe(100);
    expect(await ledger(id, 'refund')).toHaveLength(1);
  });

  it('rewards both sides once after the invitee generates', async () => {
    const inviter = await createUser();
    const invitee = await createUser();
    const code = await ensureInviteCode(inviter);
    expect(await inviterByCode(code)).toBe(inviter);
    await acceptInvite(inviter, invitee, code);
    await maybeRewardInvite(invitee);
    await maybeRewardInvite(invitee);
    expect(await balanceOf(inviter)).toBe(130);
    expect(await balanceOf(invitee)).toBe(120);
    expect(await inviteStats(inviter)).toEqual({ invited: 1, rewarded: 1, pending: 0 });
  });

  it('keeps one invite code per account and rejects unknown codes', async () => {
    const id = await createUser();
    const code = await ensureInviteCode(id);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(await ensureInviteCode(id)).toBe(code);
    expect(await inviterByCode('ZZZZZZZZ')).toBeNull();
    expect(await inviterByCode('bad')).toBeNull();
  });
});
