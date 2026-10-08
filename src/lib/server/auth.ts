import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { APIContext } from 'astro';
import { db, User, LoginSession, eq, and, gt } from './database';
import { hash, env } from './policy';

const scrypt = promisify(scryptCallback);
const COOKIE = 'olai_session';
const MAX_AGE = 30 * 24 * 3600;
export async function passwordHash(password: string, salt = randomBytes(16).toString('hex')) {
  const key = await scrypt(password, salt, 64) as Buffer;
  return `scrypt:${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [scheme, salt, digest] = stored.split(':');
  if (scheme !== 'scrypt' || !salt || !digest) return false;
  const candidate = Buffer.from((await passwordHash(password, salt)).split(':')[2], 'hex');
  const expected = Buffer.from(digest, 'hex');
  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}
export async function currentUser(context: Pick<APIContext, 'cookies'>) {
  const token = context.cookies.get(COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const rows = await db.select({ id: User.id, email: User.email }).from(LoginSession)
    .innerJoin(User, eq(LoginSession.userId, User.id))
    .where(and(eq(LoginSession.tokenHash, hash(token)), gt(LoginSession.expiresAt, Date.now()))).limit(1);
  return rows[0] || null;
}
export async function endSession(context: Pick<APIContext, 'cookies'>) {
  const token = context.cookies.get(COOKIE)?.value;
  if (token) await db.delete(LoginSession).where(eq(LoginSession.tokenHash, hash(token)));
  context.cookies.delete(COOKIE, { path: '/' });
}
export async function startSession(context: Pick<APIContext, 'cookies' | 'url'>, userId: string) {
  await endSession(context);
  const token = randomBytes(32).toString('hex');
  await db.insert(LoginSession).values({ tokenHash: hash(token), userId, expiresAt: Date.now() + MAX_AGE * 1000 });
  context.cookies.set(COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax',
    secure: (env('SITE_ORIGIN') || context.url.origin).startsWith('https:'), maxAge: MAX_AGE });
}
export const userId = () => randomUUID();
