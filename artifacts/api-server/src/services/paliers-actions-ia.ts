/**
 * Paliers des actions que `/ai/execute` peut declencher depuis une suggestion
 * de l'IA (/ai/chat) — lire, ecrire chez soi, sortir de l'organisation, toucher
 * a l'argent ne sont pas le meme droit.
 *
 * Avant ce tableau, un clic sur un bouton dont le MODELE avait ecrit le libelle
 * executait tout au meme niveau : `send_email` partait sans que les arguments
 * soient montres, et `chain_actions` — qui accepte n'importe quel type —
 * atteignait `create_invoice`, `record_payment` ou `send_payment_reminder`,
 * que l'ecran ne proposait pourtant pas. Le contexte du modele contient des
 * messages entrants et des notes d'appel : un texte hostile pouvait donc
 * suggerer l'action.
 *
 *   lecture   : rien ne change, rien ne sort — execution directe.
 *   interne   : ecrit dans l'organisation (tache, contact, evenement,
 *               notification interne), rien ne sort — execution directe,
 *               l'humain a clique.
 *   externe   : quitte l'organisation (e-mail) — jamais directement : mise en
 *               file d'approbation, ou destinataire, sujet et corps sont
 *               visibles et modifiables avant l'envoi.
 *   financier : facture, encaissement, relance de paiement — jamais depuis une
 *               suggestion IA ; ces actions ont leur ecran, ou le montant et le
 *               destinataire sont sous les yeux.
 *
 * Tout type traite par `/ai/execute` DOIT figurer ici :
 * `paliers-actions-ia.test.ts` compare ce tableau au `switch` de la route.
 */
export type PalierAction = "lecture" | "interne" | "externe" | "financier";

export const PALIERS_AI_EXECUTE: Readonly<Record<string, PalierAction>> = {
  // lecture
  search_contacts: "lecture",
  search_web: "lecture",
  search_all: "lecture",
  generate_report: "lecture",
  export_data: "lecture",
  account_health_check: "lecture",
  cash_flow_forecast: "lecture",
  daily_briefing: "lecture",
  meeting_prep: "lecture",
  risk_analysis: "lecture",
  revenue_forecast: "lecture",
  // Concoit la campagne (sujet, modele) ; n'envoie rien.
  smart_campaign: "lecture",
  performance_audit: "lecture",
  competitor_analysis: "lecture",

  // interne
  create_task: "interne",
  create_contact: "interne",
  complete_task: "interne",
  escalate_task: "interne",
  bulk_escalate: "interne",
  mark_messages_read: "interne",
  // Notification dans l'application, a l'utilisateur lui-meme.
  send_notification: "interne",
  stock_alert: "interne",
  update_task: "interne",
  bulk_complete_tasks: "interne",
  update_contact: "interne",
  create_event: "interne",
  schedule_followup: "interne",
  create_project: "interne",
  update_project: "interne",
  create_prospect: "interne",
  update_prospect: "interne",
  convert_prospect: "interne",
  update_stock: "interne",
  // Chaque etape rappelle /ai/execute et repasse donc par ce tableau.
  chain_actions: "interne",

  // externe
  send_email: "externe",

  // financier
  create_invoice: "financier",
  record_payment: "financier",
  send_invoice_email: "financier",
  send_payment_reminder: "financier",
};

export function palierAction(type: string): PalierAction | undefined {
  return Object.prototype.hasOwnProperty.call(PALIERS_AI_EXECUTE, type) ? PALIERS_AI_EXECUTE[type] : undefined;
}

export const REFUS_FINANCIER =
  "Une facture, un encaissement ou une relance ne part pas d'une suggestion de l'IA : " +
  "ouvrez l'ecran Factures, ou le montant et le destinataire sont visibles avant l'envoi.";

export interface EmailSuggere { to: string; subject: string; body: string }

/** Lit la cible d'un `send_email` suggere ; `null` si elle est inexploitable. */
export function lireEmailSuggere(target: unknown): EmailSuggere | null {
  let data: unknown = target;
  if (typeof target === "string") {
    try { data = JSON.parse(target); } catch { return null; }
  }
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const to = Array.isArray(d.to) ? d.to[0] : d.to;
  if (typeof to !== "string" || typeof d.subject !== "string" || typeof d.body !== "string") return null;
  if (!to.trim() || !d.subject.trim() || !d.body.trim()) return null;
  return { to: to.trim(), subject: d.subject, body: d.body };
}
