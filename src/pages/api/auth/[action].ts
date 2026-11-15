import type { APIRoute } from 'astro';
import { db, EmailToken, Invite, User, eq } from '../../../lib/server/database';
import { currentUser, endSession, passwordHash, startSession, userId, verifyPassword } from '../../../lib/server/auth';
import { ClientIPError, chatDailyLimit, clientIP, dailyLimit, hash, sameOrigin } from '../../../lib/server/policy';
import { reserve } from '../../../lib/server/quota';
import { accountSummary, acceptInvite, inviterByCode, normalizeInviteCode, validInviteCode } from '../../../lib/server/points';
import { publicPrices } from '../../../lib/server/pricing';
import { githubEnabled } from '../../../lib/server/github';
import { setting } from '../../../lib/server/settings';
import { isAdminEmail, isBanned } from '../../../lib/server/admin';
import { consumeEmailToken, issueEmailToken } from '../../../lib/server/emailTokens';
import { MailConfigError, mailConfigured, sendResetEmail, sendVerificationEmail, siteOrigin } from '../../../lib/server/mail';

export const prerender = false;
const fail = (message: string, status: number) => Response.json({ error: { message } }, { status });
const okHeaders = { 'Cache-Control': 'no-store' };
const emailOk = (email: string) => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const passwordOk = (password: string) => password.length >= 8 && password.length <= 128;

async function signedIn(context: Parameters<APIRoute>[0], user: { id: string; email: string }, status = 200) {
  await startSession(context, user.id);
  const summary = await accountSummary(user.id).catch(() => null);
  return Response.json({
    user, admin: isAdminEmail(user.email), generationLimit: dailyLimit(true), chatLimit: chatDailyLimit(true),
    points: summary?.points, inviteCode: summary?.inviteCode, prices: publicPrices(),
  }, { status, headers: okHeaders });
}

async function dispatchVerification(origin: string, userId: string, email: string) {
  const token = await issueEmailToken(userId, 'verify');
  await sendVerificationEmail(email, `${origin}/login?verify=${token}`);
}

async function dispatchReset(origin: string, userId: string, email: string) {
  const token = await issueEmailToken(userId, 'reset');
  await sendResetEmail(email, `${origin}/login?reset=${token}`);
}

export const ALL: APIRoute = async context => {
  const { request, params } = context;
  const action = params.action;
  try {
    if (request.method === 'GET' && action === 'me') {
      const user = await currentUser(context);
      if (setting('OSS_ENABLED') === 'true') {
        // Establish the HttpOnly device cookie before concurrent media requests.
        const { mediaIdentity } = await import('../../../lib/server/media');
        await mediaIdentity(context);
      }
      const summary = user ? await accountSummary(user.id).catch(() => null) : null;
      return Response.json({ user, admin: user ? isAdminEmail(user.email) : false, generationLimit: dailyLimit(!!user), chatLimit: chatDailyLimit(!!user), mediaStorage: setting('OSS_ENABLED') === 'true' ? 'oss' : 'local', shortFilm: setting('AI_SHORT_FILM') === 'true', points: summary?.points, inviteCode: summary?.inviteCode, prices: publicPrices(), githubLogin: githubEnabled() }, { headers: okHeaders });
    }

    const postActions = ['register', 'login', 'logout', 'forgot', 'reset', 'verify', 'resend'];
    if (request.method !== 'POST' || !postActions.includes(action || '')) return fail('接口不存在。', 404);
    if (!sameOrigin(request)) return fail('不允许跨站调用。', 403);
    if (action === 'logout') { await endSession(context); return Response.json({ user: null }); }

    const ip = clientIP(request, context.clientAddress);
    const now = Date.now();
    if (!await reserve(hash(`auth:${ip}:${Math.floor(now / 900_000)}`), 20, now + 1800_000)) return fail('尝试次数过多，请 15 分钟后再试。', 429);
    const text = await request.text();
    if (text.length > 4096) return fail('注册或登录信息过长。', 400);
    let input: Record<string, unknown>;
    try { input = JSON.parse(text); } catch { return fail('请求内容无效。', 400); }

    const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
    const password = typeof input?.password === 'string' ? input.password : '';
    const token = typeof input?.token === 'string' ? input.token.trim() : '';
    const origin = siteOrigin(context.url);

    if (action === 'verify') {
      const userId = await consumeEmailToken(token, 'verify');
      if (!userId) return fail('验证链接无效或已过期，请重新申请验证邮件。', 400);
      const [found] = await db.select({ id: User.id, email: User.email }).from(User).where(eq(User.id, userId)).limit(1);
      if (!found) return fail('验证链接无效或已过期，请重新申请验证邮件。', 400);
      if (await isBanned(found.id)) return fail('此账号已被停用，请联系管理员。', 403);
      await db.update(User).set({ emailVerifiedAt: now }).where(eq(User.id, found.id));
      return signedIn(context, found);
    }

    if (action === 'reset') {
      if (!passwordOk(password)) return fail('请输入 8–128 位新密码。', 400);
      const userId = await consumeEmailToken(token, 'reset');
      if (!userId) return fail('重置链接无效或已过期，请重新申请。', 400);
      const [found] = await db.select({ id: User.id, email: User.email, passwordHash: User.passwordHash }).from(User).where(eq(User.id, userId)).limit(1);
      if (!found) return fail('重置链接无效或已过期，请重新申请。', 400);
      if (found.passwordHash.startsWith('oauth:')) return fail('此账号使用 GitHub 登录，请继续用 GitHub 登录。', 400);
      if (await isBanned(found.id)) return fail('此账号已被停用，请联系管理员。', 403);
      await db.update(User).set({ passwordHash: await passwordHash(password) }).where(eq(User.id, found.id));
      return signedIn(context, { id: found.id, email: found.email });
    }

    if (action === 'forgot' || action === 'resend') {
      if (!emailOk(email)) return fail('请输入有效邮箱。', 400);
      if (!mailConfigured()) return fail('邮件服务尚未配置，暂时无法发送邮件。请联系管理员。', 503);
      const silent = Response.json({
        user: null, generationLimit: dailyLimit(false),
        message: action === 'forgot' ? '如果该邮箱已注册，我们已发送重置邮件。' : '如果该邮箱需要验证，我们已发送验证邮件。',
      }, { headers: okHeaders });
      const [found] = await db.select().from(User).where(eq(User.email, email)).limit(1);
      if (!found || await isBanned(found.id)) return silent;
      if (action === 'forgot') {
        if (found.passwordHash.startsWith('oauth:')) return silent;
        await dispatchReset(origin, found.id, found.email);
        return silent;
      }
      if (found.emailVerifiedAt) return silent;
      await dispatchVerification(origin, found.id, found.email);
      return silent;
    }

    if (!emailOk(email) || !passwordOk(password)) return fail('请输入有效邮箱和 8–128 位密码。', 400);
    const inviteCode = normalizeInviteCode(input?.inviteCode);
    if (inviteCode && !validInviteCode(inviteCode)) return fail('邀请码无效。', 400);
    const inviterId = action === 'register' && inviteCode ? await inviterByCode(inviteCode) : null;
    if (action === 'register' && inviteCode && !inviterId) return fail('邀请码无效，请检查后重试。', 400);

    if (action === 'register') {
      if (!mailConfigured()) return fail('邮件服务尚未配置，暂时无法注册。请联系管理员。', 503);
      const id = userId();
      const inserted = await db.insert(User).values({ id, email, passwordHash: await passwordHash(password), createdAt: now })
        .onConflictDoNothing({ target: User.email }).returning({ id: User.id, email: User.email });
      if (!inserted[0]) return fail('此邮箱已注册，请直接登录。', 409);
      const user = inserted[0];
      // 邀请关系先记录；积分在邀请对象完成首次生成后发放，防止注册机刷分。
      // 邀请记录失败不应阻止注册，只记录日志。
      if (inviterId) await acceptInvite(inviterId, id, inviteCode).catch(error => console.error('Invite record failed:', error));
      try {
        await dispatchVerification(origin, user.id, user.email);
      } catch (error) {
        await db.delete(EmailToken).where(eq(EmailToken.userId, user.id));
        await db.delete(Invite).where(eq(Invite.inviteeId, user.id));
        await db.delete(User).where(eq(User.id, user.id));
        if (error instanceof MailConfigError) return fail(error.message, 503);
        console.error('Verification email failed:', error);
        return fail('验证邮件发送失败，请稍后重试。', 503);
      }
      return Response.json({
        user: null, pendingVerification: true, generationLimit: dailyLimit(false),
        message: '验证邮件已发送，请查收后再登录。',
      }, { status: 201, headers: okHeaders });
    }

    const [found] = await db.select().from(User).where(eq(User.email, email)).limit(1);
    // Perform the same expensive check for unknown addresses.
    const valid = await verifyPassword(password, found?.passwordHash || `scrypt:${'0'.repeat(32)}:${'0'.repeat(128)}`);
    if (!found || !valid) return fail('邮箱或密码不正确。', 401);
    if (await isBanned(found.id)) return fail('此账号已被停用，请联系管理员。', 403);
    if (!found.emailVerifiedAt) {
      if (mailConfigured()) {
        await dispatchVerification(origin, found.id, found.email).catch(error => console.error('Verification email failed:', error));
      }
      return fail('请先验证邮箱。如未收到邮件，可重新发送验证邮件。', 403);
    }
    return signedIn(context, { id: found.id, email: found.email });
  } catch (error) {
    if (error instanceof ClientIPError) return fail(error.message, 400);
    if (error instanceof MailConfigError) return fail(error.message, 503);
    console.error('Account request failed:', error);
    return fail('账号服务暂不可用，请稍后重试。', 503);
  }
};
