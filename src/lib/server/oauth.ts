import { and, db, eq, OAuthAccount, User } from './database';
import { userId } from './auth';
import { AccountBannedError, isBanned } from './admin';
import { acceptInvite, inviterByCode, validInviteCode } from './points';
import type { GithubProfile } from './github';

const PROVIDER = 'github';

/**
 * GitHub 登录：先按绑定关系查找，再按已验证邮箱关联已有账号，最后才创建新账号。
 * 密码列写入不可用于登录的标记，邮箱密码登录对第三方账号始终失败。
 */
export async function loginWithGithub(profile: GithubProfile, inviteCode = ''): Promise<{ id: string; email: string }> {
  const [linked] = await db.select({ id: User.id, email: User.email }).from(OAuthAccount)
    .innerJoin(User, eq(OAuthAccount.userId, User.id))
    .where(and(eq(OAuthAccount.provider, PROVIDER), eq(OAuthAccount.providerId, profile.id))).limit(1);
  if (linked) {
    if (await isBanned(linked.id)) throw new AccountBannedError();
    return linked;
  }

  const [existing] = await db.select({ id: User.id, email: User.email }).from(User)
    .where(eq(User.email, profile.email)).limit(1);
  if (existing) {
    if (await isBanned(existing.id)) throw new AccountBannedError();
    await db.insert(OAuthAccount).values({ provider: PROVIDER, providerId: profile.id, userId: existing.id, createdAt: Date.now() })
      .onConflictDoNothing();
    await db.update(User).set({ emailVerifiedAt: Date.now() }).where(eq(User.id, existing.id));
    return existing;
  }

  const id = userId();
  const inserted = await db.insert(User)
    .values({ id, email: profile.email, passwordHash: `oauth:${PROVIDER}:${profile.id}`, createdAt: Date.now(), emailVerifiedAt: Date.now() })
    .onConflictDoNothing({ target: User.email })
    .returning({ id: User.id, email: User.email });
  let user = inserted[0];
  if (!user) {
    // 并发注册同一邮箱：复用已存在的账号。
    const [again] = await db.select({ id: User.id, email: User.email }).from(User).where(eq(User.email, profile.email)).limit(1);
    if (!again) throw new Error('账号创建失败。');
    user = again;
  }
  await db.insert(OAuthAccount).values({ provider: PROVIDER, providerId: profile.id, userId: user.id, createdAt: Date.now() })
    .onConflictDoNothing();
  if (validInviteCode(inviteCode)) {
    const inviter = await inviterByCode(inviteCode);
    if (inviter) await acceptInvite(inviter, user.id, inviteCode).catch(error => console.error('Invite record failed:', error));
  }
  return user;
}
