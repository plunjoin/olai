import { t } from './i18n';
import type { PublicModel } from './types';

const IMAGE_TIERS = ['1K', '2K', '4K'];
const VIDEO_TIERS = ['360p', '720p', '1080p', '4k'];

/** 把服务端下发的积分档位整理成一行说明；不包含任何上游模型信息。 */
export function modelPriceLabel(model: PublicModel): string {
  if (model.kind === 'image' || model.kind === 'video') {
    const tiers = model.kind === 'image' ? IMAGE_TIERS : VIDEO_TIERS;
    const prices = (model.kind === 'image' ? model.prices.image : model.prices.video) ?? {};
    const list = tiers.map(tier => t('{tier} {price} 积分', { tier, price: prices[tier] ?? 0 })).join(' · ');
    return model.kind === 'video' ? `${list}${t('（每秒）')}` : list;
  }
  if (model.kind === 'music') return t('每分钟 {n} 积分', { n: model.prices.music?.perMinute ?? 0 });
  return t('每条消息 {n} 积分', { n: model.prices.chat?.perMessage ?? 0 });
}
