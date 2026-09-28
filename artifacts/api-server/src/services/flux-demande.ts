/**
 * Une demande entrante routee par le flux « Nouvelle demande » de
 * l'organisation, dessine au studio.
 *
 * Meme journal que le routage par defaut (execution racine + executions
 * enfants des specialistes), memes garde-fous : les agents ne tiennent aucun
 * pouvoir (le catalogue decide de leurs actions), les conditions sont
 * evaluees par le code, et une etape « approbation » envoie en file toute
 * action qui la suit.
 */
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { automationRulesTable, db } from "@workspace/db";
import { executeAction, needsApproval } from "./automation-engine";
import { DECLENCHEUR_DEMANDE, executerFlux, validerFlux } from "./flux-automatisation";
import { ajouterEtape, demarrerExecution, terminerExecution } from "./journal-agents";
import {
  classerDemande, entreeJournal, executerSpecialiste, traiterDemande,
  type DemandeEntrante, type ResultatOrchestration,
} from "./orchestrateur";
import { logger } from "../lib/logger";

export interface RegleDemande {
  id: number;
  name: string;
  flow: unknown;
  requiresApproval: boolean | null;
}

/** La regle « Nouvelle demande » active la plus recente de l'organisation. */
export async function regleDemandeActive(orgId: number): Promise<RegleDemande | null> {
  const [r] = await db.select({
    id: automationRulesTable.id, name: automationRulesTable.name,
    flow: automationRulesTable.flow, requiresApproval: automationRulesTable.requiresApproval,
  }).from(automationRulesTable).where(and(
    eq(automationRulesTable.organisationId, orgId),
    eq(automationRulesTable.trigger, DECLENCHEUR_DEMANDE),
    eq(automationRulesTable.enabled, true),
    isNotNull(automationRulesTable.flow),
  )).orderBy(desc(automationRulesTable.updatedAt)).limit(1);
  return r ?? null;
}

export async function executerFluxDemande(
  orgId: number,
  userId: number,
  regle: RegleDemande,
  demande: DemandeEntrante,
): Promise<ResultatOrchestration> {
  const v = validerFlux(regle.flow, DECLENCHEUR_DEMANDE);
  if (!v.ok) {
    // Valide a l'enregistrement : ceci ne devrait pas arriver. Le routage par
    // defaut vaut mieux qu'une demande perdue.
    logger.error({ orgId, regle: regle.id, erreurs: v.erreurs }, "[flux-demande] flux invalide en base, routage par defaut");
    return traiterDemande(orgId, userId, demande);
  }
  const entree = entreeJournal(demande);
  const runId = await demarrerExecution({
    orgId, agentId: "classificateur", trigger: `flux:${regle.id}`, entree, requestedBy: userId,
  });
  const resultat: ResultatOrchestration = {
    runId, statut: "en_cours", type: null, agent: null, brouillon: null,
    actionsEnAttente: 0, actionsExecutees: 0, actionsRefusees: 0, erreur: null,
  };
  let dernierSpecialiste: string | null = null;

  const element: Record<string, unknown> = {
    canal: demande.canal,
    sujet: demande.sujet ?? "",
    contenu: demande.contenu,
    email: demande.expediteur.email ?? null,
    nom: demande.expediteur.nom ?? null,
  };
  const rapport = await executerFlux(v.flux, { element, approbationRegle: regle.requiresApproval ?? null }, {
    executerAction: (a, el, appr) => executeAction(orgId, a, el, regle.name, appr),
    iraEnFile: needsApproval,
    classer: () => classerDemande(orgId, runId, demande),
    specialiste: async (id) => {
      dernierSpecialiste = id;
      const s = await executerSpecialiste({
        orgId, userId, parentRunId: runId, specialisteId: id, demande, entree,
        decision: { flux: regle.id }, output: {},
      });
      resultat.actionsRefusees += s.actionsRefusees;
      return {
        ok: s.ok, brouillon: s.brouillon, actionsEnAttente: s.actionsEnAttente, actionsExecutees: s.actionsExecutees,
        erreur: s.ok ? undefined : (s.erreur instanceof Error ? s.erreur.message : "L'agent n'a pas pu repondre."),
      };
    },
  });

  const enFile = rapport.actions.filter((a) => a.effet === "en_file").length + Number(rapport.agent.actionsEnAttente ?? 0);
  const executees = rapport.actions.filter((a) => a.effet === "executee").length + Number(rapport.agent.actionsExecutees ?? 0);
  await ajouterEtape(runId, orgId, {
    kind: "decision", name: "flux", status: rapport.erreur ? "echec" : "ok",
    detail: { regle: regle.id, parcours: rapport.parcours, actions: rapport.actions },
    error: rapport.erreur,
  });

  resultat.type = (rapport.agent.type as ResultatOrchestration["type"]) ?? null;
  resultat.agent = dernierSpecialiste;
  resultat.brouillon = (rapport.agent.brouillon as string | undefined) ?? null;
  resultat.actionsEnAttente = enFile;
  resultat.actionsExecutees = executees;
  if (rapport.erreur) {
    resultat.statut = "echouee";
    resultat.erreur = rapport.erreur;
    await terminerExecution(runId, orgId, { status: "echouee", error: rapport.erreur });
    return resultat;
  }
  const statut: "en_attente" | "terminee" = enFile > 0 ? "en_attente" : "terminee";
  resultat.statut = statut;
  await terminerExecution(runId, orgId, {
    status: statut,
    output: { type: resultat.type, resume: rapport.agent.resume ?? null, brouillon: resultat.brouillon, parcours: rapport.parcours },
  });
  return resultat;
}
