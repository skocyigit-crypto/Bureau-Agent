import { Router, type Request, type Response } from "express";
import { getOrgId } from "../middleware/tenant";
import { requireRole } from "../middleware/auth";
import {
  answerFromKnowledge,
  getKnowledgeStatus,
  indexOrganisation,
} from "../services/knowledge-base";
import { AiQuotaExceededError } from "../services/ai-quota";
import { logger } from "../lib/logger";

const router = Router();

// GET /knowledge-base/status — état d'indexation pour le tenant.
router.get("/knowledge-base/status", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const status = await getKnowledgeStatus(orgId);
    res.json(status);
  } catch (err) {
    logger.error({ err }, "[knowledge-base] status failed");
    res.status(500).json({ error: "Erreur lors du chargement de la base de connaissances." });
  }
});

// POST /knowledge-base/ask — réponse ancrée sur les documents { question }.
router.post("/knowledge-base/ask", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const userId = (req as { user?: { id?: number } }).user?.id ?? null;
    const question = String((req.body as { question?: unknown })?.question ?? "").trim();
    if (!question) {
      res.status(400).json({ error: "La question est obligatoire." });
      return;
    }
    if (question.length > 1000) {
      res.status(400).json({ error: "Question trop longue (max 1000 caractères)." });
      return;
    }
    const result = await answerFromKnowledge(orgId, question, { userId });
    res.json(result);
  } catch (err) {
    if (err instanceof AiQuotaExceededError) {
      res.status(429).json({ error: err.message });
      return;
    }
    logger.error({ err }, "[knowledge-base] ask failed");
    res.status(500).json({ error: "Erreur lors de la recherche dans vos documents." });
  }
});

// POST /knowledge-base/reindex — (ré)indexe les documents (admin, cooldown).
const REINDEX_COOLDOWN_MS = 30 * 1000;
const REINDEX_MAP_MAX = 500;
const lastReindexByOrg = new Map<number, number>();
function pruneReindexMap(): void {
  if (lastReindexByOrg.size <= REINDEX_MAP_MAX) return;
  while (lastReindexByOrg.size > REINDEX_MAP_MAX) {
    const first = lastReindexByOrg.keys().next().value;
    if (first === undefined) break;
    lastReindexByOrg.delete(first);
  }
}

router.post(
  "/knowledge-base/reindex",
  requireRole("administrateur"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const orgId = getOrgId(req);
      const userId = (req as { user?: { id?: number } }).user?.id ?? null;
      const now = Date.now();
      const last = lastReindexByOrg.get(orgId) ?? 0;
      if (now - last < REINDEX_COOLDOWN_MS) {
        res.status(429).json({ error: "Veuillez patienter avant de relancer l'indexation." });
        return;
      }
      lastReindexByOrg.set(orgId, now);
      pruneReindexMap();

      const force = Boolean((req.body as { force?: unknown })?.force);
      const result = await indexOrganisation(orgId, { force, userId });
      const status = await getKnowledgeStatus(orgId);
      res.json({ success: true, ...result, status });
    } catch (err) {
      if (err instanceof AiQuotaExceededError) {
        res.status(429).json({ error: err.message });
        return;
      }
      logger.error({ err }, "[knowledge-base] reindex failed");
      res.status(500).json({ error: "Erreur lors de l'indexation des documents." });
    }
  },
);

export default router;
