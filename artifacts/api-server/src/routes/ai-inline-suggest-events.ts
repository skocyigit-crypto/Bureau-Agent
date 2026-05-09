import { Router, type IRouter, type Request, type Response } from "express";
import { db, aiInlineSuggestEventsTable } from "@workspace/db";
import { and, eq, gte, sql } from "drizzle-orm";
import { getOrgId } from "../middleware/tenant";

const router: IRouter = Router();

const FIELD_TYPES = new Set([
  "note",
  "prospect_note",
  "email_body",
  "call_note",
  "task_description",
  "message_content",
  "project_description",
  "project_note",
  "quote_comment",
  "invoice_comment",
]);

const EVENTS = new Set(["shown", "accepted", "dismissed"]);

router.post("/ai/inline-suggest/event", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) { res.status(204).end(); return; }
    const { fieldType, event, length } = req.body ?? {};
    if (!fieldType || !FIELD_TYPES.has(String(fieldType))) { res.status(204).end(); return; }
    if (!event || !EVENTS.has(String(event))) { res.status(204).end(); return; }
    const len = Math.max(0, Math.min(2000, Math.floor(Number(length) || 0)));
    const userId = (req as any).user?.id ?? null;

    await db.insert(aiInlineSuggestEventsTable).values({
      organisationId: orgId,
      userId: userId ?? null,
      fieldType: String(fieldType),
      event: String(event),
      length: len,
    });
    res.status(204).end();
  } catch (err: any) {
    req.log?.debug?.({ err: err?.message }, "[ai/inline-suggest/event] failed");
    res.status(204).end();
  }
});

router.get("/ai/inline-suggest/metrics", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const days = Math.max(1, Math.min(90, parseInt(String(req.query.days ?? "30")) || 30));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rows = await db.select({
      fieldType: aiInlineSuggestEventsTable.fieldType,
      shown: sql<number>`sum(case when event = 'shown' then 1 else 0 end)::int`,
      accepted: sql<number>`sum(case when event = 'accepted' then 1 else 0 end)::int`,
      dismissed: sql<number>`sum(case when event = 'dismissed' then 1 else 0 end)::int`,
      avgAcceptedLength: sql<number>`coalesce(avg(case when event = 'accepted' then length end), 0)::float8`,
    })
      .from(aiInlineSuggestEventsTable)
      .where(and(eq(aiInlineSuggestEventsTable.organisationId, orgId), gte(aiInlineSuggestEventsTable.createdAt, since)))
      .groupBy(aiInlineSuggestEventsTable.fieldType);

    const byField = rows
      .map((r) => {
        const shown = Number(r.shown) || 0;
        const accepted = Number(r.accepted) || 0;
        const dismissed = Number(r.dismissed) || 0;
        const acceptanceRate = shown > 0 ? accepted / shown : 0;
        return {
          fieldType: r.fieldType,
          shown,
          accepted,
          dismissed,
          acceptanceRate,
          avgAcceptedLength: Number(r.avgAcceptedLength) || 0,
        };
      })
      .sort((a, b) => b.shown - a.shown);

    const totals = byField.reduce(
      (acc, r) => {
        acc.shown += r.shown;
        acc.accepted += r.accepted;
        acc.dismissed += r.dismissed;
        return acc;
      },
      { shown: 0, accepted: 0, dismissed: 0, acceptanceRate: 0 },
    );
    totals.acceptanceRate = totals.shown > 0 ? totals.accepted / totals.shown : 0;

    res.json({
      period: { days, since: since.toISOString() },
      totals,
      byField,
    });
  } catch (err: any) {
    req.log?.error?.({ err }, "[ai/inline-suggest/metrics] failed");
    res.status(500).json({ error: "Erreur lors de la recuperation des metriques de suggestion." });
  }
});

export default router;
