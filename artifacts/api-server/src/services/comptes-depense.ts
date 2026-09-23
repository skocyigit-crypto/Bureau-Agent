/**
 * comptes-depense.ts — la colonne que le comptable attendait.
 *
 * Le registre des depenses portait la categorie du produit et rien d'autre :
 * le cabinet refaisait le rapprochement vers le plan comptable a la main,
 * ligne par ligne. Ce module tient le lien categorie -> compte, et les regles
 * qui empechent d'y ecrire n'importe quoi.
 *
 * TROIS REGLES, ET UNE SEULE RAISON A CHACUNE.
 *
 * 1. La CLASSE ne se saisit pas : elle est le premier chiffre du numero. Une
 *    charge commence par 6, un compte de tiers par 4. Demander la classe
 *    separement, c'est accepter qu'un 606 soit range en produit — ce qui ne
 *    fausse pas une ligne mais le RESULTAT, dans le sens flatteur, et l'ecart
 *    ne se decouvre qu'a l'arrete des comptes.
 *
 * 2. Rien n'est ecrit sans que le client l'ait voulu. Le plan propose ci-
 *    dessous est une PROPOSITION affichee, pas un reglage applique d'office :
 *    dans le batiment, la sous-traitance se ventile entre 604 et 611 selon la
 *    nature du marche, et c'est l'expert-comptable du client qui tranche.
 *
 * 3. Un numero de compte est une chaine, jamais un nombre : « 604000 » et
 *    « 604 » ne sont pas le meme compte, et 0604 n'existe pas. Un entier
 *    perdrait les zeros de tete au premier aller-retour JSON.
 */
import { EXPENSE_CATEGORIES } from "@workspace/db";

/** Longueur minimale d'un compte general (PCG : au moins trois chiffres). */
const LONGUEUR_MIN = 3;
const LONGUEUR_MAX = 12;

export class ErreurCompte extends Error {
  readonly messagePublic: string;
  constructor(message: string, readonly champ?: string) {
    super(message);
    this.name = "ErreurCompte";
    this.messagePublic = message;
  }
}

/** Un numero de compte, nettoye : chiffres seulement. */
export function normaliserCompte(valeur: unknown): string {
  return String(valeur ?? "").replace(/\s/g, "");
}

/** La classe d'un compte : son premier chiffre. Jamais saisie, toujours deduite. */
export function classeDuCompte(compte: string): number | null {
  const n = normaliserCompte(compte);
  if (!/^\d{3,12}$/.test(n)) return null;
  return Number(n[0]);
}

export function compteValide(compte: string, classeAttendue?: number): boolean {
  const n = normaliserCompte(compte);
  if (!new RegExp(`^\\d{${LONGUEUR_MIN},${LONGUEUR_MAX}}$`).test(n)) return false;
  return classeAttendue === undefined || classeDuCompte(n) === classeAttendue;
}

/**
 * Plan PROPOSE pour une entreprise du batiment (PCG, reglement ANC 2022-06).
 *
 * Il s'affiche a l'ecran et ne s'applique qu'une fois accepte. Les choix
 * discutables sont commentes : c'est la ou le comptable voudra corriger.
 */
export const PLAN_PROPOSE_BTP: ReadonlyArray<readonly [string, string, string | null]> = [
  // [categorie, compte de charge, compte de TVA deductible]
  // Carburant : TVA partiellement deductible selon le vehicule — le compte ne
  // le dit pas, le registre le signale deja par ailleurs.
  ["carburant", "606150", "445660"],
  ["fournitures", "606300", "445660"],
  ["materiel", "605000", "445660"],
  // Sous-traitance : 604 (etudes et prestations) ou 611 (sous-traitance
  // generale) selon la nature du marche. 604 est propose ; beaucoup de
  // cabinets du batiment preferent 611, d'ou un reglage et non une constante.
  ["sous_traitance", "604000", "445660"],
  ["loyer", "613200", "445660"],
  ["assurance", "616000", null], // Assurances : hors champ de la TVA.
  ["telephone_internet", "626000", "445660"],
  ["repas", "625700", "445660"],
  ["deplacement", "625100", "445660"],
  ["entretien_vehicule", "615500", "445660"],
  ["honoraires", "622600", "445660"],
  ["taxes", "635100", null], // Impots et taxes : pas de TVA deductible.
  ["autre", "606800", "445660"],
];

const CATEGORIES = new Set<string>(EXPENSE_CATEGORIES);

export interface LigneCompte {
  categorie: string;
  compteCharge: string;
  compteTva: string | null;
}

/**
 * Valide une ligne avant ecriture. Leve avec le champ fautif : un refus qui ne
 * designe pas son champ oblige l'utilisateur a deviner.
 */
export function validerLigne(brute: Record<string, unknown>): LigneCompte {
  const categorie = String(brute.categorie ?? "").trim();
  if (!CATEGORIES.has(categorie)) {
    throw new ErreurCompte("Categorie de depense inconnue.", "categorie");
  }
  const compteCharge = normaliserCompte(brute.compteCharge);
  if (!compteValide(compteCharge)) {
    throw new ErreurCompte("Le numero de compte doit comporter de 3 a 12 chiffres.", "compteCharge");
  }
  // Une depense est une CHARGE. Un compte de classe 7 rangerait un achat en
  // produit : le resultat gonfle des deux cotes et rien ne le signale.
  if (classeDuCompte(compteCharge) !== 6) {
    throw new ErreurCompte(
      `Une depense se comptabilise en classe 6 (charges) ; ${compteCharge} est en classe ${classeDuCompte(compteCharge)}.`,
      "compteCharge",
    );
  }
  const brutTva = normaliserCompte(brute.compteTva);
  let compteTva: string | null = null;
  if (brutTva) {
    if (!compteValide(brutTva)) {
      throw new ErreurCompte("Le compte de TVA doit comporter de 3 a 12 chiffres.", "compteTva");
    }
    if (classeDuCompte(brutTva) !== 4) {
      throw new ErreurCompte(
        `La TVA deductible se comptabilise en classe 4 (tiers) ; ${brutTva} est en classe ${classeDuCompte(brutTva)}.`,
        "compteTva",
      );
    }
    compteTva = brutTva;
  }
  return { categorie, compteCharge, compteTva };
}
