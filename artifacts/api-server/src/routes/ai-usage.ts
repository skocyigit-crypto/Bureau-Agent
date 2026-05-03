import { Router, type IRouter, type Request, type Response } from "express";
import { db, aiUsageTable, organisationsTable } from "@workspace/db";
import { eq, and, gte, sql, desc } from "drizzle-orm";
import { getOrgId } from "../middleware/tenant";
import { getQuotaStatus, invalidateQuotaCache } from "../services/ai-quota";
import { requireRole } from "../middleware/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/ai-usage/quota", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    const status = await getQuotaStatus(orgId);
    res.json(status);
  } catch (err: any) {
    req.log.error({ err }, "Erreur quota IA");
    res.status(500).json({ error: "Erreur lors de la recuperation du quota IA." });
  }
});

router.get("/ai-usage/summary", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const days = Math.max(1, Math.min(90, parseInt(String(req.query.days ?? "30")) || 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
  const [totals, byRoute, byModel, byDay, recentErrors] = await Promise.all([
    db.select({
      totalCalls: sql<number>`count(*)::int`,
      successCalls: sql<number>`sum(case when status = 'success' then 1 else 0 end)::int`,
      errorCalls: sql<number>`sum(case when status = 'error' then 1 else 0 end)::int`,
      totalTokens: sql<number>`coalesce(sum(total_tokens), 0)::bigint`,
      totalInputTokens: sql<number>`coalesce(sum(input_tokens), 0)::bigint`,
      totalOutputTokens: sql<number>`coalesce(sum(output_tokens), 0)::bigint`,
      totalCostUsd: sql<number>`coalesce(sum(estimated_cost_usd), 0)::float8`,
      avgDurationMs: sql<number>`coalesce(avg(duration_ms), 0)::int`,
    }).from(aiUsageTable).where(and(eq(aiUsageTable.organisationId, orgId), gte(aiUsageTable.createdAt, since))),
    db.select({
      route: aiUsageTable.route,
      calls: sql<number>`count(*)::int`,
      tokens: sql<number>`coalesce(sum(total_tokens), 0)::bigint`,
      costUsd: sql<number>`coalesce(sum(estimated_cost_usd), 0)::float8`,
    }).from(aiUsageTable).where(and(eq(aiUsageTable.organisationId, orgId), gte(aiUsageTable.createdAt, since)))
      .groupBy(aiUsageTable.route).orderBy(desc(sql`count(*)`)),
    db.select({
      model: aiUsageTable.model,
      provider: aiUsageTable.provider,
      calls: sql<number>`count(*)::int`,
      tokens: sql<number>`coalesce(sum(total_tokens), 0)::bigint`,
      costUsd: sql<number>`coalesce(sum(estimated_cost_usd), 0)::float8`,
    }).from(aiUsageTable).where(and(eq(aiUsageTable.organisationId, orgId), gte(aiUsageTable.createdAt, since)))
      .groupBy(aiUsageTable.model, aiUsageTable.provider).orderBy(desc(sql`sum(estimated_cost_usd)`)),
    db.select({
      day: sql<string>`to_char(date_trunc('day', created_at), 'YYYY-MM-DD')`,
      calls: sql<number>`count(*)::int`,
      tokens: sql<number>`coalesce(sum(total_tokens), 0)::bigint`,
      costUsd: sql<number>`coalesce(sum(estimated_cost_usd), 0)::float8`,
    }).from(aiUsageTable).where(and(eq(aiUsageTable.organisationId, orgId), gte(aiUsageTable.createdAt, since)))
      .groupBy(sql`date_trunc('day', created_at)`).orderBy(sql`date_trunc('day', created_at)`),
    db.select({
      id: aiUsageTable.id,
      route: aiUsageTable.route,
      model: aiUsageTable.model,
      errorMessage: aiUsageTable.errorMessage,
      createdAt: aiUsageTable.createdAt,
    }).from(aiUsageTable).where(and(eq(aiUsageTable.organisationId, orgId), eq(aiUsageTable.status, "error"), gte(aiUsageTable.createdAt, since)))
      .orderBy(desc(aiUsageTable.createdAt)).limit(10),
  ]);

  res.json({
    period: { days, since: since.toISOString() },
    totals: totals[0] ?? { totalCalls: 0, successCalls: 0, errorCalls: 0, totalTokens: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0, avgDurationMs: 0 },
    byRoute,
    byModel,
    byDay,
    recentErrors,
  });
  } catch (err: any) {
    req.log.error({ err }, "Erreur resume usage IA");
    res.status(500).json({ error: "Erreur lors de la recuperation du resume d'utilisation IA." });
  }
});

router.get("/ai-usage/settings", requireRole("administrateur", "super_admin"), async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    const [org] = await db.select({
      aiQuotaCostUsd: organisationsTable.aiQuotaCostUsd,
      aiQuotaCalls: organisationsTable.aiQuotaCalls,
      aiAgentName: organisationsTable.aiAgentName,
    }).from(organisationsTable).where(eq(organisationsTable.id, orgId));

    if (!org) {
      res.status(404).json({ error: "Organisation introuvable." });
      return;
    }

    res.json({
      aiQuotaCostUsd: org.aiQuotaCostUsd != null ? Number(org.aiQuotaCostUsd) : null,
      aiQuotaCalls: org.aiQuotaCalls,
      aiAgentName: org.aiAgentName,
    });
  } catch (err: any) {
    req.log.error({ err }, "Erreur parametres IA");
    res.status(500).json({ error: "Erreur lors de la recuperation des parametres IA." });
  }
});

router.patch("/ai-usage/settings", requireRole("administrateur", "super_admin"), async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const { aiQuotaCostUsd, aiQuotaCalls, aiAgentName } = req.body;

  const updates: Record<string, any> = {};

  if (aiQuotaCostUsd !== undefined) {
    const val = aiQuotaCostUsd === null ? null : Number(aiQuotaCostUsd);
    if (val !== null && (isNaN(val) || val < 1 || val > 10000)) {
      res.status(400).json({ error: "aiQuotaCostUsd doit etre entre 1 et 10000 USD." });
      return;
    }
    updates.aiQuotaCostUsd = val !== null ? String(val) : null;
  }

  if (aiQuotaCalls !== undefined) {
    const val = aiQuotaCalls === null ? null : parseInt(String(aiQuotaCalls));
    if (val !== null && (isNaN(val) || val < 100 || val > 1000000)) {
      res.status(400).json({ error: "aiQuotaCalls doit etre entre 100 et 1 000 000." });
      return;
    }
    updates.aiQuotaCalls = val;
  }

  if (aiAgentName !== undefined) {
    const name = aiAgentName === null ? null : String(aiAgentName).trim().slice(0, 100);
    if (name !== null && name.length < 2) {
      res.status(400).json({ error: "aiAgentName doit contenir au moins 2 caracteres." });
      return;
    }
    updates.aiAgentName = name;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Aucun champ a mettre a jour." });
    return;
  }

  try {
    await db.update(organisationsTable).set(updates).where(eq(organisationsTable.id, orgId));
    invalidateQuotaCache(orgId);

    logger.info({ orgId, updates: Object.keys(updates) }, "[ai-usage] Parametres IA mis a jour");
    res.json({ success: true, message: "Parametres IA mis a jour avec succes." });
  } catch (err: any) {
    req.log.error({ err }, "Erreur mise a jour parametres IA");
    res.status(500).json({ error: "Erreur lors de la mise a jour des parametres IA." });
  }
});

export default router;
