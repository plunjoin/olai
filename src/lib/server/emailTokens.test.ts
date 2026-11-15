import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { db, EmailToken, User, eq } from './database';
import { consumeEmailToken, issueEmailToken } from './emailTokens';
import { mailConfigured } from './mail';

const created: string[] = [];

afterEach(async () => {
  for (const id of created.splice(0)) {
    await db.delete(EmailToken).where(eq(EmailToken.userId, id));
    await db.delete(User).where(eq(User.id, id));
  }
});

describe('email tokens', () => {
  it('issues a token once and rejects a second consume', async () => {
    const id = randomUUID();
    created.push(id);
    await db.insert(User).values({ id, email: `${id}@mail.test`, passwordHash: 'scrypt:salt:digest', createdAt: Date.now() });
    const token = await issueEmailToken(id, 'verify');
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(await consumeEmailToken(token, 'verify')).toBe(id);
    expect(await consumeEmailToken(token, 'verify')).toBeNull();
  });

  it('does not consume a token for a different purpose', async () => {
    const id = randomUUID();
    created.push(id);
    await db.insert(User).values({ id, email: `${id}@mail.test`, passwordHash: 'scrypt:salt:digest', createdAt: Date.now() });
    const token = await issueEmailToken(id, 'reset');
    expect(await consumeEmailToken(token, 'verify')).toBeNull();
    expect(await consumeEmailToken(token, 'reset')).toBe(id);
  });
});

describe('mail configuration', () => {
  it('is disabled when the SMTP password is missing', () => {
    const previous = {
      MAIL_HOST: process.env.MAIL_HOST,
      MAIL_USER: process.env.MAIL_USER,
      MAIL_PASS: process.env.MAIL_PASS,
      MAIL_FROM: process.env.MAIL_FROM,
    };
    process.env.MAIL_HOST = 'mail.bllii.com';
    process.env.MAIL_USER = 'admin@bllii.com';
    process.env.MAIL_FROM = 'noreply@olai.cc';
    delete process.env.MAIL_PASS;
    try {
      expect(mailConfigured()).toBe(false);
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});
