import { Router, type Request, type Response } from "express";
import { db, proactiveSuggestionsTable, organisationsTable } from "@workspace/db";
import { and, eq, inArray, desc } from "drizzle-orm";
import { getOrgId } from "../middleware/tenant";
import { requireRole } from "../middleware/auth";
import { runProactiveForOrg } from "../services/proactive-engine";
import { bumpPreferenceFromFeedback } from "../services/ai-learning";
import { logger } from "../lib/logger";

const router = Router();

const SEVERITY_RANK: Record<string, number> = { urgent: 3, warning: 2, info: 1 };
const STATUSES = ["pending", "accepted", "dismissed", "done"] as const;

// GET /proactive/suggestions?status=pending — liste les suggestions du tenant.
router.get("/proactive/suggestions", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const statusParam = typeof req.query.status === "string" ? req.query.status : "pending";
    const status = (STATUSES as readonly string[]).includes(statusParam) ? statusParam : "pending";

    const rows = await db
      .select()
      .from(proactiveSuggestionsTable)
      .where(
        and(
          eq(proactiveSuggestionsTable.organisationId, orgId),
          eq(proactiveSuggestionsTable.status, status),
        ),
      )
      .orderBy(desc(proactiveSuggestionsTable.createdAt))
      .limit(100);

    const sorted = [...rows].sort((a, b) => {
      const sa = SEVERITY_RANK[a.severity] ?? 0;
      const sb = SEVERITY_RANK[b.severity] ?? 0;
      if (sb !== sa) return sb - sa;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    const counts = { urgent: 0, warning: 0, info: 0 };
    for (const r of sorted) {
      if (r.severity in counts) counts[r.severity as keyof typeof counts]++;
    }

    res.json({ suggestions: sorted, total: sorted.length, counts });
  } catch (err) {
    logger.error({ err }, "[proactive] list failed");
    res.status(500).json({ error: "Erreur lors du chargement des suggestions." });
  }
});

async function resolveSuggestion(
  req: Request,
  res: Response,
  status: "accepted" | "dismissed",
): Promise<void> {
  try {
    const orgId = getOrgId(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "ID invalide." });
      return;
    }
    const updated = await db
      .update(proactiveSuggestionsTable)
      .set({ status, resolvedAt: new Date(), resolvedByUserId: req.session?.userId ?? null })
      .where(
        and(
          eq(proactiveSuggestionsTable.id, id),
          eq(proactiveSuggestionsTable.organisationId, orgId),
        ),
      )
      .returning();
    if (updated.length === 0) {
      res.status(404).json({ error: "Suggestion introuvable." });
      return;
    }
    res.json({ success: true, suggestion: updated[0] });
  } catch (err) {
    logger.error({ err }, "[proactive] resolve failed");
    res.status(500).json({ error: "Erreur lors de la mise à jour." });
  }
}

router.post("/proactive/suggestions/:id/accept", (req, res) =>
  resolveSuggestion(req, res, "accepted"),
);
router.post("/proactive/suggestions/:id/dismiss", (req, res) =>
  resolveSuggestion(req, res, "dismissed"),
);

// Feedback 👍/👎 — alimente la couche d'apprentissage IA (pilier B).
router.post("/proactive/suggestions/:id/feedback", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = Number(req.params.id);
    const value = req.body?.value;
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "ID invalide." });
      return;
    }
    if (value !== "up" && value !== "down") {
      res.status(400).json({ error: "Feedback invalide (up|down)." });
      return;
    }
    const updated = await db
      .update(proactiveSuggestionsTable)
      .set({ feedback: value })
      .where(
        and(
          eq(proactiveSuggestionsTable.id, id),
          eq(proactiveSuggestionsTable.organisationId, orgId),
        ),
      )
      .returning({ id: proactiveSuggestionsTable.id, type: proactiveSuggestionsTable.type });
    if (updated.length === 0) {
      res.status(404).json({ error: "Suggestion introuvable." });
      return;
    }
    // Recompute-on-vote: met à jour la préférence apprise pour ce type (fire-and-forget).
    const suggestionType = updated[0]?.type;
    if (suggestionType) {
      void bumpPreferenceFromFeedback(orgId, "suggestion_type", suggestionType).catch(() => {});
    }
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "[proactive] feedback failed");
    res.status(500).json({ error: "Erreur lors de l'enregistrement du feedback." });
  }
});

// POST /proactive/run — déclenchement manuel (cooldown léger anti-spam).
const RUN_COOLDOWN_MS = 30 * 1000;
const RUN_MAP_MAX = 500;
const lastRunByOrg = new Map<number, number>();
function pruneRunMap(): void {
  if (lastRunByOrg.size <= RUN_MAP_MAX) return;
  while (lastRunByOrg.size > RUN_MAP_MAX) {
    const first = lastRunByOrg.keys().next().value;
    if (first === undefined) break;
    lastRunByOrg.delete(first);
  }
}

router.post("/proactive/run", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const now = Date.now();
    const last = lastRunByOrg.get(orgId) ?? 0;
    if (now - last < RUN_COOLDOWN_MS) {
      const waitSec = Math.ceil((RUN_COOLDOWN_MS - (now - last)) / 1000);
      res.status(429).json({ error: `Patientez ${waitSec}s avant la prochaine analyse.` });
      return;
    }
    lastRunByOrg.set(orgId, now);
    pruneRunMap();
    const created = await runProactiveForOrg(orgId);
    res.json({ success: true, created });
  } catch (err) {
    logger.error({ err }, "[proactive] run failed");
    res.status(500).json({ error: "Erreur lors de l'analyse proactive." });
  }
});

// GET /proactive/settings — état d'activation du moteur pour l'org.
router.get("/proactive/settings", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const [org] = await db
      .select({ enabled: organisationsTable.proactiveEngineEnabled })
      .from(organisationsTable)
      .where(eq(organisationsTable.id, orgId));
    res.json({ enabled: org?.enabled ?? true });
  } catch (err) {
    logger.error({ err }, "[proactive] settings get failed");
    res.status(500).json({ error: "Erreur lors du chargement des réglages." });
  }
});

// PATCH /proactive/settings — active/désactive le moteur pour l'org.
// Réservé aux administrateurs (réglage org-wide): un agent ne doit pas pouvoir
// couper la surveillance proactive de toute l'organisation.
router.patch("/proactive/settings", requireRole("administrateur"), async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const enabled = req.body?.enabled;
    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "Champ 'enabled' booléen requis." });
      return;
    }
    await db
      .update(organisationsTable)
      .set({ proactiveEngineEnabled: enabled })
      .where(eq(organisationsTable.id, orgId));
    res.json({ success: true, enabled });
  } catch (err) {
    logger.error({ err }, "[proactive] settings patch failed");
    res.status(500).json({ error: "Erreur lors de la mise à jour des réglages." });
  }
});

export default router;
