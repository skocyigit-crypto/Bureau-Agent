import { Router, type Request, type Response } from "express";
import { getOrgId } from "../middleware/tenant";
import { requireRole } from "../middleware/auth";
import {
  getLearningProfile,
  recomputeLearnedPreferences,
  mineRecurringPatterns,
} from "../services/ai-learning";
import { logger } from "../lib/logger";

const router = Router();

// GET /ai-learning/profile — "Ce que l'IA a appris" pour le tenant.
router.get("/ai-learning/profile", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const profile = await getLearningProfile(orgId);
    res.json(profile);
  } catch (err) {
    logger.error({ err }, "[ai-learning] profile failed");
    res.status(500).json({ error: "Erreur lors du chargement du profil d'apprentissage." });
  }
});

// POST /ai-learning/recompute — recalcule préférences + motifs (admin, cooldown).
const RECOMPUTE_COOLDOWN_MS = 30 * 1000;
const RECOMPUTE_MAP_MAX = 500;
const lastRecomputeByOrg = new Map<number, number>();
function pruneRecomputeMap(): void {
  if (lastRecomputeByOrg.size <= RECOMPUTE_MAP_MAX) return;
  while (lastRecomputeByOrg.size > RECOMPUTE_MAP_MAX) {
    const first = lastRecomputeByOrg.keys().next().value;
    if (first === undefined) break;
    lastRecomputeByOrg.delete(first);
  }
}

router.post(
  "/ai-learning/recompute",
  requireRole("administrateur"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const orgId = getOrgId(req);
      const now = Date.now();
      const last = lastRecomputeByOrg.get(orgId) ?? 0;
      if (now - last < RECOMPUTE_COOLDOWN_MS) {
        res.status(429).json({ error: "Veuillez patienter avant de relancer l'analyse." });
        return;
      }
      lastRecomputeByOrg.set(orgId, now);
      pruneRecomputeMap();

      const prefs = await recomputeLearnedPreferences(orgId);
      const patterns = await mineRecurringPatterns(orgId);
      const profile = await getLearningProfile(orgId);
      res.json({ success: true, preferencesWritten: prefs, patternsWritten: patterns, profile });
    } catch (err) {
      logger.error({ err }, "[ai-learning] recompute failed");
      res.status(500).json({ error: "Erreur lors du recalcul de l'apprentissage." });
    }
  },
);

export default router;
