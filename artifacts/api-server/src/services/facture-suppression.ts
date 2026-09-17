import { and, count, eq } from "drizzle-orm";
import { db, encaissementsTable, facturesClientTable } from "@workspace/db";

/**
 * Une facture qui a deja recu de l'argent ne se supprime pas.
 *
 * DEUX REGLES QUI NE SE REGARDAIENT PAS
 *
 *   - `DELETE /factures-client/:id` refuse (409) une facture EMISE : elle
 *     porte un numero de sequence, on ne l'efface pas, on l'annule.
 *   - `POST /encaissements` exige une facture de l'organisation : on
 *     n'enregistre pas un reglement dans le vide.
 *
 * La seconde ne verifie pas le STATUT. Un reglement peut donc etre rattache a
 * un BROUILLON, que la premiere autorise a supprimer. La cle etrangere est
 * declaree `onDelete: "set null"` : l'ecriture survit, son `factureId` devient
 * NULL.
 *
 * Ce qui reste est le pire des deux mondes — une ecriture dans le journal
 * inalterable (numero pris, empreinte chainee, impossible a retirer) qui ne se
 * rattache plus a rien. Le lettrage ne peut plus la justifier, et c'est
 * precisement l'ecart qu'un controle fiscal cherche : le reglement est trace,
 * la piece qui le justifie a disparu.
 *
 * Le verrou porte sur le FAIT qu'il existe des encaissements, pas sur le
 * statut : un brouillon paye n'est plus un brouillon, c'est une facture dont
 * l'emission a ete oubliee.
 */
export interface VerdictSuppression {
  /** La facture n'existe pas dans CETTE organisation. */
  introuvable: boolean;
  autorise: boolean;
  nbEncaissements: number;
  raison: string | null;
}

export async function supprimerFactureAutorisee(
  organisationId: number,
  factureId: number,
): Promise<VerdictSuppression> {
  // On lit la facture d'abord. Sans cela, une facture inexistante — ou celle
  // d'un autre locataire — aurait zero encaissement et serait declaree
  // supprimable, ce qui est une reponse sur un objet qu'on n'a pas vu.
  const [facture] = await db
    .select({ id: facturesClientTable.id })
    .from(facturesClientTable)
    .where(and(
      eq(facturesClientTable.id, factureId),
      eq(facturesClientTable.organisationId, organisationId),
    ));

  if (!facture) {
    return { introuvable: true, autorise: false, nbEncaissements: 0, raison: null };
  }

  // Le compte est borne a la facture ET a l'organisation: un compte global
  // bloquerait toutes les factures des le premier reglement enregistre, et
  // ferait fuiter l'activite d'un autre locataire.
  const [ligne] = await db
    .select({ n: count() })
    .from(encaissementsTable)
    .where(and(
      eq(encaissementsTable.organisationId, organisationId),
      eq(encaissementsTable.factureId, factureId),
    ));

  const nbEncaissements = Number(ligne?.n ?? 0);
  if (nbEncaissements > 0) {
    return {
      introuvable: false,
      autorise: false,
      nbEncaissements,
      raison:
        `Cette facture porte ${nbEncaissements} reglement(s) enregistre(s) dans le journal ` +
        "inalterable. Les supprimer est impossible, et effacer la facture les laisserait " +
        "sans piece justificative. Annulez la facture (statut \"annulee\") ou contre-passez " +
        "les reglements.",
    };
  }

  return { introuvable: false, autorise: true, nbEncaissements: 0, raison: null };
}
