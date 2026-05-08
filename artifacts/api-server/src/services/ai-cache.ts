import crypto from "node:crypto";
import { logger } from "../lib/logger";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const MAX_ENTRIES = Number(process.env.AI_CACHE_MAX_ENTRIES ?? 2000);
const cache = new Map<string, CacheEntry<unknown>>();

const stats = { hits: 0, misses: 0, evictions: 0 };

export function buildAiCacheKey(parts: {
  route: string;
  organisationId?: number | null;
  userId?: number | null;
  input: unknown;
}): string {
  const norm = JSON.stringify(parts.input ?? null);
  const hash = crypto.createHash("sha256").update(norm).digest("hex").slice(0, 24);
  const orgPart = parts.organisationId ?? "noorg";
  const userPart = parts.userId ?? "nouser";
  return `${parts.route}:${orgPart}:${userPart}:${hash}`;
}

export function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) {
    stats.misses++;
    return null;
  }
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    stats.misses++;
    return null;
  }
  stats.hits++;
  return entry.value as T;
}

export function setCached<T>(key: string, value: T, ttlMs: number): void {
  if (cache.size >= MAX_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) {
      cache.delete(firstKey);
      stats.evictions++;
    }
  }
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export async function getOrCompute<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const hit = getCached<T>(key);
  if (hit !== null) return hit;
  const value = await fn();
  setCached(key, value, ttlMs);
  return value;
}

export function invalidatePrefix(prefix: string): number {
  let removed = 0;
  for (const k of cache.keys()) {
    if (k.startsWith(prefix)) {
      cache.delete(k);
      removed++;
    }
  }
  return removed;
}

export function invalidateOrg(organisationId: number): number {
  let removed = 0;
  const suffix = `:${organisationId}:`;
  for (const k of cache.keys()) {
    if (k.includes(suffix)) {
      cache.delete(k);
      removed++;
    }
  }
  return removed;
}

export function getCacheStats(): { size: number; hits: number; misses: number; evictions: number; hitRate: number } {
  const total = stats.hits + stats.misses;
  return {
    size: cache.size,
    hits: stats.hits,
    misses: stats.misses,
    evictions: stats.evictions,
    hitRate: total > 0 ? stats.hits / total : 0,
  };
}

export function clearAiCache(): void {
  cache.clear();
}

let purgeTimer: NodeJS.Timeout | null = null;
export function startAiCachePurgeJob(): void {
  if (purgeTimer) return;
  purgeTimer = setInterval(() => {
    const now = Date.now();
    let removed = 0;
    for (const [k, v] of cache.entries()) {
      if (v.expiresAt < now) {
        cache.delete(k);
        removed++;
      }
    }
    if (removed > 0) logger.debug({ removed, size: cache.size }, "[ai-cache] expired entries purged");
  }, 5 * 60 * 1000);
  purgeTimer.unref?.();
}

export const AI_CACHE_TTL = {
  SHORT: 60 * 1000,
  MEDIUM: 5 * 60 * 1000,
  LONG: 30 * 60 * 1000,
  VERY_LONG: 24 * 60 * 60 * 1000,
} as const;

export interface ProviderTimeoutOptions {
  timeoutMs?: number;
  label?: string;
}

export async function withProviderTimeout<T>(
  fn: () => Promise<T>,
  opts: ProviderTimeoutOptions = {},
): Promise<T> {
  const { timeoutMs = 25_000, label = "ai-provider" } = opts;
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`[${label}] timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([fn(), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
