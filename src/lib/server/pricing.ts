// 积分价格只在服务端计算。客户端只能拿到公开档位和单价，
// 永远看不到上游模型 ID、网关地址或密钥。
import { setting } from './settings';

export const IMAGE_QUALITIES = ['1K', '2K', '4K'] as const;
export const VIDEO_RESOLUTIONS = ['360p', '720p', '1080p', '4k'] as const;

const IMAGE_DEFAULTS: Record<string, number> = { '1K': 1, '2K': 2, '4K': 4 };
// 视频按“每秒”计价，默认与画质成正比。
const VIDEO_DEFAULTS: Record<string, number> = { '360p': 1, '720p': 2, '1080p': 4, '4k': 8 };

function pointsEnv(name: string, fallback: number): number {
  const raw = setting(name, String(fallback));
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error('积分配置必须是非负整数。');
  return Number(raw);
}

export function imageCost(quality: string): number {
  return pointsEnv(`POINT_IMAGE_${quality.toUpperCase()}`, IMAGE_DEFAULTS[quality] ?? 0);
}
export function videoCostPerSecond(resolution: string): number {
  return pointsEnv(`POINT_VIDEO_${resolution.toUpperCase()}`, VIDEO_DEFAULTS[resolution] ?? 0);
}
export function videoCost(resolution: string, seconds: number): number {
  return Math.max(0, Math.ceil(seconds)) * videoCostPerSecond(resolution);
}
export function musicCost(seconds: number): number {
  const perMinute = pointsEnv('POINT_MUSIC_PER_MINUTE', 2);
  return Math.max(1, Math.ceil(Math.max(1, seconds) / 60)) * perMinute;
}
/** 普通对话默认不计积分；配置为正整数后按条扣费。 */
export function chatCost(): number {
  return pointsEnv('POINT_CHAT', 0);
}
export function signupBonus(): number {
  return pointsEnv('POINT_SIGNUP_BONUS', 100);
}
export function inviteReward(): number {
  return pointsEnv('POINT_INVITE_REWARD', 30);
}
export function inviteBonus(): number {
  return pointsEnv('POINT_INVITE_BONUS', 20);
}
/** 每个邀请人每天最多发放几次邀请奖励；0 表示暂停邀请奖励。 */
export function inviteDailyLimit(): number {
  return pointsEnv('POINT_INVITE_DAILY_LIMIT', 5);
}

/** 下发给浏览器展示的公开价目表，只包含档位与积分数。 */
export function publicPrices() {
  return {
    image: Object.fromEntries(IMAGE_QUALITIES.map(quality => [quality, imageCost(quality)])),
    video: Object.fromEntries(VIDEO_RESOLUTIONS.map(resolution => [resolution, videoCostPerSecond(resolution)])),
    musicPerMinute: pointsEnv('POINT_MUSIC_PER_MINUTE', 2),
    chatPerMessage: chatCost(),
  };
}
