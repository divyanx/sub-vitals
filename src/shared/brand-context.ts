import { context, reddit, redis } from '@devvit/web/server';
import { log } from './log.js';
import { readEffectiveSetting } from './settings-overrides.js';

const CACHE_KEY = 'rl:brand-context-cache';
const CACHE_TTL_MS = 10 * 60 * 1000;

export interface BrandContext {
  name: string;
  description: string;
}

let memCache: { ctx: BrandContext; ts: number } | null = null;

export async function getBrandContext(): Promise<BrandContext> {
  if (memCache && Date.now() - memCache.ts < CACHE_TTL_MS) {
    return memCache.ctx;
  }

  const [name, voice] = await Promise.all([
    readEffectiveSetting<string>('brand-name').catch(() => undefined),
    readEffectiveSetting<string>('brand-voice').catch(() => undefined),
  ]);

  if (name || voice) {
    const ctx = { name: name ?? '', description: voice ?? '' };
    memCache = { ctx, ts: Date.now() };
    return ctx;
  }

  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) {
      const ctx = JSON.parse(cached) as BrandContext;
      memCache = { ctx, ts: Date.now() };
      return ctx;
    }
  } catch {
    /* ignore */
  }

  const subName = context.subredditName;
  if (!subName) return { name: '', description: '' };

  try {
    const sub = await reddit.getSubredditByName(subName);
    const ctx: BrandContext = {
      name: sub.title ?? subName,
      description: sub.description?.slice(0, 500) ?? '',
    };
    memCache = { ctx, ts: Date.now() };
    await redis.set(CACHE_KEY, JSON.stringify(ctx), {
      expiration: new Date(Date.now() + CACHE_TTL_MS),
    });
    return ctx;
  } catch (err) {
    log.warn('brand-context: failed to fetch subreddit info', { err: String(err) });
    return { name: subName, description: '' };
  }
}

export function buildBrandPrefix(brand: BrandContext): string {
  const parts: string[] = [];
  if (brand.name) parts.push(`Community: ${brand.name}`);
  if (brand.description) parts.push(`About: ${brand.description}`);
  if (parts.length === 0) return '';
  return `${parts.join('\n')}\n\n`;
}
