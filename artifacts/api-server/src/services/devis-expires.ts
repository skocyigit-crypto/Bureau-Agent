/**
 * Passer en « expire » les devis dont la date de validite est depassee.
 *
 * Le statut `expire` fait partie des statuts reconnus d'un devis
 * (routes/devis.ts) et la colonne `valid_until` porte la date de validite
 * — mais aucun chemin de code ne rapprochait les deux. Un devis restait
 * « envoye » indefiniment.
 *
 * Ce qui en decoulait, au-dela de l'affichage :
 *  - un devis de l'an dernier restait convertible en facture, a son ancien
 *    prix. La duree de validite est precisement ce qui protege l'entreprise
 *    contre la hausse du cout des materiaux ;
 *  - les relances et le taux d'acceptation comptaient comme « en attente » des
 *    devis qui n'engageaient plus personne.
 *
 * Un devis sans date de validite n'expire pas : c'est une absence de terme, pas
 * un terme depasse. Et seuls les devis ENVOYES sont concernes — un brouillon
 * n'a jamais ete propose, un devis accepte ou refuse a deja son issue.
 */
import { and, eq, lt, isNotNull } from "drizzle-orm";
import { db, devisTable } from "@workspace/db";

/** Vrai quand ce devis n'engage plus, a cette date. */
export function devisExpire(
  statut: string,
  validUntil: Date | null,
  maintenant: Date = new Date(),
): boolean {
  if (statut !== "envoye") return false;
  if (!validUntil) return false;
  return validUntil.getTime() < maintenant.getTime();
}

/**
 * Bascule les devis echus et renvoie leurs identifiants.
 *
 * Idempotente: `expire` ne fait pas partie des statuts eligibles, donc un
 * second passage ne reprend rien.
 */
export async function basculerDevisExpires(maintenant: Date = new Date()): Promise<number[]> {
  const lignes = await db
    .update(devisTable)
    .set({ status: "expire" })
    .where(
      and(
        eq(devisTable.status, "envoye"),
        isNotNull(devisTable.validUntil),
        lt(devisTable.validUntil, maintenant),
      ),
    )
    .returning({ id: devisTable.id });
  return lignes.map((l) => l.id);
}
