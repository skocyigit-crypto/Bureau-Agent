/**
 * Un devis se facture-t-il ? La reponse au meme endroit pour tous les chemins.
 *
 * La regle vivait dans `POST /devis/:id/convert-to-facture` seulement. Or
 * `POST /factures-client` accepte lui aussi un `devisId` : il verifiait que le
 * devis appartenait bien a l'organisation, rien de plus. On pouvait donc, par
 * ce second chemin :
 *   - facturer un devis REFUSE, EXPIRE ou encore en BROUILLON — la regle qui
 *     reserve l'acceptation a l'administration ne s'appliquait pas ;
 *   - facturer DEUX FOIS le meme devis accepte, avec deux numeros de la
 *     sequence fiscale, puisque `convertedToInvoice` n'etait ni lu ni ecrit.
 *
 * Deux portes pour une seule decision, c'est une porte de trop : la regle est
 * ici, et les deux routes la lisent.
 */
import { avenantsTable, db, devisTable, facturesClientTable, projetsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { devisExpire } from "./devis-expires";

export type Devis = typeof devisTable.$inferSelect;
export type FactureClient = typeof facturesClientTable.$inferSelect;

export type VerdictFacturable =
  | { ok: true; devis: Devis }
  /** Le devis a deja sa facture : on la rend plutot que d'en creer une autre. */
  | { ok: true; devis: Devis; dejaFacture: FactureClient }
  | { ok: false; statut: number; corps: Record<string, unknown> };

/**
 * Le chantier dont ce devis est le prix : son marche initial, ou l un de ses
 * avenants. `null` si le devis n a pas (encore) de chantier.
 *
 * Lu par les deux chemins de facturation. Sans lui, une facture issue d un
 * devis naissait sans chantier, et le dossier du chantier ne pouvait jamais
 * dire ce qui avait ete facture — le montant existait, a un endroit ou
 * personne ne le cherchait.
 */
export async function chantierDuDevis(orgId: number, devisId: number): Promise<number | null> {
  const [initial] = await db.select({ id: projetsTable.id }).from(projetsTable)
    .where(and(eq(projetsTable.devisId, devisId), eq(projetsTable.organisationId, orgId))).limit(1);
  if (initial) return initial.id;
  const [avenant] = await db.select({ projetId: avenantsTable.projetId }).from(avenantsTable)
    .where(and(eq(avenantsTable.devisId, devisId), eq(avenantsTable.organisationId, orgId))).limit(1);
  return avenant?.projetId ?? null;
}

/** Le devis de CETTE organisation, ou null. */
export async function lireDevisDeLOrganisation(orgId: number, devisId: number): Promise<Devis | null> {
  const [d] = await db.select().from(devisTable)
    .where(and(eq(devisTable.id, devisId), eq(devisTable.organisationId, orgId)));
  return d ?? null;
}

/**
 * Le verdict, avec le code et la remediation que l'ecran sait deja traiter.
 * `maintenant` est injectable pour les tests de validite.
 */
export async function devisFacturable(orgId: number, devis: Devis, maintenant: Date = new Date()): Promise<VerdictFacturable> {
  // Une validite depassee protege l'entreprise contre la hausse des couts :
  // convertir un devis de l'an dernier facturerait au prix d'hier.
  if (devisExpire(devis.status, devis.validUntil, maintenant) || devis.status === "expire") {
    return {
      ok: false,
      statut: 409,
      corps: {
        error: "La validite de ce devis est depassee.",
        code: "devis_expire",
        validUntil: devis.validUntil,
        remediation: "Prolongez la date de validite du devis si le prix tient toujours, puis convertissez-le.",
      },
    };
  }
  if (devis.status === "refuse") {
    return {
      ok: false,
      statut: 409,
      corps: { error: "Un devis refuse ne se facture pas.", code: "devis_refuse", remediation: "Etablissez un nouveau devis si le client revient." },
    };
  }
  if (devis.status !== "accepte") {
    return {
      ok: false,
      statut: 409,
      corps: { error: "Seul un devis accepte se facture.", code: "devis_non_accepte", statut: devis.status, remediation: "Faites accepter le devis par un administrateur, puis convertissez-le." },
    };
  }
  if (devis.convertedToInvoice) {
    const [existante] = await db.select().from(facturesClientTable)
      .where(and(eq(facturesClientTable.id, devis.convertedToInvoice), eq(facturesClientTable.organisationId, orgId)));
    // La facture liee a disparu (supprimee) : une nouvelle conversion est
    // permise, comme avant.
    if (existante) return { ok: true, devis, dejaFacture: existante };
  }
  return { ok: true, devis };
}
