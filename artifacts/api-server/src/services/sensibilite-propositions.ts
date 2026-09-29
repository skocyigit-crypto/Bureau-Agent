/**
 * Ce qu'une proposition d'agent fait sortir du bureau, et comment on la decide
 * (plan du 29/09, section 10).
 *
 * Toutes les approbations ne se valent pas. Ecrire une tache chez soi n'engage
 * personne ; envoyer un message a un client, changer un rendez-vous ferme,
 * relancer une facture ou effacer une donnee, si. Trois regles en decoulent :
 *
 *  - une action SENSIBLE ne s'approuve que sur l'apercu qu'on a vu : le
 *    client renvoie l'empreinte des arguments affiches, le serveur la compare
 *    aux arguments qui vont partir. Si quelqu'un a modifie la proposition
 *    entre-temps, l'approbation est refusee plutot que d'executer autre chose
 *    que ce qui a ete lu ;
 *  - une action sensible ne passe jamais par un lot : dix relances a dix
 *    clients differents, c'est dix decisions ;
 *  - un lot ne rassemble que des actions internes DU MEME TYPE.
 *
 * Un outil inconnu est traite comme sensible : on ne devine pas qu'une action
 * est anodine.
 */
import { createHash } from "node:crypto";

export type NatureAction = "interne" | "externe" | "financier" | "planning" | "suppression";

const NATURES: Readonly<Record<string, NatureAction>> = {
  // Ecrit dans l'organisation, rien ne sort.
  create_contact: "interne",
  update_contact: "interne",
  create_task: "interne",
  update_task: "interne",
  update_project: "interne",
  create_prospect: "interne",
  advance_prospect: "interne",
  log_call: "interne",
  create_call: "interne",
  generate_image: "interne",
  create_excel_document: "interne",
  create_word_document: "interne",
  create_pdf_document: "interne",
  create_powerpoint_document: "interne",
  // Sort de l'organisation : un client, un fournisseur le recoit.
  send_email: "externe",
  send_sms: "externe",
  propose_appointment_slots: "externe",
  // Engage un rendez-vous ou le defait.
  create_calendar_event: "planning",
  reschedule_calendar_event: "planning",
  cancel_calendar_event: "planning",
  // Efface.
  delete_call: "suppression",
  // Argent et abonnement (outils de la plateforme).
  saas_send_invoice_reminder: "financier",
  saas_extend_trial: "financier",
};

export function natureAction(toolName: string): NatureAction {
  const connue = NATURES[toolName];
  if (connue) return connue;
  if (/delete|remove|purge|erase/.test(toolName)) return "suppression";
  if (/invoice|facture|payment|paiement|devis|refund|trial|subscription|relance/.test(toolName)) return "financier";
  if (/calendar|event|appointment|rendez|schedule/.test(toolName)) return "planning";
  // Inconnu : on le traite comme ce qui sort, par prudence.
  return "externe";
}

export function estSensible(toolName: string): boolean {
  return natureAction(toolName) !== "interne";
}

/** JSON aux cles triees : deux objets egaux ont la meme ecriture. */
function canonique(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonique).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${canonique((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** Empreinte des arguments qui partiront : ce que l'humain a vu. */
export function empreinteArgs(args: unknown): string {
  return createHash("sha256").update(canonique(args)).digest("hex").slice(0, 32);
}

/** `expireStaleProposals` expire une proposition apres 14 jours. */
export const DUREE_DE_VIE_JOURS = 14;
export function echeanceDecision(creeLe: Date): Date {
  return new Date(creeLe.getTime() + DUREE_DE_VIE_JOURS * 24 * 60 * 60 * 1000);
}

/**
 * La fiche que la proposition concerne, lue dans ses arguments. Rien n'est
 * devine a partir du texte : sans identifiant, pas de lien.
 */
export function dossierDe(args: unknown): string | null {
  const a = (args ?? {}) as Record<string, unknown>;
  const id = (k: string) => {
    const v = a[k];
    const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  if (id("callId")) return `/appels/${id("callId")}`;
  if (id("prospectId")) return `/prospects/${id("prospectId")}`;
  if (id("contactId")) return `/contacts/${id("contactId")}`;
  if (id("taskId")) return `/taches?id=${id("taskId")}`;
  if (id("eventId")) return `/calendrier?id=${id("eventId")}`;
  if (id("projetId") || id("projectId")) return "/projets";
  if (id("factureId") || id("invoiceId")) return "/factures";
  if (id("devisId")) return "/devis";
  return null;
}

export type Lot = { ok: true } | { ok: false; code: "lot_sensible" | "lot_heterogene"; ids: number[] };

/**
 * Un lot d'approbations est-il permis ? Seulement des actions internes, et
 * toutes du meme type. Les rejets, eux, se groupent toujours.
 */
export function lotAutorise(propositions: ReadonlyArray<{ id: number; toolName: string }>): Lot {
  const sensibles = propositions.filter((p) => estSensible(p.toolName)).map((p) => p.id);
  if (sensibles.length) return { ok: false, code: "lot_sensible", ids: sensibles };
  const types = new Set(propositions.map((p) => p.toolName));
  if (types.size > 1) return { ok: false, code: "lot_heterogene", ids: propositions.map((p) => p.id) };
  return { ok: true };
}
