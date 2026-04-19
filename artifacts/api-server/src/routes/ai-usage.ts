import { Router, type IRouter, type Request, type Response } from "express";
import { db, aiUsageTable } from "@workspace/db";
import { eq, and, gte, sql, desc } from "drizzle-orm";
import { getOrgId } from "../middleware/tenant";

const router: IRouter = Router();

router.get("/ai-usage/summary", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const days = Math.max(1, Math.min(90, parseInt(String(req.query.days ?? "30")) || 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

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
});

export default router;
