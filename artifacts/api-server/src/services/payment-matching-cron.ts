/**
 * payment-matching-cron.ts — rapprocher les virements sans qu'on le demande.
 *
 * Le rapprochement existait, mais il fallait aller cliquer: `POST
 * /billing/match-payments`. Un encaissement restait donc « en attente » aussi
 * longtemps que personne n'y pensait — et pendant ce temps la facture reste
 * impayee, les relances partent, et le client qui a paye recoit une relance.
 *
 * C'est le dernier maillon manuel de la boucle d'encaissement, et le seul qui
 * n'avait aucune raison de l'etre: le rapprochement ne decide plus rien de
 * risque. Depuis `payment-matching.ts`, il n'applique QUE ce qui porte une
 * reference de facture; tout le reste attend une lecture humaine. Automatiser
 * un geste qui ne peut plus se tromper de client, c'est enlever du travail
 * sans deplacer le risque.
 *
 * Ce que ce cron ne fait pas: importer le releve. Les virements doivent
 * d'abord entrer (`/billing/upload-bank` aujourd'hui, un flux bancaire
 * ensuite). Tant que personne ne depose de releve, ce cron tourne a vide et ne
 * coute rien.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { db, invoicesTable, organisationsTable, paymentsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { withHeartbeat } from "./health-agents";
import { apparier } from "./payment-matching";

/** Toutes les heures: un virement arrive rarement a la minute pres. */
const TICK_MS = 60 * 60 * 1000;
let timer: NodeJS.Timeout | null = null;

export interface BilanRapprochement {
  rapproches: number;
  suggestions: number;
  enAttente: number;
}

/**
 * Rapproche les paiements en attente. Exporte pour etre appelable directement
 * — un travail qui touche a l'argent ne doit pas n'etre atteignable qu'a
 * travers un `setInterval`.
 */
export async function rapprocherPaiementsEnAttente(): Promise<BilanRapprochement> {
  const paiements = await db
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.status, "pending"))
    .orderBy(desc(paymentsTable.createdAt));

  if (paiements.length === 0) return { rapproches: 0, suggestions: 0, enAttente: 0 };

  const facturesOuvertes = await db
    .select({
      invoice: invoicesTable,
      orgName: organisationsTable.name,
    })
    .from(invoicesTable)
    .leftJoin(organisationsTable, eq(invoicesTable.organisationId, organisationsTable.id))
    .where(sql`${invoicesTable.status} IN ('en_attente', 'retard')`);

  if (facturesOuvertes.length === 0) {
    return { rapproches: 0, suggestions: 0, enAttente: paiements.length };
  }

  const dejaPrises = new Set<number>();
  let rapproches = 0;
  let suggestions = 0;

  for (const paiement of paiements) {
    const resultat = apparier(
      {
        bankRef: paiement.bankRef,
        payerName: paiement.payerName,
        rawLine: paiement.rawLine,
        amount: Number(paiement.amount),
      },
      facturesOuvertes
        .filter((f) => !dejaPrises.has(f.invoice.id))
        .map((f) => {
          // Le client vire le TTC. Les factures anterieures a la TVA portent un
          // `totalTtc` a zero: on retombe alors sur le HT, qui etait bien le
          // montant reclame a l'epoque.
          const ttc = Number(f.invoice.totalTtc);
          return {
            id: f.invoice.id,
            organisationId: f.invoice.organisationId,
            reference: f.invoice.reference,
            duMontant: ttc > 0 ? ttc : Number(f.invoice.totalAmount),
            orgName: f.orgName,
          };
        }),
    );

    suggestions += resultat.suggestions.length;
    if (!resultat.automatique) continue;

    const { factureId, organisationId } = resultat.automatique;
    dejaPrises.add(factureId);

    // Le paiement et la facture basculent ensemble: un arret entre les deux
    // laisserait un paiement « rapproche » en face d'une facture impayee.
    await db.transaction(async (tx) => {
      await tx
        .update(paymentsTable)
        .set({
          invoiceId: factureId,
          organisationId,
          status: "matched",
          matchedBy: "auto",
          matchConfidence: String(resultat.automatique!.confiance),
        })
        .where(and(eq(paymentsTable.id, paiement.id), eq(paymentsTable.status, "pending")));

      await tx
        .update(invoicesTable)
        .set({ status: "payee", paidAt: new Date() })
        .where(eq(invoicesTable.id, factureId));
    });

    rapproches += 1;
  }

  if (rapproches > 0 || suggestions > 0) {
    logger.info(
      { rapproches, suggestions, examines: paiements.length },
      "[payment-matching-cron] rapprochement automatique",
    );
  }
  return { rapproches, suggestions, enAttente: paiements.length - rapproches };
}

async function tick(): Promise<void> {
  try {
    await rapprocherPaiementsEnAttente();
  } catch (err) {
    logger.error({ err }, "[payment-matching-cron] tick failed");
  }
}

export function startPaymentMatchingCron(): void {
  if (timer) return;
  setTimeout(() => { void tick(); }, 3 * 60_000);
  timer = setInterval(withHeartbeat("payment-matching", TICK_MS, tick), TICK_MS);
  if (typeof timer.unref === "function") timer.unref();
  logger.info({ tickMs: TICK_MS }, "[payment-matching-cron] started");
}
