/**
 * Passer en « retard » les factures de la plateforme restees impayees.
 *
 * Le statut `retard` etait LU en six endroits — tableau de bord de l'editeur,
 * agent SaaS, resume de facturation, relances — mais aucun chemin de code ne
 * l'ECRIVAIT, sauf une modification manuelle du statut. Le montant « en
 * retard » affiche valait donc toujours zero, et les relances ne partaient
 * jamais : un impaye ne ressemblait a rien.
 *
 * L'echeance. Les CGV (article 4) prevoient un paiement « a echoir », a la
 * date anniversaire : la somme est due a l'emission, il n'y a pas de delai
 * contractuel a attendre. On laisse malgre tout passer `DELAI_REGLEMENT_JOURS`
 * — un virement met plusieurs jours a arriver, et traiter comme impaye un
 * client qui a paye la veille serait faux et vexant. Ce delai est une tolerance
 * technique, pas un terme de paiement : il n'ouvre aucun droit et ne change
 * pas la date a partir de laquelle les penalites de l'article L441-10 du Code
 * de commerce courent.
 *
 * Seules les factures EMISES sont concernees: un brouillon n'est du par
 * personne.
 */
import { and, eq, inArray, lt, isNotNull } from "drizzle-orm";
import { db, invoicesTable } from "@workspace/db";

/** Tolerance de transit bancaire, en jours. Voir ci-dessus. */
export const DELAI_REGLEMENT_JOURS = 7;

/** Statuts qui peuvent encore basculer en retard. */
export const STATUTS_ENCORE_DUS = ["en_attente", "partiel"] as const;

/**
 * Bascule les factures echues et renvoie leurs identifiants.
 *
 * Idempotente : une facture deja en `retard` n'est plus dans les statuts
 * eligibles, donc un second passage ne la reprend pas — et une facture soldee
 * entre-temps n'y revient jamais.
 */
export async function basculerFacturesEnRetard(maintenant: Date = new Date()): Promise<number[]> {
  const limite = new Date(maintenant.getTime() - DELAI_REGLEMENT_JOURS * 24 * 60 * 60 * 1000);
  const lignes = await db
    .update(invoicesTable)
    .set({ status: "retard" })
    .where(
      and(
        inArray(invoicesTable.status, [...STATUTS_ENCORE_DUS]),
        // Emise: `issuedAt` est nul tant que la facture est un brouillon.
        isNotNull(invoicesTable.issuedAt),
        lt(invoicesTable.issuedAt, limite),
      ),
    )
    .returning({ id: invoicesTable.id });
  return lignes.map((l) => l.id);
}

/** Vrai quand une facture serait consideree en retard a cette date. */
export function estEnRetard(
  statut: string,
  issuedAt: Date | null,
  maintenant: Date = new Date(),
): boolean {
  if (!(STATUTS_ENCORE_DUS as readonly string[]).includes(statut)) return false;
  if (!issuedAt) return false;
  return issuedAt.getTime() < maintenant.getTime() - DELAI_REGLEMENT_JOURS * 24 * 60 * 60 * 1000;
}
