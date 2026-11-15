import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { and, db, eq, Invite, InviteCode, OAuthAccount, PointAccount, PointLedger, User } from '../server/database';
import { loginWithGithub } from '../server/oauth';
import { ensureInviteCode, inviteStats } from '../server/points';

const created: string[] = [];
const email = () => `${randomUUID()}@oauth.test`;
const githubId = () => String(Date.now()) + String(Math.floor(Math.random() * 1_000_000));

afterEach(async () => {
  for (const id of created.splice(0)) {
    await db.delete(OAuthAccount).where(eq(OAuthAccount.userId, id));
    await db.delete(PointLedger).where(eq(PointLedger.userId, id));
    await db.delete(PointAccount).where(eq(PointAccount.userId, id));
    await db.delete(InviteCode).where(eq(InviteCode.userId, id));
    await db.delete(Invite).where(eq(Invite.inviterId, id));
    await db.delete(Invite).where(eq(Invite.inviteeId, id));
    await db.delete(User).where(eq(User.id, id));
  }
});

describe('GitHub account linking', () => {
  it('creates one account and reuses the provider binding', async () => {
    const profile = { id: githubId(), login: 'octocat', email: email() };
    const first = await loginWithGithub(profile);
    created.push(first.id);
    expect(await loginWithGithub(profile)).toEqual(first);
    const [user] = await db.select().from(User).where(eq(User.id, first.id));
    expect(user.passwordHash).toBe(`oauth:github:${profile.id}`);
    expect(await db.select().from(OAuthAccount)
      .where(and(eq(OAuthAccount.provider, 'github'), eq(OAuthAccount.providerId, profile.id)))).toHaveLength(1);
  });

  it('links an existing email account instead of creating a duplicate', async () => {
    const id = randomUUID();
    created.push(id);
    const address = email();
    await db.insert(User).values({ id, email: address, passwordHash: 'scrypt:salt:digest', createdAt: Date.now() });
    const user = await loginWithGithub({ id: githubId(), login: 'person', email: address });
    expect(user.id).toBe(id);
    expect(await db.select().from(OAuthAccount).where(eq(OAuthAccount.userId, id))).toHaveLength(1);
  });

  it('records an invite for a new GitHub account', async () => {
    const inviterId = randomUUID();
    created.push(inviterId);
    await db.insert(User).values({ id: inviterId, email: email(), passwordHash: 'scrypt:salt:digest', createdAt: Date.now() });
    const code = await ensureInviteCode(inviterId);
    const user = await loginWithGithub({ id: githubId(), login: 'invitee', email: email() }, code);
    created.push(user.id);
    expect(await inviteStats(inviterId)).toEqual({ invited: 1, rewarded: 0, pending: 1 });
  });
});
