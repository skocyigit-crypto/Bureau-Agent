/**
 * Agents : catalogue, bureau des taches, suivi et couts, nouvelle demande.
 *
 *   GET  /ajans/catalogue         ce que chaque agent peut lire et faire
 *   GET  /ajans/executions        executions de premier niveau, par statut
 *   GET  /ajans/executions/:id    detail : etapes, execution enfant, approbations
 *   GET  /ajans/couts             cout et jetons par agent sur la periode, quota
 *   POST /ajans/demandes          soumet une demande a l'orchestrateur
 *   GET  /ajans/profils           profils metier, etat publie dans l organisation
 *   POST /ajans/profils/:id/essai|publier|desactiver  essai a blanc, publication
 *
 * Tout est borne a l'organisation de la session. Les couts sont reserves aux
 * responsables : ce sont des montants que l'entreprise paie.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { db, agentRunsTable, agentRunStepsTable, agentProposalsTable } from "@workspace/db";
import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { getOrgId } from "../middleware/tenant";
import { requireRole } from "../middleware/auth";
import { cleLimiteApplicative, rateLimitKey } from "../lib/request-ip";
import { CATALOGUE_AGENTS } from "../services/catalogue-agents";
import { STATUTS_EXECUTION, marquerExecutionsInterrompues, refExecution } from "../services/journal-agents";
import { traiterDemande, CANAUX_DEMANDE } from "../services/orchestrateur";
import { executerFluxDemande, regleDemandeActive } from "../services/flux-demande";
import { getQuotaStatus, AiQuotaExceededError } from "../services/ai-quota";
import { agentProfileSettingsTable } from "@workspace/db";
import { palierOutil } from "../services/catalogue-agents";
import { PROFILS_METIER, profilMetier, roleAutorisePourProfil } from "../services/profils-agents";
import { estActif, etatsProfils } from "../services/profils-org";
import { essayerProfil, essaiValide } from "../services/essai-profil";
import { logAudit } from "./audit";

const router: IRouter = Router();
const requireResponsable = requireRole("super_admin", "administrateur");

// Chaque demande coute deux appels au modele : un plafond par personne
// empeche une boucle (ou un script) de vider le quota de l'entreprise.
const demandeLimiter = rateLimit({
  keyGenerator: rateLimitKey,
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de demandes soumises. Reessayez dans quelques minutes." },
});

router.get("/ajans/catalogue", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const depuis = new Date(Date.now() - 30 * 86400_000);
    const stats = await db.select({
      agentId: agentRunsTable.agentId,
      executions: sql<number>`count(*)::int`,
      echecs: sql<number>`count(*) filter (where ${agentRunsTable.status} = 'echouee')::int`,
      coutUsd: sql<number>`coalesce(sum(${agentRunsTable.costUsd}), 0)::float8`,
      derniere: sql<string | null>`max(${agentRunsTable.startedAt})`,
    }).from(agentRunsTable)
      .where(and(eq(agentRunsTable.organisationId, orgId), gte(agentRunsTable.startedAt, depuis)))
      .groupBy(agentRunsTable.agentId);
    const parAgent = new Map(stats.map((s) => [s.agentId, s]));
    res.json({
      agents: CATALOGUE_AGENTS.map((a) => ({
        ...a,
        activite30j: parAgent.get(a.id) ?? { agentId: a.id, executions: 0, echecs: 0, coutUsd: 0, derniere: null },
      })),
    });
  } catch (err) {
    req.log.error({ err }, "[ajans] catalogue");
    res.status(500).json({ error: "Catalogue indisponible." });
  }
});

router.get("/ajans/executions", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const statut = typeof req.query.statut === "string" ? req.query.statut : null;
    if (statut && !(STATUTS_EXECUTION as readonly string[]).includes(statut)) {
      res.status(400).json({ error: "Statut inconnu." });
      return;
    }
    const limite = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    // Une execution que le processus a abandonnee ne doit pas s'afficher
    // « en cours » : on la clot avant de lire.
    await marquerExecutionsInterrompues(orgId);

    const executions = await db.select().from(agentRunsTable)
      .where(and(
        eq(agentRunsTable.organisationId, orgId),
        isNull(agentRunsTable.parentRunId),
        statut ? eq(agentRunsTable.status, statut) : undefined,
      ))
      .orderBy(desc(agentRunsTable.startedAt))
      .limit(limite);

    const compteurs = await db.select({ status: agentRunsTable.status, n: sql<number>`count(*)::int` })
      .from(agentRunsTable)
      .where(and(eq(agentRunsTable.organisationId, orgId), isNull(agentRunsTable.parentRunId)))
      .groupBy(agentRunsTable.status);

    // Agent specialiste de chaque execution (execution enfant), pour la liste.
    const ids = executions.map((e) => e.id);
    const enfants = ids.length
      ? await db.select({ parentRunId: agentRunsTable.parentRunId, agentId: agentRunsTable.agentId, costUsd: agentRunsTable.costUsd })
        .from(agentRunsTable)
        .where(and(eq(agentRunsTable.organisationId, orgId), inArray(agentRunsTable.parentRunId, ids)))
      : [];
    res.json({
      executions: executions.map((e) => {
        const enfant = enfants.find((c) => c.parentRunId === e.id);
        return { ...e, specialiste: enfant?.agentId ?? null, coutTotalUsd: e.costUsd + (enfant?.costUsd ?? 0) };
      }),
      compteurs: Object.fromEntries(STATUTS_EXECUTION.map((s) => [s, compteurs.find((c) => c.status === s)?.n ?? 0])),
    });
  } catch (err) {
    req.log.error({ err }, "[ajans] executions");
    res.status(500).json({ error: "Executions indisponibles." });
  }
});

router.get("/ajans/executions/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Identifiant invalide." }); return; }
    const [execution] = await db.select().from(agentRunsTable)
      .where(and(eq(agentRunsTable.id, id), eq(agentRunsTable.organisationId, orgId)));
    if (!execution) { res.status(404).json({ error: "Execution introuvable." }); return; }

    const enfants = await db.select().from(agentRunsTable)
      .where(and(eq(agentRunsTable.organisationId, orgId), eq(agentRunsTable.parentRunId, id)))
      .orderBy(asc(agentRunsTable.id));
    const toutes = [execution, ...enfants];
    const etapes = await db.select().from(agentRunStepsTable)
      .where(and(eq(agentRunStepsTable.organisationId, orgId), inArray(agentRunStepsTable.runId, toutes.map((r) => r.id))))
      .orderBy(asc(agentRunStepsTable.runId), asc(agentRunStepsTable.position));
    const approbations = await db.select({
      id: agentProposalsTable.id, toolName: agentProposalsTable.toolName, title: agentProposalsTable.title,
      status: agentProposalsTable.status, runId: agentProposalsTable.runId,
    }).from(agentProposalsTable)
      .where(and(
        eq(agentProposalsTable.organisationId, orgId),
        inArray(agentProposalsTable.runId, toutes.map((r) => refExecution(r.id))),
      ));

    res.json({
      execution: { ...execution, etapes: etapes.filter((e) => e.runId === execution.id) },
      enfants: enfants.map((c) => ({ ...c, etapes: etapes.filter((e) => e.runId === c.id) })),
      approbations,
      coutTotalUsd: toutes.reduce((s, r) => s + r.costUsd, 0),
    });
  } catch (err) {
    req.log.error({ err }, "[ajans] detail");
    res.status(500).json({ error: "Execution indisponible." });
  }
});

router.get("/ajans/couts", requireResponsable, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const jours = Math.min(Math.max(Number(req.query.jours) || 30, 1), 180);
    const depuis = new Date(Date.now() - jours * 86400_000);
    const parAgent = await db.select({
      agentId: agentRunsTable.agentId,
      executions: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${agentRunsTable.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${agentRunsTable.outputTokens}), 0)::int`,
      coutUsd: sql<number>`coalesce(sum(${agentRunsTable.costUsd}), 0)::float8`,
    }).from(agentRunsTable)
      .where(and(eq(agentRunsTable.organisationId, orgId), gte(agentRunsTable.startedAt, depuis)))
      .groupBy(agentRunsTable.agentId);
    const quota = await getQuotaStatus(orgId);
    res.json({
      jours,
      parAgent: parAgent.map((p) => ({
        ...p,
        limiteParExecutionUsd: CATALOGUE_AGENTS.find((a) => a.id === p.agentId)?.limites?.coutMaxUsdParExecution ?? null,
      })),
      totalUsd: parAgent.reduce((s, p) => s + p.coutUsd, 0),
      quotaMensuel: quota,
    });
  } catch (err) {
    req.log.error({ err }, "[ajans] couts");
    res.status(500).json({ error: "Couts indisponibles." });
  }
});

const CorpsDemande = z.object({
  canal: z.enum(CANAUX_DEMANDE),
  expediteur: z.object({
    nom: z.string().trim().max(120).optional().nullable(),
    email: z.string().trim().email().max(200).optional().nullable(),
  }),
  sujet: z.string().trim().max(300).optional().nullable(),
  contenu: z.string().trim().min(1).max(8000),
});

router.post("/ajans/demandes", demandeLimiter, async (req: Request, res: Response): Promise<void> => {
  const lu = CorpsDemande.safeParse(req.body);
  if (!lu.success) {
    res.status(400).json({ error: "Demande invalide.", champs: lu.error.issues.map((i) => i.path.join(".")) });
    return;
  }
  try {
    const orgId = getOrgId(req);
    const userId = req.session?.userId as number;
    // Le flux « Nouvelle demande » de l'organisation, s'il est actif ; sinon
    // le routage par defaut (classificateur → support / vente).
    const regle = await regleDemandeActive(orgId);
    const resultat = regle
      ? await executerFluxDemande(orgId, userId, regle, lu.data)
      : await traiterDemande(orgId, userId, lu.data);
    res.status(201).json(resultat);
  } catch (err) {
    req.log.error({ err }, "[ajans] demande");
    res.status(500).json({ error: "La demande n'a pas pu etre traitee." });
  }
});

// ── Profils metier : liste, essai a blanc, publication ─────────────────────
//
//   GET  /ajans/profils                  les six profils et leur etat ici
//   POST /ajans/profils/:id/essai        essai a blanc (aucun effet de bord),
//                                        reserve aux roles du profil
//   POST /ajans/profils/:id/publier      responsable ; (re)active le profil
//   POST /ajans/profils/:id/desactiver   responsable
//
// Actif par defaut (services/profils-org.ts) : un client existant garde ses
// pouvoirs le jour du deploiement. Publier ne demande donc plus d'essai pour
// etre PERMIS — l'onglet propose toujours l'essai, et la publication cite le
// dernier essai valide s'il y en a un, dans le journal d'audit.
//
// Un profil inconnu repond 404, comme un identifiant d'une autre organisation :
// l'etat est lu et ecrit uniquement sous l'organisation de la session.

const requireEcriture = requireRole("super_admin", "administrateur", "agent");

// Un essai consomme le quota IA reel : plafond PAR PERSONNE (utilisateur
// connecte, sinon IP) — par IP, cinq salaries derriere la meme box se
// partageaient vingt essais.
const essaiLimiter = rateLimit({
  keyGenerator: cleLimiteApplicative,
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: "essai_trop_frequent", error: "Trop d'essais. Reessayez dans quelques minutes." },
});

function profilDeRequete(req: Request, res: Response) {
  const p = profilMetier(String(req.params.id));
  if (!p) res.status(404).json({ code: "profil_inconnu", error: "Profil introuvable." });
  return p;
}

router.get("/ajans/profils", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const etats = await etatsProfils(orgId);
    const role = req.session?.userRole as string | undefined;
    // Ce que CE role peut faire de chaque profil : l'ecran en deduit le
    // selecteur de l'assistant et l'etat du bouton « Essai ». Le serveur
    // refuse de toute facon ; l'ecran evite seulement de proposer un refus.
    const ecrit = role === "super_admin" || role === "administrateur" || role === "agent";
    res.json({
      profils: PROFILS_METIER.map((p) => {
        const e = etats.get(p.id);
        return {
          id: p.id, nom: p.nom, mission: p.mission, sources: p.sources, transfertHumain: p.transfertHumain,
          exemple: p.exemple, reserveResponsables: p.roles !== null,
          outils: p.outils.map((nom) => ({ nom, palier: palierOutil(nom) })),
          active: estActif(e), publieLe: e?.publishedAt ?? null, dernierEssai: e?.lastDryRunId ?? null,
          roleAutorise: roleAutorisePourProfil(p, role), peutEssayer: ecrit && roleAutorisePourProfil(p, role),
        };
      }),
    });
  } catch (err) {
    req.log.error({ err }, "[ajans] profils");
    res.status(500).json({ error: "Profils indisponibles." });
  }
});

const CorpsEssai = z.object({ entree: z.string().trim().min(1).max(4000) });

router.post("/ajans/profils/:id/essai", requireEcriture, essaiLimiter, async (req: Request, res: Response): Promise<void> => {
  const p = profilDeRequete(req, res);
  if (!p) return;
  const lu = CorpsEssai.safeParse(req.body);
  if (!lu.success) { res.status(400).json({ code: "essai_invalide", error: "Exemple invalide." }); return; }
  // Meme regle que l'ouverture d'une conversation : un profil reserve aux
  // responsables ne s'essaie pas (ni ne consomme le quota) sous un autre role.
  if (!roleAutorisePourProfil(p, req.session?.userRole as string | undefined)) {
    res.status(403).json({ code: "profil_role", error: `Le profil « ${p.nom} » est reserve aux responsables.` });
    return;
  }
  try {
    const r = await essayerProfil(getOrgId(req), req.session?.userId as number, p.id, lu.data.entree);
    res.json(r);
  } catch (err) {
    // Quota epuise : dit tel quel, avec un code que l'ecran affiche. Un essai
    // muet laisserait croire que l'agent n'a simplement rien a faire.
    if (err instanceof AiQuotaExceededError) {
      res.status(429).json({ code: "quota_ia", error: "Quota IA epuise : l'essai n'a pas ete lance. Augmentez le quota ou attendez la prochaine periode." });
      return;
    }
    req.log.error({ err }, "[ajans] essai");
    res.status(502).json({ code: "essai_echoue", error: "L'essai a echoue : le modele n'a pas repondu." });
  }
});

router.post("/ajans/profils/:id/publier", requireResponsable, async (req: Request, res: Response): Promise<void> => {
  const p = profilDeRequete(req, res);
  if (!p) return;
  try {
    const orgId = getOrgId(req);
    const userId = req.session?.userId as number;
    // Plus d'essai exige (actif par defaut) ; on cite le dernier essai VALIDE
    // de cette organisation et de ce profil s'il existe, et l'audit dit s'il
    // s'agit d'une reactivation apres une desactivation.
    const essai = await essaiValide(orgId, p.id);
    const avant = (await etatsProfils(orgId)).get(p.id);
    const reactivation = !!avant && avant.enabled === false;
    const maintenant = new Date();
    await db.insert(agentProfileSettingsTable)
      .values({ organisationId: orgId, agentId: p.id, enabled: true, publishedAt: maintenant, publishedBy: userId, lastDryRunId: essai })
      .onConflictDoUpdate({
        target: [agentProfileSettingsTable.organisationId, agentProfileSettingsTable.agentId],
        set: { enabled: true, publishedAt: maintenant, publishedBy: userId, updatedAt: maintenant },
      });
    await logAudit(userId, req.session?.userEmail, reactivation ? "agent.profil_reactive" : "agent.profil_publie", "agent_profile", p.id, { essai, reactivation }, req.ip, req.get("user-agent"), orgId);
    res.json({ id: p.id, active: true, publieLe: maintenant });
  } catch (err) {
    req.log.error({ err }, "[ajans] publier");
    res.status(500).json({ error: "Publication impossible." });
  }
});

router.post("/ajans/profils/:id/desactiver", requireResponsable, async (req: Request, res: Response): Promise<void> => {
  const p = profilDeRequete(req, res);
  if (!p) return;
  try {
    const orgId = getOrgId(req);
    const userId = req.session?.userId as number;
    // Upsert : sans ligne le profil est ACTIF ; un simple UPDATE ne toucherait
    // rien et repondrait « desactive » a tort.
    const maintenant = new Date();
    await db.insert(agentProfileSettingsTable)
      .values({ organisationId: orgId, agentId: p.id, enabled: false, updatedAt: maintenant })
      .onConflictDoUpdate({
        target: [agentProfileSettingsTable.organisationId, agentProfileSettingsTable.agentId],
        set: { enabled: false, updatedAt: maintenant },
      });
    await logAudit(userId, req.session?.userEmail, "agent.profil_desactive", "agent_profile", p.id, {}, req.ip, req.get("user-agent"), orgId);
    res.json({ id: p.id, active: false });
  } catch (err) {
    req.log.error({ err }, "[ajans] desactiver");
    res.status(500).json({ error: "Desactivation impossible." });
  }
});

export default router;
