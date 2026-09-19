/**
 * Numerotation des factures: une sequence chronologique continue, par
 * organisation et par annee.
 *
 * Pourquoi. L'article 242 nonies A de l'annexe II au CGI impose un numero
 * « base sur une sequence chronologique continue, sans rupture ». Le produit
 * generait `FAC-M4K2J1-A9F03B` (horodatage base 36 + 3 octets aleatoires):
 * unique, mais ce n'est pas une sequence. Une entreprise qui emet ses factures
 * avec ce logiciel ne pouvait pas justifier sa numerotation lors d'un controle
 * — le risque etait chez chaque client, pas seulement chez l'editeur.
 *
 * Comment. Le compteur est lu et incremente dans UNE transaction, avec un
 * verrou de ligne (`FOR UPDATE`). Un `SELECT max(numero)+1` donnerait deux fois
 * le meme numero quand deux instances Cloud Run (maxScale=3) emettent au meme
 * instant; le verrou serialise les deux demandes.
 */
import { sql } from "drizzle-orm";

/** Largeur du compteur: `FAC-2026-000001`. */
const WIDTH = 6;

export interface InvoiceNumberOptions {
  /** Prefixe metier (`FAC` pour une facture). */
  prefix?: string;
  /** Annee de rattachement; par defaut l'annee civile courante. */
  year?: number;
}

/**
 * Attribue le prochain numero de l'organisation et le renvoie.
 *
 * A appeler DANS la transaction qui insere la facture: si l'insertion echoue,
 * le compteur revient en arriere avec elle, et la sequence reste sans trou.
 */
export async function nextInvoiceNumber(
  tx: { execute: (q: unknown) => Promise<unknown> },
  organisationId: number,
  options: InvoiceNumberOptions = {},
): Promise<string> {
  const prefix = options.prefix ?? "FAC";
  const year = options.year ?? new Date().getFullYear();

  // `ON CONFLICT ... DO UPDATE` sert ici de « creer ou incrementer » atomique:
  // la ligne est verrouillee par l'ecriture elle-meme, sans lecture prealable,
  // donc sans fenetre entre le SELECT et le UPDATE.
  const result = await tx.execute(sql`
    INSERT INTO invoice_sequences (organisation_id, year, last_number, updated_at)
    VALUES (${organisationId}, ${year}, 1, now())
    ON CONFLICT (organisation_id, year)
    DO UPDATE SET last_number = invoice_sequences.last_number + 1, updated_at = now()
    RETURNING last_number
  `);

  const rows = Array.isArray(result)
    ? (result as { last_number: number }[])
    : ((result as { rows?: { last_number: number }[] })?.rows ?? []);
  const value = rows[0]?.last_number;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    // Ne pas retomber sur un numero aleatoire: ce serait revenir au defaut
    // qu'on corrige, en silence. Mieux vaut refuser d'emettre.
    throw new Error("Numerotation de facture indisponible: compteur illisible.");
  }

  return `${prefix}-${year}-${String(value).padStart(WIDTH, "0")}`;
}

/**
 * Vrai quand la facture n'est plus un brouillon: son contenu est alors fige.
 *
 * Une facture emise ne se corrige pas en la reecrivant — elle s'annule ou se
 * corrige par un avoir. Laisser modifier le montant d'une facture deja payee
 * (ce que faisait `PATCH /factures-client/:id`) casse la piste d'audit exigee
 * par l'article 286-I-3° bis du CGI.
 */
export function isIssued(status: string | null | undefined): boolean {
  return (status ?? "brouillon") !== "brouillon";
}

/** Champs qu'une facture emise ne peut plus voir changer. */
export const FROZEN_FIELDS = [
  "reference",
  "items",
  "subtotal",
  "taxAmount",
  "totalAmount",
  "currency",
  "isAutoliquidation",
  "dueDate",
  "clientName",
  "clientCompany",
  "clientAddress",
  // Mentions obligatoires (decret n° 2022-1299): elles font partie du CONTENU
  // de la facture, pas de son suivi. Les corriger apres emission reecrirait
  // une facture deja transmise — c'est une facture nouvelle qu'il faut alors
  // emettre, apres annulation.
  "clientSiren",
  "deliveryAddress",
  "operationCategory",
  "vatOnDebits",
] as const;

/**
 * Renvoie les champs geles qu'une requete MODIFIE reellement, ou un tableau
 * vide. Le message d'erreur nomme les champs: « facture verrouillee » sans
 * dire lequel oblige a deviner.
 *
 * Le controle portait sur la PRESENCE du champ, pas sur sa modification. Or
 * les ecrans envoient le formulaire complet : changer le seul statut d'une
 * facture emise renvoyait donc 409, et la remediation proposee par le serveur
 * — « annulez la facture » — etait elle-meme impossible, puisqu'elle passe par
 * le meme PATCH. Aucune facture emise ne pouvait plus etre ni annulee ni
 * changee de statut depuis le produit.
 *
 * Une valeur identique n'est pas une reecriture : la comparaison se fait donc
 * avec l'etat actuel. Comparaison en CHAINE parce que les deux cotes n'ont pas
 * le meme type — `numeric` revient en chaine, le corps JSON porte des nombres,
 * et « 120 » vaut « 120.00 » pour cette question. Les valeurs structurees
 * (lignes de facture) sont comparees sur leur forme JSON.
 */
export function frozenFieldsTouched(
  body: Record<string, unknown>,
  actuel: Record<string, unknown> = {},
): string[] {
  return FROZEN_FIELDS.filter((f) => {
    if (body[f] === undefined) return false;
    if (!(f in actuel)) return true;
    return !memeValeur(body[f], actuel[f]);
  });
}

function memeValeur(propose: unknown, actuel: unknown): boolean {
  if (propose === actuel) return true;
  if (propose == null || actuel == null) return propose == actuel;

  // Une date arrive en `Date` depuis la base et en chaine depuis le corps
  // JSON. Les deux cotes sont donc ramenes a un instant AVANT comparaison —
  // les comparer sous leur forme rendue faisait echouer l'egalite sur les
  // guillemets que JSON ajoute a une chaine.
  const instantPropose = enInstant(propose);
  const instantActuel = enInstant(actuel);
  if (instantPropose !== null && instantActuel !== null) {
    return instantPropose === instantActuel;
  }

  if (typeof propose === "object" || typeof actuel === "object") {
    return JSON.stringify(propose) === JSON.stringify(actuel);
  }
  const a = String(propose).trim();
  const b = String(actuel).trim();
  if (a === b) return true;
  // « 120 » et « 120.00 » designent le meme montant.
  const na = Number(a);
  const nb = Number(b);
  return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
}

/**
 * L'instant que designe une valeur, ou `null` si ce n'en est pas une.
 *
 * Volontairement etroit: un nombre nu n'est PAS traite comme un horodatage,
 * sinon un montant et une date se compareraient sur la meme echelle.
 */
function enInstant(v: unknown): number | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}
