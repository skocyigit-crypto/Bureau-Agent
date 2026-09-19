/**
 * Enregistrer un reglement : une seule facon, pour tout le monde.
 *
 * Mesure du 18/09. `facturesClient.paidAmount` n'est PAS une donnee : c'est un
 * CACHE, recalcule depuis la chaine d'encaissements par `rafraichirCache`
 * (routes/encaissements.ts). Or deux routes d'administration l'ecrivaient
 * directement, sans creer la moindre ecriture :
 *
 *  - `/license-management/record-payment` ;
 *  - `/license-management/mark-invoice-paid`.
 *
 * Deux consequences, la seconde etant la plus grave :
 *
 *  1. le journal de caisse — chaine, horodate, verifiable — ignorait ces
 *     reglements. La facture se disait payee, et rien ne disait par quoi.
 *  2. le premier encaissement enregistre ENSUITE sur la meme facture
 *     declenchait `rafraichirCache`, qui recalcule le montant paye a partir
 *     des seules ecritures : le reglement saisi par l'administration
 *     DISPARAISSAIT, et la facture redevenait impayee. Un paiement qui
 *     s'efface tout seul est le pire defaut qu'un logiciel de facturation
 *     puisse avoir, parce qu'il ne previent personne.
 *
 * Ce module porte donc la seule ecriture possible : numero continu, empreinte
 * chainee sur la precedente, refus d'une periode close, refus d'un montant
 * superieur au reste du. Les routes s'en servent au lieu de le reecrire.
 */

import { and, desc, eq } from "drizzle-orm";
import { db, cloturesComptablesTable, encaissementsTable, facturesClientTable } from "@workspace/db";
import { preparerEcriture, soldeFacture, type EcritureChainee } from "./chainage-encaissements";
import { periodeClose } from "./cloture-comptable";

/** Lignes de la base -> ecritures chainees (l horodatage doit ressortir tel qu ecrit). */
function enEcritures(lignes: (typeof encaissementsTable.$inferSelect)[]): EcritureChainee[] {
  return lignes.map((l) => ({
    numero: l.numero,
    organisationId: l.organisationId,
    factureId: l.factureId,
    montantCentimes: l.montantCentimes,
    devise: l.devise,
    moyen: l.moyen,
    dateEncaissement: l.dateEncaissement.toISOString(),
    sens: l.sens as "encaissement" | "annulation",
    annuleNumero: l.annuleNumero,
    empreintePrecedente: l.empreintePrecedente,
    empreinte: l.empreinte,
  }));
}

export const MOYENS_ENCAISSEMENT = ["especes", "virement", "cheque", "carte", "prelevement", "autre"] as const;
export type MoyenEncaissement = (typeof MOYENS_ENCAISSEMENT)[number];

export interface DemandeEncaissement {
  organisationId: number;
  factureId: number;
  montantCentimes: number;
  moyen: MoyenEncaissement;
  /** Date du reglement. Par defaut maintenant ; une periode close la refuse. */
  quand?: Date;
  /** Un trop-percu reel doit etre VOULU : sans cela, on refuse en disant le reste du. */
  forcer?: boolean;
  createdBy?: number | null;
}

export type ResultatEncaissement =
  | { ok: true; numero: number; empreinte: string; payeCentimes: number; soldee: boolean }
  | { ok: false; code: "facture_introuvable" }
  | { ok: false; code: "depasse_reste_a_payer"; resteCentimes: number }
  | { ok: false; code: "periode_close"; periode: string };

export async function enregistrerEncaissement(demande: DemandeEncaissement): Promise<ResultatEncaissement> {
  const { organisationId: orgId, factureId, montantCentimes: centimes, moyen } = demande;
  const quand = demande.quand ?? new Date();

  return db.transaction(async (tx): Promise<ResultatEncaissement> => {
    // La facture doit appartenir a l'organisation: un identifiant fourni par
    // l'appelant n'est jamais fiable.
    const [facture] = await tx
      .select({ id: facturesClientTable.id, devise: facturesClientTable.currency, total: facturesClientTable.totalAmount })
      .from(facturesClientTable)
      .where(and(eq(facturesClientTable.id, factureId), eq(facturesClientTable.organisationId, orgId)));
    if (!facture) return { ok: false, code: "facture_introuvable" };

    // Le reste du se lit dans les ECRITURES, pas dans le cache `paidAmount`:
    // c'est la chaine qui fait foi (annulations comprises).
    const lignesAvant = await tx.select().from(encaissementsTable)
      .where(and(eq(encaissementsTable.organisationId, orgId), eq(encaissementsTable.factureId, facture.id)))
      .orderBy(encaissementsTable.numero);
    const dejaRegle = soldeFacture(enEcritures(lignesAvant), facture.id);
    const totalCentimes = Math.round(Number(facture.total ?? 0) * 100);

    if (!demande.forcer && totalCentimes > 0 && dejaRegle + centimes > totalCentimes) {
      return { ok: false, code: "depasse_reste_a_payer", resteCentimes: Math.max(0, totalCentimes - dejaRegle) };
    }

    // Anti-datation: une ecriture datee dans une periode close est refusee.
    // Sans ce refus, l'anti-fraude serait contournable par le bas.
    const clotures = await tx.select().from(cloturesComptablesTable)
      .where(eq(cloturesComptablesTable.organisationId, orgId));
    const close = periodeClose(
      quand.toISOString(),
      clotures.map((c) => ({
        organisationId: c.organisationId,
        type: c.type as "journaliere" | "mensuelle" | "annuelle",
        periode: c.periode,
        premierNumero: c.premierNumero,
        dernierNumero: c.dernierNumero,
        nbEcritures: c.nbEcritures,
        totalPeriodeCentimes: c.totalPeriodeCentimes,
        totalCumuleCentimes: c.totalCumuleCentimes,
        empreintePrecedente: c.empreintePrecedente,
        empreinte: c.empreinte,
      })),
    );
    if (close) return { ok: false, code: "periode_close", periode: String(close.periode) };

    const [derniere] = await tx.select().from(encaissementsTable)
      .where(eq(encaissementsTable.organisationId, orgId))
      .orderBy(desc(encaissementsTable.numero)).limit(1);

    const ecriture = preparerEcriture({
      organisationId: orgId,
      factureId: facture.id,
      montantCentimes: centimes,
      devise: facture.devise ?? "EUR",
      moyen,
      dateEncaissement: quand.toISOString(),
      sens: "encaissement",
      annuleNumero: null,
    }, derniere ? { numero: derniere.numero, empreinte: derniere.empreinte } : null);

    const [ligne] = await tx.insert(encaissementsTable).values({
      organisationId: ecriture.organisationId,
      numero: ecriture.numero,
      factureId: ecriture.factureId,
      montantCentimes: ecriture.montantCentimes,
      devise: ecriture.devise,
      moyen: ecriture.moyen,
      dateEncaissement: quand,
      sens: ecriture.sens,
      annuleNumero: ecriture.annuleNumero,
      empreintePrecedente: ecriture.empreintePrecedente,
      empreinte: ecriture.empreinte,
      createdBy: demande.createdBy ?? null,
    }).returning({ numero: encaissementsTable.numero });

    // Le cache suit la chaine, jamais l'inverse.
    const lignesApres = await tx.select().from(encaissementsTable)
      .where(and(eq(encaissementsTable.organisationId, orgId), eq(encaissementsTable.factureId, facture.id)))
      .orderBy(encaissementsTable.numero);
    const paye = soldeFacture(enEcritures(lignesApres), facture.id);
    await tx.update(facturesClientTable)
      .set({ paidAmount: (paye / 100).toFixed(2), updatedAt: new Date() })
      .where(and(eq(facturesClientTable.id, facture.id), eq(facturesClientTable.organisationId, orgId)));

    return {
      ok: true,
      numero: ligne.numero,
      empreinte: ecriture.empreinte,
      payeCentimes: paye,
      soldee: totalCentimes > 0 && paye >= totalCentimes,
    };
  });
}
