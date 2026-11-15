import type { APIRoute } from 'astro';
import { currentUser } from '../../../lib/server/auth';
import { accountSummary, inviteStats, recentPoints } from '../../../lib/server/points';
import { publicPrices } from '../../../lib/server/pricing';

export const prerender = false;

export const GET: APIRoute = async context => {
  const user = await currentUser(context);
  if (!user) return Response.json({ error: { message: '请先登录后查看积分。' } }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  const summary = await accountSummary(user.id);
  return Response.json({
    balance: summary.points,
    inviteCode: summary.inviteCode,
    prices: publicPrices(),
    invite: await inviteStats(user.id),
    ledger: await recentPoints(user.id),
  }, { headers: { 'Cache-Control': 'no-store' } });
};
