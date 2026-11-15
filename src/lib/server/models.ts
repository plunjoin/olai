// 模型目录与按模型计价。上游模型 ID 只保存在服务端；客户端只拿到 publicId 和别名。
import { createHash } from 'node:crypto';
import { asc, db, eq, ModelCatalog } from './database';
import { aiEnv } from './aiConfig';
import { chatCost, IMAGE_QUALITIES, imageCost, musicCost, VIDEO_RESOLUTIONS, videoCostPerSecond } from './pricing';
import type { ModelKind, ModelPrices } from '../types';

export type SelectableKind = Exclude<ModelKind, 'speech'>;
export interface ModelChoice { publicId: string; upstreamId: string; kind: SelectableKind; prices: ModelPrices }

export class ModelsError extends Error {}

const KINDS: SelectableKind[] = ['chat', 'image', 'video', 'music'];
const KIND_LABEL: Record<SelectableKind, string> = { chat: '对话', image: '图像', video: '视频', music: '音乐' };
const MAX_POINTS = 1_000_000;

function asKind(value: unknown): SelectableKind | null {
  return typeof value === 'string' && (KINDS as string[]).includes(value) ? value as SelectableKind : null;
}

/** 稳定但不透明的公开 ID，同一上游模型在任何实例上都得到相同值。 */
export function publicIdFor(upstreamId: string): string {
  return `mdl_${createHash('sha256').update(upstreamId).digest('hex').slice(0, 24)}`;
}

/** 按模型名称猜测类型；管理员可在后台修正。 */
export function guessKind(id: string): SelectableKind {
  if (/(?:^|[-_/])(?:imagen|image|dall-?e|flux|stable-diffusion|sd[0-9x]|seedream|midjourney|kolors|cogview|nano-banana|gpt-image|qwen-image)(?:[-_./]|$)/i.test(id)) return 'image';
  if (/(?:^|[-_/])(?:veo|sora|kling|runway|hailuo|seedance|pika|luma|video|omni)(?:[-_./]|$)/i.test(id)) return 'video';
  if (/(?:^|[-_/])(?:lyria|music|suno|udio|audio|speech|tts|elevenlabs|voice)(?:[-_./]|$)/i.test(id)) return 'music';
  return 'chat';
}

/** 新接入模型的默认价格沿用当前的全局档位价。 */
export function defaultPrices(kind: SelectableKind): ModelPrices {
  if (kind === 'image') return { image: Object.fromEntries(IMAGE_QUALITIES.map(tier => [tier, imageCost(tier)])) };
  if (kind === 'video') return { video: Object.fromEntries(VIDEO_RESOLUTIONS.map(tier => [tier, videoCostPerSecond(tier)])) };
  if (kind === 'music') return { music: { perMinute: musicCost(60) } };
  return { chat: { perMessage: chatCost() } };
}

function points(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_POINTS ? value : null;
}

/** 校验并补全价格表：漏填的档位沿用全局默认价。 */
export function normalizePrices(kind: SelectableKind, value: unknown): ModelPrices {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ModelsError('模型价格格式无效。');
  const raw = value as Record<string, any>;
  if (kind === 'image' || kind === 'video') {
    const tiers: readonly string[] = kind === 'image' ? IMAGE_QUALITIES : VIDEO_RESOLUTIONS;
    const bucket = raw[kind];
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) throw new ModelsError('模型价格格式无效。');
    const prices: Record<string, number> = {};
    for (const tier of tiers) {
      const price = points(bucket[tier]);
      if (price === null) throw new ModelsError(`请填写有效的 ${tier} 价格。`);
      prices[tier] = price;
    }
    return { [kind]: prices } as ModelPrices;
  }
  const unit = kind === 'music' ? 'perMinute' : 'perMessage';
  const bucket = raw[kind];
  const price = bucket && typeof bucket === 'object' ? points(bucket[unit]) : null;
  if (price === null) throw new ModelsError(`请填写有效的${kind === 'music' ? '每分钟' : '每条消息'}价格。`);
  return { [kind]: { [unit]: price } } as ModelPrices;
}

function readPrices(kind: SelectableKind, text: string): ModelPrices {
  try { return normalizePrices(kind, JSON.parse(text)); } catch { return defaultPrices(kind); }
}

/** 本次生成的实际积分；缺失档位时回落到全局价目表。 */
export function modelPoints(choice: ModelChoice, options: { quality?: string; resolution?: string; seconds?: number }): number {
  if (choice.kind === 'image') {
    const tier = options.quality || '1K';
    return choice.prices.image?.[tier] ?? imageCost(tier);
  }
  if (choice.kind === 'video') {
    const tier = options.resolution || '720p';
    const seconds = Math.max(1, Math.ceil(options.seconds ?? 4));
    return seconds * (choice.prices.video?.[tier] ?? videoCostPerSecond(tier));
  }
  if (choice.kind === 'music') {
    const seconds = Math.max(1, options.seconds ?? 120);
    return Math.max(1, Math.ceil(seconds / 60)) * (choice.prices.music?.perMinute ?? musicCost(60));
  }
  return choice.prices.chat?.perMessage ?? chatCost();
}

export async function resolveModel(publicId: string, kind: SelectableKind): Promise<ModelChoice | null> {
  if (!/^mdl_[a-f0-9]{24}$/.test(publicId)) return null;
  const [row] = await db.select().from(ModelCatalog).where(eq(ModelCatalog.publicId, publicId)).limit(1);
  const rowKind = row ? asKind(row.kind) : null;
  if (!row || !rowKind || row.enabled !== 1 || rowKind !== kind) return null;
  return { publicId: row.publicId, upstreamId: row.upstreamId, kind: rowKind, prices: readPrices(rowKind, row.prices) };
}

/** 浏览器可见的模型选择列表：只有公开 ID、别名、类型和积分价格。 */
export async function publicCatalog(): Promise<{ models: { id: string; name: string; kind: SelectableKind; prices: ModelPrices }[] }> {
  const rows = await db.select().from(ModelCatalog).where(eq(ModelCatalog.enabled, 1))
    .orderBy(asc(ModelCatalog.sort), asc(ModelCatalog.alias));
  return {
    models: rows.flatMap(row => {
      const kind = asKind(row.kind);
      return kind ? [{ id: row.publicId, name: row.alias, kind, prices: readPrices(kind, row.prices) }] : [];
    }),
  };
}

export async function catalogForAdmin() {
  const rows = await db.select().from(ModelCatalog).orderBy(asc(ModelCatalog.sort), asc(ModelCatalog.upstreamId));
  return {
    kinds: KINDS,
    // 后台切换模型类型时用同一套默认价，避免出现空价格。
    defaults: Object.fromEntries(KINDS.map(kind => [kind, defaultPrices(kind)])),
    models: rows.map(row => {
      const kind = asKind(row.kind) ?? 'chat';
      return {
        publicId: row.publicId, upstreamId: row.upstreamId, alias: row.alias, kind,
        enabled: row.enabled === 1, prices: readPrices(kind, row.prices), updatedAt: row.updatedAt,
      };
    }),
  };
}

/** 从网关的 OpenAI 兼容 /models 拉取模型；已有模型保留别名与价格。 */
export async function syncModels(): Promise<{ added: number; upstream: number }> {
  const base = aiEnv('AI_API_BASE_URL').replace(/\/$/, '');
  const key = aiEnv('AI_API_KEY');
  if (!base || !key) throw new ModelsError('请先配置 AI 服务地址与密钥。');
  let response: Response;
  try {
    response = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new ModelsError('无法连接模型网关，请检查 AI 服务地址与网络。');
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new ModelsError(`模型网关返回 ${response.status}，请检查密钥或稍后重试。`);
  }
  let json: any;
  try { json = await response.json(); } catch { throw new ModelsError('模型网关返回了无法解析的数据。'); }
  const list = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : [];
  const ids = [...new Set<string>(list
    .map((item: any) => typeof item?.id === 'string' ? item.id : typeof item?.name === 'string' ? item.name : '')
    .filter((id: string) => id.length > 0 && id.length <= 200))];
  if (!ids.length) throw new ModelsError('模型网关没有返回任何模型。');

  const existing = await db.select().from(ModelCatalog);
  const known = new Set(existing.map(row => row.upstreamId));
  const added = ids.filter(id => !known.has(id));
  const counts = new Map<string, number>();
  let sort = 0;
  for (const row of existing) {
    sort = Math.max(sort, row.sort);
    counts.set(row.kind, (counts.get(row.kind) || 0) + 1);
  }
  const now = Date.now();
  if (added.length) {
    await db.transaction(async tx => {
      for (const upstreamId of added) {
        // 哈希碰撞（现实中不会发生）时跳过，避免覆盖已有模型。
        if (existing.some(row => row.publicId === publicIdFor(upstreamId))) continue;
        const kind = guessKind(upstreamId);
        const count = (counts.get(kind) || 0) + 1;
        counts.set(kind, count);
        sort += 1;
        await tx.insert(ModelCatalog).values({
          publicId: publicIdFor(upstreamId), upstreamId,
          alias: `${KIND_LABEL[kind]}模型 ${count}`, kind, enabled: 1,
          prices: JSON.stringify(defaultPrices(kind)), sort, createdAt: now, updatedAt: now,
        });
      }
    });
  }
  return { added: added.length, upstream: ids.length };
}

/** 保存后台编辑：按上游 ID 新增或更新，别名、类型、启用状态与价格。 */
export async function saveModels(items: unknown): Promise<{ updated: number }> {
  if (!Array.isArray(items) || !items.length || items.length > 500) throw new ModelsError('没有需要保存的模型。');
  const now = Date.now();
  const rows = items.map(item => {
    const source = item as Record<string, any>;
    const upstreamId = typeof source?.upstreamId === 'string' ? source.upstreamId.trim() : '';
    if (!upstreamId || upstreamId.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._:\/-]*$/.test(upstreamId))
      throw new ModelsError('上游模型 ID 无效。');
    const alias = typeof source?.alias === 'string' ? source.alias.trim() : '';
    if (!alias || alias.length > 60) throw new ModelsError('模型别名需要 1–60 个字符。');
    const kind = asKind(source?.kind);
    if (!kind) throw new ModelsError('模型类型无效。');
    return {
      publicId: publicIdFor(upstreamId), upstreamId, alias, kind,
      enabled: source?.enabled === false ? 0 : 1,
      prices: JSON.stringify(normalizePrices(kind, source?.prices)),
    };
  });
  const unique = [...new Map(rows.map(row => [row.publicId, row])).values()];
  await db.transaction(async tx => {
    for (const row of unique) {
      await tx.insert(ModelCatalog).values({ ...row, sort: 0, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: ModelCatalog.publicId,
          set: { alias: row.alias, kind: row.kind, enabled: row.enabled, prices: row.prices, updatedAt: now },
        });
    }
  });
  return { updated: unique.length };
}
