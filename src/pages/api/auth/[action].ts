import type { APIRoute } from 'astro';
import { db, User, eq } from 'astro:db';
import { currentUser, endSession, passwordHash, startSession, userId, verifyPassword } from '../../../lib/server/auth';
import { ClientIPError, clientIP, dailyLimit, hash, sameOrigin } from '../../../lib/server/policy';
import { reserve } from '../../../lib/server/quota';

export const prerender = false;
const fail = (message: string, status: number) => Response.json({ error: { message } }, { status });
export const ALL: APIRoute = async context => {
  const { request, params } = context;
  const action = params.action;
  try {
    if (request.method === 'GET' && action === 'me') {
      const user = await currentUser(context);
      return Response.json({ user, generationLimit: dailyLimit(!!user) }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (request.method !== 'POST' || !['register', 'login', 'logout'].includes(action || '')) return fail('接口不存在。', 404);
    if (!sameOrigin(request)) return fail('不允许跨站调用。', 403);
    if (action === 'logout') { await endSession(context); return Response.json({ user: null }); }
    const ip = clientIP(request, context.clientAddress);
    const now = Date.now();
    if (!await reserve(hash(`auth:${ip}:${Math.floor(now / 900_000)}`), 20, now + 1800_000)) return fail('尝试次数过多，请 15 分钟后再试。', 429);
    const text = await request.text();
    if (text.length > 4096) return fail('注册或登录信息过长。', 400);
    let input;
    try { input = JSON.parse(text); } catch { return fail('请求内容无效。', 400); }
    const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
    const password = typeof input?.password === 'string' ? input.password : '';
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || password.length > 128) return fail('请输入有效邮箱和 8–128 位密码。', 400);
    let user;
    if (action === 'register') {
      const id = userId();
      const inserted = await db.insert(User).values({ id, email, passwordHash: await passwordHash(password), createdAt: now })
        .onConflictDoNothing({ target: User.email }).returning({ id: User.id, email: User.email });
      if (!inserted[0]) return fail('此邮箱已注册，请直接登录。', 409);
      user = inserted[0];
    } else {
      const [found] = await db.select().from(User).where(eq(User.email, email)).limit(1);
      // Perform the same expensive check for unknown addresses.
      const valid = await verifyPassword(password, found?.passwordHash || `scrypt:${'0'.repeat(32)}:${'0'.repeat(128)}`);
      if (!found || !valid) return fail('邮箱或密码不正确。', 401);
      user = { id: found.id, email: found.email };
    }
    await startSession(context, user.id);
    return Response.json({ user, generationLimit: dailyLimit(true) }, { status: action === 'register' ? 201 : 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof ClientIPError) return fail(error.message, 400);
    console.error('Account request failed:', error);
    return fail('账号服务暂不可用，请稍后重试。', 503);
  }
};
