import { randomBytes } from 'node:crypto';
import { db, EmailToken, eq, and, gt } from './database';
import { hash } from './policy';

export type EmailTokenPurpose = 'verify' | 'reset';
const TTL = 30 * 60 * 1000;

export async function issueEmailToken(userId: string, purpose: EmailTokenPurpose): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  await db.delete(EmailToken).where(and(eq(EmailToken.userId, userId), eq(EmailToken.purpose, purpose)));
  await db.insert(EmailToken).values({
    tokenHash: hash(token), userId, purpose, expiresAt: now + TTL, createdAt: now,
  });
  return token;
}

export async function consumeEmailToken(token: string, purpose: EmailTokenPurpose): Promise<string | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const now = Date.now();
  const [row] = await db.select().from(EmailToken)
    .where(and(eq(EmailToken.tokenHash, hash(token)), eq(EmailToken.purpose, purpose), gt(EmailToken.expiresAt, now)))
    .limit(1);
  if (!row) return null;
  await db.delete(EmailToken).where(eq(EmailToken.tokenHash, row.tokenHash));
  return row.userId;
}
