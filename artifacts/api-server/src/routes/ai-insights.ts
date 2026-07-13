import { Router, type Request, type Response } from "express";
import { db, aiInsightsTable } from "@workspace/db";
import { and, eq, desc, sql, gt, isNull, or } from "drizzle-orm";
import { getOrgId } from "../middleware/tenant";
import { generateInsightsForOrg } from "../services/ai-insights";
import { bumpPreferenceFromFeedback } from "../services/ai-learning";
import { AiQuotaExceededError } from "../services/ai-quota";
import { logger } from "../lib/logger";

const router = Router();

const SEVERITY_RANK: Record<string, number> = { critical: 3, warn: 2, info: 1 };

router.get("/ai-insights", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const now = new Date();
    const rows = await db.select().from(aiInsightsTable).where(and(
      eq(aiInsightsTable.organisationId, orgId),
      eq(aiInsightsTable.dismissed, false),
      or(isNull(aiInsightsTable.expiresAt), gt(aiInsightsTable.expiresAt, now)),
    )).orderBy(desc(aiInsightsTable.generatedAt)).limit(20);

    const sorted = [...rows].sort((a, b) => {
      const sa = SEVERITY_RANK[a.severity] ?? 0;
      const sb = SEVERITY_RANK[b.severity] ?? 0;
      if (sb !== sa) return sb - sa;
      return new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime();
    });

    res.json({ insights: sorted.slice(0, 5), total: sorted.length });
  } catch (err) {
    logger.error({ err }, "[ai-insights] list failed");
    res.status(500).json({ error: "Erreur lors du chargement des insights." });
  }
});

router.post("/ai-insights/:id/dismiss", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) { res.status(400).json({ error: "ID invalide." }); return; }
    const updated = await db.update(aiInsightsTable)
      .set({ dismissed: true })
      .where(and(eq(aiInsightsTable.id, id), eq(aiInsightsTable.organisationId, orgId)))
      .returning({ id: aiInsightsTable.id });
    if (updated.length === 0) { res.status(404).json({ error: "Insight introuvable." }); return; }
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "[ai-insights] dismiss failed");
    res.status(500).json({ error: "Erreur lors de la suppression." });
  }
});

router.post("/ai-insights/:id/vote", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = Number(req.params.id);
    const v = Number(req.body?.value);
    if (!Number.isFinite(id) || id <= 0) { res.status(400).json({ error: "ID invalide." }); return; }
    if (![-1, 0, 1].includes(v)) { res.status(400).json({ error: "Vote invalide." }); return; }
    const updated = await db.update(aiInsightsTable)
      .set({ vote: v })
      .where(and(eq(aiInsightsTable.id, id), eq(aiInsightsTable.organisationId, orgId)))
      .returning({ id: aiInsightsTable.id, category: aiInsightsTable.category });
    if (updated.length === 0) { res.status(404).json({ error: "Insight introuvable." }); return; }
    // Recompute-on-vote: met à jour la préférence apprise pour cette catégorie.
    const cat = updated[0]?.category;
    if (cat) {
      void bumpPreferenceFromFeedback(orgId, "insight_category", cat).catch(() => {});
    }
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "[ai-insights] vote failed");
    res.status(500).json({ error: "Erreur lors du vote." });
  }
});

const REGEN_COOLDOWN_MS = 5 * 60 * 1000;
const REGEN_MAP_MAX = 500;
const lastRegenByOrg = new Map<number, number>();
function pruneRegenMap(): void {
  if (lastRegenByOrg.size <= REGEN_MAP_MAX) return;
  const cutoff = Date.now() - REGEN_COOLDOWN_MS;
  for (const [k, v] of lastRegenByOrg) {
    if (v < cutoff) lastRegenByOrg.delete(k);
  }
  while (lastRegenByOrg.size > REGEN_MAP_MAX) {
    const first = lastRegenByOrg.keys().next().value;
    if (first === undefined) break;
    lastRegenByOrg.delete(first);
  }
}

router.post("/ai-insights/regenerate", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const now = Date.now();
    const last = lastRegenByOrg.get(orgId) ?? 0;
    if (now - last < REGEN_COOLDOWN_MS) {
      const waitSec = Math.ceil((REGEN_COOLDOWN_MS - (now - last)) / 1000);
      res.status(429).json({ error: `Patientez ${waitSec}s avant la prochaine actualisation.` });
      return;
    }
    try {
      const count = await generateInsightsForOrg(orgId);
      // Set cooldown only after success so transient failures don't lock the user out.
      lastRegenByOrg.set(orgId, Date.now());
      pruneRegenMap();
      res.json({ success: true, generated: count });
    } catch (innerErr) {
      if (innerErr instanceof AiQuotaExceededError) {
        // Quota errors should still cool down (avoid hammering quota).
        lastRegenByOrg.set(orgId, Date.now());
        pruneRegenMap();
        res.status(429).json({ error: innerErr.message, quotaExceeded: true });
        return;
      }
      throw innerErr;
    }
  } catch (err) {
    logger.error({ err }, "[ai-insights] regenerate failed");
    res.status(500).json({ error: "Erreur lors de la regeneration." });
  }
});

export default router;
