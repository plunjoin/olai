import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, DailyUsage, eq, sql } from '../server/database';
import { refundGeneration, reserveGeneration } from '../server/quota';
import { hash } from '../server/policy';

// 清理测试数据
async function cleanupTestUsage() {
  await db.delete(DailyUsage);
}

beforeEach(cleanupTestUsage);
afterEach(cleanupTestUsage);

describe('quota refund', () => {
  it('refunds a reserved generation slot', async () => {
    const owner = 'ip:test-user';
    const kind = 'image';
    
    // 预留一个额度
    expect(await reserveGeneration(owner, kind, 3)).toBe(true);
    
    // 验证额度已使用
    const key = hash(`${owner}:${new Date().toISOString().slice(0, 10)}:${kind}`);
    let usage = await db.select().from(DailyUsage).where(eq(DailyUsage.key, key));
    expect(usage[0]?.count).toBe(1);
    
    // 退款
    await refundGeneration(owner, kind);
    
    // 验证额度已退还
    usage = await db.select().from(DailyUsage).where(eq(DailyUsage.key, key));
    expect(usage[0]?.count).toBe(0);
  });

  it('allows reuse after refund', async () => {
    const owner = 'ip:test-user';
    const kind = 'video';
    const limit = 1;
    
    // 用完额度
    expect(await reserveGeneration(owner, kind, limit)).toBe(true);
    expect(await reserveGeneration(owner, kind, limit)).toBe(false);
    
    // 退款
    await refundGeneration(owner, kind);
    
    // 可以再次使用
    expect(await reserveGeneration(owner, kind, limit)).toBe(true);
  });

  it('does not go below zero on multiple refunds', async () => {
    const owner = 'ip:test-user';
    const kind = 'music';
    
    // 没有预留就退款
    await refundGeneration(owner, kind);
    
    // 仍然可以正常预留
    expect(await reserveGeneration(owner, kind, 1)).toBe(true);
    
    // 多次退款
    await refundGeneration(owner, kind);
    await refundGeneration(owner, kind);
    await refundGeneration(owner, kind);
    
    // 检查计数不为负
    const key = hash(`${owner}:${new Date().toISOString().slice(0, 10)}:${kind}`);
    const usage = await db.select().from(DailyUsage).where(eq(DailyUsage.key, key));
    expect(usage[0]?.count).toBe(0);
  });

  it('refunds only affect the specific owner and kind', async () => {
    const owner1 = 'ip:user1';
    const owner2 = 'ip:user2';
    const kind = 'image';
    
    // 两个用户都预留
    expect(await reserveGeneration(owner1, kind, 2)).toBe(true);
    expect(await reserveGeneration(owner2, kind, 2)).toBe(true);
    
    // 只退款 owner1
    await refundGeneration(owner1, kind);
    
    // owner1 可以再次预留，owner2 的额度不受影响
    expect(await reserveGeneration(owner1, kind, 2)).toBe(true);
    expect(await reserveGeneration(owner2, kind, 2)).toBe(true);
  });
});
