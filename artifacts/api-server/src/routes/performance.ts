import { Router, type IRouter } from "express";
import { generatePerformanceReport, getPerformanceHistory, gatherUserMetrics } from "../services/performance-analyzer";
import { requireRole } from "../middleware/auth";
import { logAudit } from "./audit";
import { celluleCsv, SEPARATEUR_CSV } from "../lib/csv";

const router: IRouter = Router();

/**
 * Le rapport de performance porte sur des PERSONNES.
 *
 * Il agrege, pour chaque salarie de l organisation: actions, connexions,
 * taches, appels, pointages, HEURES TRAVAILLEES et MINUTES DE PAUSE. C est
 * une mesure de l activite individuelle, et la duree des pauses en fait une
 * mesure du temps de travail.
 *
 * L interface reservait deja ces ecrans aux responsables — App.tsx:
 * `withRoleGate(PerformancePage, ADMIN_ROLES)`. Le serveur, lui, ne
 * verifiait que l authentification: n importe quel compte, y compris
 * `lecture_seule`, pouvait appeler ces routes directement et obtenir les
 * heures et les pauses de tous ses collegues — export CSV compris.
 *
 * Une regle appliquee d un seul cote n est pas une regle. C est meme le
 * defaut le plus courant de ce depot: le garde-fou existe, il manque la ou
 * il compte.
 */
const reserveAuxResponsables = requireRole("super_admin", "administrateur");

router.get("/performance/metriques", reserveAuxResponsables, async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  const orgId = req.session?.organisationId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
  if (!orgId) { res.status(403).json({ error: "Organisation non definie." }); return; }

  const periode = (req.query.periode as string) || "semaine";
  const now = new Date();
  let dateDebut: Date;

  if (periode === "jour") {
    dateDebut = new Date(now);
    dateDebut.setHours(0, 0, 0, 0);
  } else if (periode === "mois") {
    dateDebut = new Date(now);
    dateDebut.setMonth(dateDebut.getMonth() - 1);
  } else {
    dateDebut = new Date(now);
    dateDebut.setDate(dateDebut.getDate() - 7);
  }

  try {
    const metriques = await gatherUserMetrics(dateDebut, now, orgId);
    res.json({ metriques, dateDebut: dateDebut.toISOString(), dateFin: now.toISOString(), periode });
  } catch (err: any) {
    req.log.error({ err }, "Erreur collecte metriques");
    res.status(500).json({ error: "Erreur lors de la collecte des metriques." });
  }
});

router.post("/performance/rapport", reserveAuxResponsables, async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  const orgId = req.session?.organisationId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
  if (!orgId) { res.status(403).json({ error: "Organisation non definie." }); return; }

  const { periode, employeId } = req.body || {};
  const validPeriodes = ["jour", "semaine", "mois"];
  const p = validPeriodes.includes(periode) ? periode : "semaine";

  try {
    const rapport = await generatePerformanceReport(p, orgId, employeId || undefined);

    // Meme trace que l'agent d'equipe (#154), pour la meme raison: une
    // evaluation nominative de salaries doit pouvoir etre expliquee — qui
    // l'a demandee, quand, et sur qui. C'est l'article 5.2 du RGPD, et
    // l'absence de reponse est elle-meme le manquement.
    await logAudit(
      userId,
      req.session?.userEmail,
      "performance_report_generated",
      "evaluation_salaries",
      String(orgId),
      { periode: p, employeId: employeId || null },
      req.ip,
      req.get("user-agent"),
    ).catch((err: unknown) => {
      req.log.warn({ err }, "[performance] trace d'audit non ecrite");
    });

    res.json(rapport);
  } catch (err: any) {
    req.log.error({ err }, "Erreur generation rapport performance");
    res.status(500).json({ error: "Erreur lors de la generation du rapport." });
  }
});

router.get("/performance/historique", reserveAuxResponsables, async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  const orgId = req.session?.organisationId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
  if (!orgId) { res.status(403).json({ error: "Organisation non definie." }); return; }

  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const historique = await getPerformanceHistory(limit, orgId);
    res.json({ historique });
  } catch (err: any) {
    req.log.error({ err }, "Erreur recuperation historique performance");
    res.status(500).json({ error: "Erreur lors de la recuperation de l'historique." });
  }
});

router.get("/performance/metriques/export/csv", reserveAuxResponsables, async (req, res): Promise<void> => {
  const orgId = req.session?.organisationId;
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
  if (!orgId) { res.status(403).json({ error: "Organisation non definie." }); return; }
  const periode = (req.query.periode as string) || "semaine";
  try {
    const now = new Date();
    const dateDebut = new Date(now);
    if (periode === "jour") dateDebut.setDate(now.getDate() - 1);
    else if (periode === "mois") dateDebut.setMonth(now.getMonth() - 1);
    else dateDebut.setDate(now.getDate() - 7);
    const metriques = await gatherUserMetrics(dateDebut, now, orgId);
    const escape = celluleCsv;
    const headers = ["Employé", "Appels", "Durée moy. (min)", "Taux réponse (%)", "Tâches terminées", "Score performance", "Niveau"];
    const lines = [headers.map(celluleCsv).join(SEPARATEUR_CSV), ...metriques.map((m: any) => [
      escape(m.userName || m.userEmail), escape(m.callCount), escape(m.avgDuration),
      escape(m.answerRate), escape(m.tasksCompleted), escape(m.performanceScore), escape(m.performanceLevel),
    ].join(SEPARATEUR_CSV))];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="performance_${periode}_${Date.now()}.csv"`);
    res.send("\uFEFF" + lines.join("\n"));
  } catch (err: any) {
    req.log.error({ err }, "Erreur export performance CSV");
    res.status(500).json({ error: "Erreur lors de l'export." });
  }
});

export default router;
