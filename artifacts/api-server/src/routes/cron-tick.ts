/**
 * Declencheur externe des taches planifiees (Cloud Scheduler).
 *
 * Monte AVANT requireAuth: Cloud Scheduler n'a pas de session. L'acces est
 * protege par un secret partage (CRON_TRIGGER_SECRET) compare en temps
 * constant. Sans secret configure, la route repond 503 et ne declenche rien —
 * un endpoint capable de lancer facturation et envois d'e-mails ne doit jamais
 * etre joignable sans authentification, meme par accident de configuration.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { rateLimitKey } from "../lib/request-ip";
import { runDueCrons, listRegisteredCrons } from "../services/cron-registry";

const router: IRouter = Router();

// Limite dediee: le declencheur legitime appelle toutes les ~10 minutes.
// Un attaquant qui devinerait l'URL ne doit pas pouvoir marteler la route
// (chaque appel peut reveiller des traitements lourds).
const cronLimiter = rateLimit({
  keyGenerator: rateLimitKey,
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de requetes." },
});

/** Comparaison a temps constant: evite de divulguer le secret par timing. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function authorize(req: Request, res: Response): boolean {
  const expected = process.env.CRON_TRIGGER_SECRET;
  if (!expected) {
    res.status(503).json({ error: "Declencheur non configure." });
    return false;
  }
  const provided = req.get("x-cron-secret") || "";
  if (!provided || !secretMatches(provided, expected)) {
    // Message volontairement identique a l'absence de secret: ne pas indiquer
    // si l'en-tete existe mais est faux.
    res.status(401).json({ error: "Non autorise." });
    return false;
  }
  return true;
}

/**
 * Execute les taches dont l'echeance est depassee.
 *
 * Repond immediatement apres avoir LANCE les taches, sans les attendre: une
 * generation de factures ou un cycle d'agents IA peut durer plusieurs minutes,
 * bien au-dela du delai d'attente de Cloud Scheduler. Un echec de tache est
 * enregistre dans son battement, pas dans cette reponse.
 */
router.post("/cron/tick", cronLimiter, async (req: Request, res: Response): Promise<void> => {
  if (!authorize(req, res)) return;
  try {
    const result = await runDueCrons();
    res.json({ ok: true, ...result });
  } catch (err) {
    req.log.error({ err }, "[cron-tick] Echec du cycle");
    res.status(500).json({ error: "Erreur lors du declenchement." });
  }
});

/** Diagnostic: quelles taches sont connues du registre. */
router.get("/cron/registered", cronLimiter, async (req: Request, res: Response): Promise<void> => {
  if (!authorize(req, res)) return;
  res.json({ crons: listRegisteredCrons() });
});

export default router;
