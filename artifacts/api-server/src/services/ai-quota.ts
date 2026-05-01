import { db, aiUsageTable, organisationsTable, notificationsTable } from "@workspace/db";
import { and, eq, gte, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

const quotaCache = new Map<number, { costUsd: number; calls: number; expiresAt: number }>();
const limitsCache = new Map<number, { limits: QuotaLimits; expiresAt: number }>();
const warningCache = new Map<number, { warnedAt: number; warnedPercent: number }>();

const CACHE_TTL_MS = 60_000;
const LIMITS_CACHE_TTL_MS = 300_000;
const WARNING_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const WARNING_THRESHOLD = 80;
const CRITICAL_THRESHOLD = 95;

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

async function getOrgLimits(organisationId: number): Promise<QuotaLimits> {
  const now = Date.now();
  const cached = limitsCache.get(organisationId);
  if (cached && cached.expiresAt > now) return cached.limits;

  try {
    const [org] = await db.select({
      aiQuotaCostUsd: organisationsTable.aiQuotaCostUsd,
      aiQuotaCalls: organisationsTable.aiQuotaCalls,
    }).from(organisationsTable).where(eq(organisationsTable.id, organisationId));

    const limits: QuotaLimits = {
      maxCostUsdPerMonth: org?.aiQuotaCostUsd != null
        ? Number(org.aiQuotaCostUsd)
        : DEFAULT_LIMITS.maxCostUsdPerMonth,
      maxCallsPerMonth: org?.aiQuotaCalls != null
        ? Number(org.aiQuotaCalls)
        : DEFAULT_LIMITS.maxCallsPerMonth,
    };
    limitsCache.set(organisationId, { limits, expiresAt: now + LIMITS_CACHE_TTL_MS });
    return limits;
  } catch (err) {
    logger.warn({ err, organisationId }, "[ai-quota] Impossible de lire les limites org, utilisation des defauts");
    return DEFAULT_LIMITS;
  }
}

function getMonthStart(): Date {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  return monthStart;
}

async function maybeNotifyQuotaWarning(
  organisationId: number,
  percentCost: number,
  percentCalls: number,
  used: { costUsd: number; calls: number },
  limits: QuotaLimits,
): Promise<void> {
  const maxPercent = Math.max(percentCost, percentCalls);
  if (maxPercent < WARNING_THRESHOLD) return;

  const now = Date.now();
  const prev = warningCache.get(organisationId);

  const isCritical = maxPercent >= CRITICAL_THRESHOLD;
  const threshold = isCritical ? CRITICAL_THRESHOLD : WARNING_THRESHOLD;

  if (prev && (now - prev.warnedAt) < WARNING_COOLDOWN_MS && prev.warnedPercent >= threshold) return;

  warningCache.set(organisationId, { warnedAt: now, warnedPercent: threshold });

  const costLine = `Cout: ${used.costUsd.toFixed(3)} USD / ${limits.maxCostUsdPerMonth} USD (${percentCost.toFixed(0)}%)`;
  const callsLine = `Appels: ${used.calls.toLocaleString("fr-FR")} / ${limits.maxCallsPerMonth.toLocaleString("fr-FR")} (${percentCalls.toFixed(0)}%)`;
  const priority = isCritical ? "haute" : "normale";
  const label = isCritical ? `⛔ Quota IA critique (${maxPercent.toFixed(0)}%)` : `⚠️ Quota IA eleve (${maxPercent.toFixed(0)}%)`;
  const message = isCritical
    ? `Votre quota IA mensuel est presque epuise. Les appels IA seront bloques a 100%. Augmentez votre limite dans Parametres > IA.\n${costLine}\n${callsLine}`
    : `Votre utilisation IA mensuelle depasse ${WARNING_THRESHOLD}%. Pensez a surveiller votre consommation.\n${costLine}\n${callsLine}`;

  db.insert(notificationsTable).values({
    organisationId,
    type: "alert",
    title: label,
    message,
    priority,
    actionUrl: "/parametres?tab=intelligence-artificielle",
    sourceType: "ai_quota",
    sourceId: `quota_${organisationId}_${new Date().toISOString().slice(0, 7)}`,
  }).catch((err: unknown) => {
    logger.warn({ err, organisationId }, "[ai-quota] Erreur insertion notification quota");
  });
}

export async function assertAiQuota(organisationId: number | null | undefined): Promise<void> {
  if (!organisationId) return;
  const now = Date.now();
  const cached = quotaCache.get(organisationId);

  let snapshot = cached && cached.expiresAt > now ? cached : null;
  if (!snapshot) {
    const [row] = await db.select({
      costUsd: sql<number>`coalesce(sum(estimated_cost_usd), 0)::float8`,
      calls: sql<number>`count(*)::int`,
    }).from(aiUsageTable).where(and(
      eq(aiUsageTable.organisationId, organisationId),
      gte(aiUsageTable.createdAt, getMonthStart()),
    ));
    snapshot = {
      costUsd: Number(row?.costUsd ?? 0),
      calls: Number(row?.calls ?? 0),
      expiresAt: now + CACHE_TTL_MS,
    };
    quotaCache.set(organisationId, snapshot);
  }

  const limits = await getOrgLimits(organisationId);
  const percentCost = Math.min(100, (snapshot.costUsd / limits.maxCostUsdPerMonth) * 100);
  const percentCalls = Math.min(100, (snapshot.calls / limits.maxCallsPerMonth) * 100);

  void maybeNotifyQuotaWarning(organisationId, percentCost, percentCalls, snapshot, limits);

  if (snapshot.costUsd >= limits.maxCostUsdPerMonth) {
    throw new AiQuotaExceededError("cost", snapshot.costUsd, limits.maxCostUsdPerMonth);
  }
  if (snapshot.calls >= limits.maxCallsPerMonth) {
    throw new AiQuotaExceededError("calls", snapshot.calls, limits.maxCallsPerMonth);
  }
}

export function invalidateQuotaCache(organisationId: number): void {
  quotaCache.delete(organisationId);
  limitsCache.delete(organisationId);
}

export async function getQuotaStatus(organisationId: number): Promise<{
  used: { costUsd: number; calls: number };
  limits: QuotaLimits;
  percentCost: number;
  percentCalls: number;
}> {
  invalidateQuotaCache(organisationId);
  const [row] = await db.select({
    costUsd: sql<number>`coalesce(sum(estimated_cost_usd), 0)::float8`,
    calls: sql<number>`count(*)::int`,
  }).from(aiUsageTable).where(and(
    eq(aiUsageTable.organisationId, organisationId),
    gte(aiUsageTable.createdAt, getMonthStart()),
  ));
  const used = { costUsd: Number(row?.costUsd ?? 0), calls: Number(row?.calls ?? 0) };
  const limits = await getOrgLimits(organisationId);
  const percentCost = Math.min(100, (used.costUsd / limits.maxCostUsdPerMonth) * 100);
  const percentCalls = Math.min(100, (used.calls / limits.maxCallsPerMonth) * 100);

  void maybeNotifyQuotaWarning(organisationId, percentCost, percentCalls, used, limits);

  return { used, limits, percentCost, percentCalls };
}
