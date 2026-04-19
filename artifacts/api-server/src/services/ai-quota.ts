import { db, aiUsageTable } from "@workspace/db";
import { and, eq, gte, sql } from "drizzle-orm";

const quotaCache = new Map<number, { costUsd: number; calls: number; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

export interface QuotaLimits {
  maxCostUsdPerMonth: number;
  maxCallsPerMonth: number;
}

const DEFAULT_LIMITS: QuotaLimits = {
  maxCostUsdPerMonth: Number(process.env.AI_DEFAULT_MONTHLY_COST_USD ?? 50),
  maxCallsPerMonth: Number(process.env.AI_DEFAULT_MONTHLY_CALLS ?? 5000),
};

export class AiQuotaExceededError extends Error {
  reason: "cost" | "calls";
  current: number;
  limit: number;
  constructor(reason: "cost" | "calls", current: number, limit: number) {
    super(reason === "cost"
      ? `Quota IA mensuel atteint: ${current.toFixed(2)} USD / ${limit} USD. Contactez votre administrateur pour augmenter la limite.`
      : `Quota IA mensuel atteint: ${current} appels / ${limit}. Contactez votre administrateur.`);
    this.name = "AiQuotaExceededError";
    this.reason = reason;
    this.current = current;
    this.limit = limit;
  }
}

export async function assertAiQuota(organisationId: number | null | undefined): Promise<void> {
  if (!organisationId) return;
  const now = Date.now();
  const cached = quotaCache.get(organisationId);

  let snapshot = cached && cached.expiresAt > now ? cached : null;
  if (!snapshot) {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const [row] = await db.select({
      costUsd: sql<number>`coalesce(sum(estimated_cost_usd), 0)::float8`,
      calls: sql<number>`count(*)::int`,
    }).from(aiUsageTable).where(and(
      eq(aiUsageTable.organisationId, organisationId),
      gte(aiUsageTable.createdAt, monthStart),
    ));
    snapshot = {
      costUsd: Number(row?.costUsd ?? 0),
      calls: Number(row?.calls ?? 0),
      expiresAt: now + CACHE_TTL_MS,
    };
    quotaCache.set(organisationId, snapshot);
  }

  const limits = DEFAULT_LIMITS;
  if (snapshot.costUsd >= limits.maxCostUsdPerMonth) {
    throw new AiQuotaExceededError("cost", snapshot.costUsd, limits.maxCostUsdPerMonth);
  }
  if (snapshot.calls >= limits.maxCallsPerMonth) {
    throw new AiQuotaExceededError("calls", snapshot.calls, limits.maxCallsPerMonth);
  }
}

export function invalidateQuotaCache(organisationId: number): void {
  quotaCache.delete(organisationId);
}

export async function getQuotaStatus(organisationId: number): Promise<{ used: { costUsd: number; calls: number }; limits: QuotaLimits; percentCost: number; percentCalls: number }> {
  invalidateQuotaCache(organisationId);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [row] = await db.select({
    costUsd: sql<number>`coalesce(sum(estimated_cost_usd), 0)::float8`,
    calls: sql<number>`count(*)::int`,
  }).from(aiUsageTable).where(and(
    eq(aiUsageTable.organisationId, organisationId),
    gte(aiUsageTable.createdAt, monthStart),
  ));
  const used = { costUsd: Number(row?.costUsd ?? 0), calls: Number(row?.calls ?? 0) };
  return {
    used,
    limits: DEFAULT_LIMITS,
    percentCost: Math.min(100, (used.costUsd / DEFAULT_LIMITS.maxCostUsdPerMonth) * 100),
    percentCalls: Math.min(100, (used.calls / DEFAULT_LIMITS.maxCallsPerMonth) * 100),
  };
}
