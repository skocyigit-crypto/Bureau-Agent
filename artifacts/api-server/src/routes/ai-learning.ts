import { Router, type Request, type Response } from "express";
import { getOrgId } from "../middleware/tenant";
import { requireRole } from "../middleware/auth";
import {
  getLearningProfile,
  recomputeLearnedPreferences,
  mineRecurringPatterns,
  getUserLearningProfile,
  recomputeUserProfile,
  listLearnableUsers,
  reactivateSuggestionType,
} from "../services/ai-learning";
import { logger } from "../lib/logger";

const router = Router();

// Dirigeants (peuvent consulter le profil de N'IMPORTE quel employé).
const MANAGER_ROLES = new Set(["super_admin", "administrateur"]);
function isManager(req: Request): boolean {
  return MANAGER_ROLES.has(req.session?.userRole ?? "");
}

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

// GET /ai-learning/users — liste des employés du tenant (vue "patron").
// Réservé aux dirigeants : un agent n'a pas à voir la liste des autres.
router.get("/ai-learning/users", async (req: Request, res: Response): Promise<void> => {
  try {
    if (!isManager(req)) {
      res.status(403).json({ error: "Réservé aux dirigeants." });
      return;
    }
    const orgId = getOrgId(req);
    const users = await listLearnableUsers(orgId);
    res.json({ users });
  } catch (err) {
    logger.error({ err }, "[ai-learning] users failed");
    res.status(500).json({ error: "Erreur lors du chargement des employés." });
  }
});

// GET /ai-learning/user-profile?userId=N — profil PERSONNEL d'un employé.
// Gizlilik: un employé ne voit QUE le sien ; un dirigeant voit n'importe lequel.
router.get("/ai-learning/user-profile", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const me = req.session?.userId;
    if (!me) {
      res.status(401).json({ error: "Non authentifié." });
      return;
    }
    const raw = req.query.userId;
    const requested = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : me;
    if (!Number.isInteger(requested) || requested <= 0) {
      res.status(400).json({ error: "Identifiant employé invalide." });
      return;
    }
    // Un non-dirigeant ne peut consulter que son propre profil.
    if (requested !== me && !isManager(req)) {
      res.status(403).json({ error: "Vous ne pouvez consulter que votre propre profil." });
      return;
    }
    const profile = await getUserLearningProfile(orgId, requested);
    res.json(profile);
  } catch (err) {
    logger.error({ err }, "[ai-learning] user-profile failed");
    res.status(500).json({ error: "Erreur lors du chargement du profil personnel." });
  }
});

// POST /ai-learning/reactivate-suggestion-type — « réafficher » un type mis en
// sourdine. Réservé aux dirigeants (réglage org-wide du comportement proactif).
router.post(
  "/ai-learning/reactivate-suggestion-type",
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!isManager(req)) {
        res.status(403).json({ error: "Réservé aux dirigeants." });
        return;
      }
      const orgId = getOrgId(req);
      const rawType = req.body?.type;
      const type = typeof rawType === "string" ? rawType.trim() : "";
      if (!type) {
        res.status(400).json({ error: "Type de suggestion invalide." });
        return;
      }
      const ok = await reactivateSuggestionType(orgId, type);
      if (!ok) {
        res.status(404).json({ error: "Type de suggestion introuvable." });
        return;
      }
      const profile = await getLearningProfile(orgId);
      res.json({ success: true, profile });
    } catch (err) {
      logger.error({ err }, "[ai-learning] reactivate-suggestion-type failed");
      res.status(500).json({ error: "Erreur lors de la réactivation du type." });
    }
  },
);

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

// POST /ai-learning/recompute-user — recalcule le profil PERSONNEL d'un employé.
// Gizlilik/accès: un employé recalcule SON propre profil ; un dirigeant peut
// recalculer celui de n'importe quel membre de son organisation.
const lastUserRecomputeByKey = new Map<string, number>();
function pruneUserRecomputeMap(): void {
  if (lastUserRecomputeByKey.size <= RECOMPUTE_MAP_MAX) return;
  while (lastUserRecomputeByKey.size > RECOMPUTE_MAP_MAX) {
    const first = lastUserRecomputeByKey.keys().next().value;
    if (first === undefined) break;
    lastUserRecomputeByKey.delete(first);
  }
}

router.post(
  "/ai-learning/recompute-user",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const orgId = getOrgId(req);
      const me = req.session?.userId;
      if (!me) {
        res.status(401).json({ error: "Non authentifié." });
        return;
      }
      const raw = req.body?.userId;
      const requested =
        raw === undefined || raw === null || raw === "" ? me : Number(raw);
      if (!Number.isInteger(requested) || requested <= 0) {
        res.status(400).json({ error: "Identifiant employé invalide." });
        return;
      }
      // Un non-dirigeant ne peut recalculer que son propre profil.
      if (requested !== me && !isManager(req)) {
        res.status(403).json({ error: "Vous ne pouvez recalculer que votre propre profil." });
        return;
      }

      const cooldownKey = `${orgId}:${requested}`;
      const now = Date.now();
      const last = lastUserRecomputeByKey.get(cooldownKey) ?? 0;
      if (now - last < RECOMPUTE_COOLDOWN_MS) {
        res.status(429).json({ error: "Veuillez patienter avant de relancer l'analyse." });
        return;
      }
      lastUserRecomputeByKey.set(cooldownKey, now);
      pruneUserRecomputeMap();

      const factsWritten = await recomputeUserProfile(orgId, requested);
      const profile = await getUserLearningProfile(orgId, requested);
      res.json({ success: true, factsWritten, profile });
    } catch (err) {
      logger.error({ err }, "[ai-learning] recompute-user failed");
      res.status(500).json({ error: "Erreur lors du recalcul du profil personnel." });
    }
  },
);

export default router;
