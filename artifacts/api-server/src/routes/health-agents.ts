/**
 * Panneau de sante technique — reserve au super-admin.
 *
 * Les constats portent sur l'infrastructure partagee (base, services externes,
 * configuration, crons) et non sur les donnees d'un locataire: les exposer a
 * une organisation n'aurait pas de sens et divulguerait des details
 * d'exploitation.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { requireSuperAdmin } from "../middleware/auth";
import { runHealthAgents, getLatestHealthRun, HEALTH_AGENTS } from "../services/health-agents";

const router: IRouter = Router();

router.use("/health-agents", requireSuperAdmin);

/** Liste des agents et de leur domaine, sans rien executer. */
router.get("/health-agents", async (_req: Request, res: Response): Promise<void> => {
  res.json({
    agents: HEALTH_AGENTS.map((a) => ({ id: a.id, name: a.name, domain: a.domain })),
  });
});

/** Dernier cycle enregistre (affichage rapide, sans relancer les sondes). */
router.get("/health-agents/latest", async (req: Request, res: Response): Promise<void> => {
  try {
    const checks = await getLatestHealthRun();
    res.json({ checks });
  } catch (err) {
    req.log.error({ err }, "[health-agents] Echec lecture du dernier cycle");
    res.status(500).json({ error: "Erreur lors du chargement des constats." });
  }
});

/**
 * Lance un cycle complet a la demande. Repond TOUJOURS 200 avec le
 * diagnostic: un cycle qui detecte des pannes est un succes de l'outil, pas
 * une erreur HTTP — renvoyer 500 empecherait d'afficher le diagnostic au
 * moment ou il est le plus utile.
 */
router.post("/health-agents/run", async (req: Request, res: Response): Promise<void> => {
  try {
    const summary = await runHealthAgents(`manuel-${Date.now()}`);
    res.json(summary);
  } catch (err) {
    req.log.error({ err }, "[health-agents] Echec execution");
    res.status(500).json({ error: "Erreur lors de l'execution des agents de sante." });
  }
});

export default router;
