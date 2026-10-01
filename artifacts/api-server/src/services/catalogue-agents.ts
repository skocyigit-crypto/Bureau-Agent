/**
 * Catalogue des agents : pour chacun, sa mission, son modele, ses sources de
 * connaissance, ses outils et ses limites — DECLARES ici, pas eparpilles dans
 * les prompts.
 *
 * Avant ce fichier, rien ne liait un agent a ce qu'il a le droit de faire :
 * l'assistant recevait les 36 outils, les autres portaient une liste locale
 * que l'execution ne relisait pas. Le catalogue sert trois lecteurs :
 *
 *  - l'orchestrateur (services/orchestrateur.ts), qui APPLIQUE les outils,
 *    les sources et les limites des agents qu'il fait tourner ;
 *  - l'ecran « Catalogue des agents », qui montre au client ce que chaque
 *    agent peut toucher ;
 *  - `catalogue-agents.test.ts`, qui verifie que ce qui est declare pour les
 *    agents existants est bien ce qu'ils utilisent (les listes viennent de
 *    leur module, pas d'une copie).
 *
 * Palier d'un outil — le meme vocabulaire que `/ai/execute`
 * (services/paliers-actions-ia.ts) :
 *   lecture    : rien ne change ;
 *   interne    : ecrit dans l'organisation, rien ne sort ;
 *   externe    : quitte l'organisation (e-mail, SMS) — toujours en approbation ;
 *   destructif : supprime ou annule — toujours en approbation.
 */
import { getTool } from "./assistant-tools";
import {
  OUTILS_AGENT_SUPPORT, OUTILS_AGENT_VENTE, OUTILS_ASSISTANT_UNIVERSEL, PROFILS_METIER,
} from "./profils-agents";
import { listSaasTools } from "./saas-tools";
import { ALLOWED_TOOLS as OUTILS_SECRETAIRE } from "./autonomous-secretary";
import { ALLOWED_TOOLS as OUTILS_AUTO_AUDIT } from "./app-audit";
import { GEMINI_FLASH_MODEL, GEMINI_PRO_MODEL } from "./ai-utils";
import { KB_CATEGORIES_PUBLIQUES } from "./knowledge-base";

export type PalierOutil = "lecture" | "interne" | "externe" | "destructif";

/** Outils qui font sortir quelque chose de l'organisation. */
const OUTILS_EXTERNES = new Set(["send_email", "send_sms", "propose_appointment_slots", "saas_send_invoice_reminder"]);
/** Outils qui suppriment ou annulent. */
const OUTILS_DESTRUCTIFS = new Set(["delete_call", "cancel_calendar_event", "saas_suspend_subscription"]);

export function palierOutil(nom: string): PalierOutil {
  if (OUTILS_EXTERNES.has(nom)) return "externe";
  if (OUTILS_DESTRUCTIFS.has(nom)) return "destructif";
  if (nom.startsWith("saas_")) return "interne";
  const outil = getTool(nom);
  // Un outil qui n'exige pas de confirmation ne change rien : c'est une lecture.
  return outil?.requiresConfirmation ? "interne" : "lecture";
}

/** Un palier qui impose une decision humaine AVANT l'execution. */
export function exigeApprobation(palier: PalierOutil): boolean {
  return palier === "externe" || palier === "destructif";
}

export interface OutilDeclare { nom: string; palier: PalierOutil }

export interface AgentDuCatalogue {
  id: string;
  nom: string;
  mission: string;
  /** Modele demande ; en cas de panne, le repli de fournisseur s'applique. */
  modele: string;
  sources: {
    /** Categories de la base de connaissances lisibles, ou null : aucune. */
    baseConnaissances: readonly string[] | null;
    /** Autres donnees lues, en clair pour le client. */
    donnees: readonly string[];
  };
  outils: readonly OutilDeclare[];
  /**
   * Limites APPLIQUEES par l'orchestrateur. `null` pour un agent qui tourne
   * dans son propre module : on ne declare pas une limite qu'on n'applique pas.
   */
  limites: { coutMaxUsdParExecution: number; appelsModeleMax: number; actionsMax: number } | null;
  /** Ou il tourne : c'est ce qui dit quel code applique ce qui precede. */
  execution: "orchestrateur" | "assistant" | "cron" | "cron-plateforme";
  /** Ce que l'agent rend. */
  sortie: string;
  /** Profils metier : quand l'agent passe la main a un humain. Absent sinon. */
  transfertHumain?: { conditions: readonly string[]; cible: "responsable" | "utilisateur" };
  /** Profils metier : publies par organisation (onglet « Test et publication »). */
  profilMetier?: true;
}

function outils(noms: readonly string[]): OutilDeclare[] {
  return noms.map((nom) => ({ nom, palier: palierOutil(nom) }));
}

export const CATALOGUE_AGENTS: readonly AgentDuCatalogue[] = [
  {
    id: "classificateur",
    nom: "Classificateur",
    mission: "Lit une demande entrante et decide a quel agent la confier : support, vente, ou aucun.",
    modele: GEMINI_FLASH_MODEL,
    sources: { baseConnaissances: null, donnees: ["la demande elle-meme"] },
    outils: [],
    limites: { coutMaxUsdParExecution: 0.02, appelsModeleMax: 1, actionsMax: 0 },
    execution: "orchestrateur",
    sortie: "type (support | vente | autre), confiance, resume en une phrase",
  },
  {
    id: "agent-support",
    nom: "Agent support",
    mission: "Prepare la reponse a une demande d'assistance d'un client, et la tache de suivi si besoin.",
    modele: GEMINI_FLASH_MODEL,
    // Il repond a un TIERS : seuls les documents classes « Public » l'alimentent,
    // comme le standard telephonique (services/knowledge-base.ts).
    sources: { baseConnaissances: KB_CATEGORIES_PUBLIQUES, donnees: ["la demande", "l'expediteur"] },
    outils: outils(OUTILS_AGENT_SUPPORT),
    limites: { coutMaxUsdParExecution: 0.05, appelsModeleMax: 1, actionsMax: 3 },
    execution: "orchestrateur",
    sortie: "brouillon de reponse et actions proposees (tache, e-mail)",
  },
  {
    id: "agent-vente",
    nom: "Agent commercial",
    mission: "Qualifie une demande commerciale : cree le prospect, prepare la reponse et la relance.",
    modele: GEMINI_FLASH_MODEL,
    sources: { baseConnaissances: KB_CATEGORIES_PUBLIQUES, donnees: ["la demande", "l'expediteur"] },
    outils: outils(OUTILS_AGENT_VENTE),
    limites: { coutMaxUsdParExecution: 0.05, appelsModeleMax: 1, actionsMax: 3 },
    execution: "orchestrateur",
    sortie: "brouillon de reponse et actions proposees (prospect, tache, e-mail)",
  },
  {
    id: "assistant",
    nom: "Assistant",
    mission: "Repond en conversation et organise le travail interne (taches, agenda, documents) : chaque ecriture est confirmee par l'utilisateur.",
    modele: process.env.ASSISTANT_MODEL || GEMINI_PRO_MODEL,
    sources: { baseConnaissances: ["toutes (utilisateur connecte)"], donnees: ["contacts", "taches", "agenda", "prospects", "appels", "messages"] },
    // Plus le registre entier : l'assistant universel restreint
    // (services/profils-agents.ts). Les pouvoirs CRM, telephone, finance et
    // les envois appartiennent aux profils metier ci-dessous.
    outils: outils(OUTILS_ASSISTANT_UNIVERSEL),
    limites: null,
    execution: "assistant",
    sortie: "reponse en conversation ; les ecritures passent par une confirmation",
  },
  {
    id: "secretaire-autonome",
    nom: "Secretaire autonome",
    mission: "Examine l'activite (retards, appels manques, messages) et propose des actions dans la file d'approbation.",
    modele: GEMINI_FLASH_MODEL,
    sources: { baseConnaissances: null, donnees: ["taches en retard", "appels manques", "messages non lus", "rendez-vous", "contacts"] },
    outils: outils(OUTILS_SECRETAIRE),
    limites: null,
    execution: "cron",
    sortie: "propositions en file d'approbation — n'execute rien seule",
  },
  {
    id: "auto-audit",
    nom: "Auto-audit",
    mission: "Controle la coherence des donnees de l'organisation et propose les corrections.",
    modele: GEMINI_FLASH_MODEL,
    sources: { baseConnaissances: null, donnees: ["donnees de l'organisation (lecture)"] },
    outils: outils(OUTILS_AUTO_AUDIT),
    limites: null,
    execution: "cron",
    sortie: "constats et propositions en file d'approbation",
  },
  {
    id: "agent-saas",
    nom: "Agent plateforme",
    mission: "Surveille les abonnements des clients de la plateforme et applique ce qui est mecanique.",
    modele: "aucun (regles)",
    sources: { baseConnaissances: null, donnees: ["abonnements", "factures de la plateforme"] },
    outils: outils(listSaasTools().map((t) => t.name)),
    limites: null,
    execution: "cron-plateforme",
    sortie: "relances appliquees, gestes commerciaux proposes au super-administrateur",
  },
  // Les six profils metier : leurs outils, sources et regles de transfert sont
  // ceux de services/profils-agents.ts, appliques par `executeTool`.
  ...PROFILS_METIER.map((p): AgentDuCatalogue => ({
    id: p.id,
    nom: p.nom,
    mission: p.mission,
    modele: process.env.ASSISTANT_MODEL || GEMINI_PRO_MODEL,
    sources: p.sources,
    outils: outils(p.outils),
    limites: null,
    execution: "assistant",
    sortie: "reponse en conversation ; ecritures confirmees, envois et suppressions en approbation",
    transfertHumain: p.transfertHumain,
    profilMetier: true,
  })),
];

export function agentDuCatalogue(id: string): AgentDuCatalogue | undefined {
  return CATALOGUE_AGENTS.find((a) => a.id === id);
}

/** L'agent a-t-il le droit d'utiliser cet outil ? Refus par defaut. */
export function outilAutorise(agentId: string, outil: string): boolean {
  return agentDuCatalogue(agentId)?.outils.some((o) => o.nom === outil) ?? false;
}
