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
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db, devisTable } from "@workspace/db";
import { FUSEAU_ENTREPRISE, finDeJournee } from "../lib/jour-local";

/**
 * Vrai quand ce devis n'engage plus, a cette date.
 *
 * « Valable jusqu'au 30/09 » vaut jusqu'a la FIN du 30/09. La date arrive de
 * l'interface a minuit UTC — 2 h du matin a Paris : comparee telle quelle, elle
 * faisait expirer le devis le matin meme de son dernier jour, celui ou le
 * client se decide.
 */
export function devisExpire(
  statut: string,
  validUntil: Date | null,
  maintenant: Date = new Date(),
): boolean {
  if (statut !== "envoye") return false;
  if (!validUntil) return false;
  return finDeJournee(validUntil).getTime() < maintenant.getTime();
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
        // La meme regle, dite en SQL : c'est le JOUR de validite qui doit etre
        // passe dans le fuseau de l'entreprise, pas l'instant minuit UTC.
        sql`(${devisTable.validUntil} AT TIME ZONE ${FUSEAU_ENTREPRISE})::date < (${maintenant.toISOString()}::timestamptz AT TIME ZONE ${FUSEAU_ENTREPRISE})::date`,
      ),
    )
    .returning({ id: devisTable.id });
  return lignes.map((l) => l.id);
}
