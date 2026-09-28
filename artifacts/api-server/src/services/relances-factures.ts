/**
 * Relances de facture : ce qui part vers le client final de l'organisation.
 *
 * Mesure du 28/09 : quatre chemins relancaient, chacun a sa facon.
 *   - Le cron quotidien respectait `billingRequiresApproval` (file d'approbation)
 *     et `autoRemindersEnabled`, sous verrou.
 *   - L'agent SaaS et l'outil SaaS appelaient la meme fonction en mode
 *     « send » force : ni l'approbation exigee par l'organisation, ni son
 *     desabonnement, ni le verrou du cron — deux envois possibles le meme
 *     jour.
 *   - Le Commandant IA envoyait le texte ecrit par le modele, different de
 *     celui montre a l'ecran (second appel au modele), sans file.
 *   - Une relance approuvee dans la file partait par `send_email`, mais rien
 *     ne l'enregistrait : ni `payment_reminders` ni `lastReminderAt`. Le garde
 *     « pas deux relances en 7 jours » ne la voyait pas, le niveau restait 1,
 *     et le lendemain la meme relance etait reproposee.
 *
 * Ce module porte ce qui doit etre identique partout : la reference d'une
 * relance dans la file, le niveau suivant, la verification qu'elle est encore
 * due au moment d'approuver, et son enregistrement une fois partie.
 */
import { and, eq, sql } from "drizzle-orm";
import { db, facturesClientTable, paymentRemindersTable } from "@workspace/db";
import { escapeHtml } from "../lib/html-escape";
import { enqueueProposal } from "./proposal-queue";

/** `sourceType` des propositions de relance dans `agent_proposals`. */
export const SOURCE_RELANCE = "invoice_reminder";

export function refRelance(factureId: number, niveau: number): string {
  return `relance:${factureId}:${niveau}`;
}

export function lireRefRelance(ref: string | null | undefined): { factureId: number; niveau: number } | null {
  const m = /^relance:(\d+):(\d+)$/.exec((ref ?? "").trim());
  if (!m) return null;
  const factureId = Number(m[1]);
  const niveau = Number(m[2]);
  return factureId > 0 && niveau > 0 ? { factureId, niveau } : null;
}

/** Niveau de la prochaine relance : relances reellement parties + 1. */
export async function niveauRelanceSuivant(factureId: number): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(paymentRemindersTable)
    .where(and(eq(paymentRemindersTable.factureClientId, factureId), eq(paymentRemindersTable.status, "sent")));
  return (r?.n ?? 0) + 1;
}

export type RelanceDue =
  | { due: true; facture: typeof facturesClientTable.$inferSelect }
  | { due: false; raison: string };

/**
 * La relance proposee est-elle encore a envoyer, au moment ou on l'approuve ?
 * Une facture reglee (ou supprimee) entre la proposition et le clic ne doit
 * plus recevoir de relance ; une relance de meme niveau deja partie non plus.
 */
export async function relanceEncoreDue(orgId: number, ref: string | null | undefined): Promise<RelanceDue> {
  const lue = lireRefRelance(ref);
  if (!lue) return { due: false, raison: "Reference de relance illisible." };
  const [facture] = await db.select().from(facturesClientTable)
    .where(and(eq(facturesClientTable.id, lue.factureId), eq(facturesClientTable.organisationId, orgId)));
  if (!facture) return { due: false, raison: "La facture n'existe plus." };
  const restant = Number(facture.totalAmount) - Number(facture.paidAmount);
  if (facture.status === "payee" || !(restant > 0.005)) {
    return { due: false, raison: `La facture ${facture.reference} est reglee : la relance n'est plus envoyee.` };
  }
  if ((await niveauRelanceSuivant(facture.id)) > lue.niveau) {
    return { due: false, raison: `La relance n°${lue.niveau} de ${facture.reference} est deja partie.` };
  }
  return { due: true, facture };
}

/**
 * Enregistre une relance : une ligne `payment_reminders` et, si elle est
 * partie, le compteur et la date sur la facture — que lit l'espacement
 * anti-martelement de `payment-reminder.ts`.
 */
export async function consignerRelance(input: {
  orgId: number;
  factureId: number;
  niveau: number;
  destinataire: string;
  nom?: string | null;
  sujet: string;
  envoyee: boolean;
  type?: string;
  metadata?: Record<string, unknown>;
}): Promise<number | null> {
  const maintenant = new Date();
  const [ligne] = await db.insert(paymentRemindersTable).values({
    organisationId: input.orgId,
    factureClientId: input.factureId,
    type: input.type ?? "auto_reminder",
    recipientEmail: input.destinataire,
    recipientName: input.nom ?? null,
    subject: input.sujet,
    status: input.envoyee ? "sent" : "failed",
    sentAt: input.envoyee ? maintenant : null,
    reminderLevel: input.niveau,
    metadata: input.metadata ?? {},
  }).returning({ id: paymentRemindersTable.id });
  if (input.envoyee) {
    await db.update(facturesClientTable).set({
      reminderCount: sql`${facturesClientTable.reminderCount} + 1`,
      lastReminderAt: maintenant,
      updatedAt: maintenant,
    }).where(and(eq(facturesClientTable.id, input.factureId), eq(facturesClientTable.organisationId, input.orgId)));
  }
  return ligne?.id ?? null;
}

/**
 * Les relances de l'organisation passent-elles par la file d'approbation ?
 * Son choix explicite, sinon l'ancien reglage commun (voir le schema).
 */
export function relancesSurApprobation(org: { remindersRequireApproval: boolean | null; billingRequiresApproval: boolean }): boolean {
  return org.remindersRequireApproval ?? org.billingRequiresApproval;
}

/**
 * Relances redigees par le modele (Commandant IA) : deposees en file
 * d'approbation avec le texte exact qui partira — jamais envoyees d'ici.
 *
 * Le modele ne choisit pas le destinataire : la facture est retrouvee par SA
 * reference parmi celles de l'organisation, et l'adresse est celle de la
 * facture. Une reference inconnue, une facture sans e-mail ou deja vue dans
 * la meme reponse est ignoree. Rend le nombre de relances NOUVELLEMENT mises
 * en file (une relance deja en attente pour ce niveau n'est pas recomptee).
 */
export async function proposerRelancesRedigees(input: {
  orgId: number;
  factures: Array<typeof facturesClientTable.$inferSelect>;
  relances: Array<{ invoiceRef?: unknown; message?: unknown }>;
  iban: string | null;
  habiller: (titre: string, corps: string) => string;
}): Promise<number> {
  let misesEnFile = 0;
  const vues = new Set<number>();
  for (const relance of input.relances) {
    const facture = input.factures.find((f) => f.organisationId === input.orgId && f.reference === relance.invoiceRef);
    if (!facture?.clientEmail || vues.has(facture.id)) continue;
    vues.add(facture.id);
    const restant = Number(facture.totalAmount) - Number(facture.paidAmount);
    const niveau = await niveauRelanceSuivant(facture.id);
    const message = typeof relance.message === "string" ? relance.message.slice(0, 4000) : "";
    const html = input.habiller("Rappel de paiement",
      `<h2 style="color:#dc2626;">Rappel - ${escapeHtml(facture.reference)}</h2><p>${escapeHtml(message)}</p>` +
      `<div style="background:#fef2f2;padding:20px;border-radius:10px;text-align:center;margin:20px 0;"><div style="font-size:24px;font-weight:700;color:#dc2626;">${restant.toFixed(2)} EUR</div></div>` +
      (input.iban ? `<p style="font-size:12px;color:#64748b;">IBAN: ${escapeHtml(input.iban)} | Ref: ${escapeHtml(facture.reference)}</p>` : ""));
    const r = await enqueueProposal({
      orgId: input.orgId,
      toolName: "send_email",
      title: `Relance ${facture.reference} — ${facture.clientName}`,
      summary: `Envoyer a ${facture.clientName} (${facture.clientEmail}) la relance redigee par l'IA pour ${restant.toFixed(2)} EUR.`,
      reason: `Demandee depuis le Commandant IA. Relance n°${niveau} de la facture ${facture.reference}.`,
      args: { to: facture.clientEmail, subject: `Rappel - Facture ${facture.reference}`, body: html },
      category: "relance",
      priority: niveau >= 3 ? "haute" : "moyenne",
      sourceType: SOURCE_RELANCE,
      sourceRef: refRelance(facture.id, niveau),
    });
    if (r.ok && !r.duplicate) misesEnFile++;
  }
  return misesEnFile;
}
