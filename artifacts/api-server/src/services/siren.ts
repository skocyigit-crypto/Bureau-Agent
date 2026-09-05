/**
 * siren.ts — verifier un SIREN ou un SIRET sans appeler personne.
 *
 * A partir de la reforme de la facturation electronique, le SIREN du client
 * n'est plus une donnee administrative parmi d'autres: c'est L'ADRESSE DE
 * ROUTAGE de la facture dans l'annuaire central. Un SIREN absent, mal recopie
 * ou clos, et la facture n'est pas delivree — le destinataire ne la recoit
 * jamais, et l'emetteur l'apprend par le retard de paiement.
 *
 * C'est aussi, d'apres les retours de terrain, l'une des toutes premieres
 * causes de rejet. D'ou ce controle: il ne remplace pas l'annuaire (seul
 * l'annuaire sait si l'entreprise existe encore), mais il arrete la faute de
 * frappe avant l'emission, ce qui est la moitie du probleme et coute une
 * milliseconde.
 *
 * Le decret n° 2022-1299 insere ces mentions au 11° et suivants de l'article
 * 242 nonies A de l'annexe II au CGI. Elles s'appliquent aux factures emises
 * a partir du 1er septembre 2026 pour les grandes entreprises et ETI, et du
 * 1er septembre 2027 pour les PME et micro-entreprises.
 */

/**
 * Les etablissements de La Poste font exception.
 *
 * Leurs SIRET ne satisfont pas Luhn: la somme simple de leurs chiffres doit
 * etre un multiple de 5. L'exception est historique, et un validateur qui
 * l'ignore rejette des numeros parfaitement valides — en refusant d'emettre
 * une facture a un client reel.
 */
const SIREN_LA_POSTE = "356000000";

/** Somme de Luhn (modulo 10), en doublant un chiffre sur deux depuis la droite. */
function luhn(chiffres: string): boolean {
  let somme = 0;
  let double = false;
  for (let i = chiffres.length - 1; i >= 0; i -= 1) {
    let n = chiffres.charCodeAt(i) - 48;
    if (n < 0 || n > 9) return false;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    somme += n;
    double = !double;
  }
  return somme % 10 === 0;
}

/** Retire espaces et points: on saisit « 123 456 789 » aussi souvent que « 123456789 ». */
export function normaliserIdentifiant(v: string): string {
  return v.replace(/[\s.\-]/g, "");
}

export type TypeIdentifiant = "siren" | "siret";

export interface VerdictIdentifiant {
  valide: boolean;
  type: TypeIdentifiant | null;
  /** Valeur normalisee, utilisable telle quelle dans le XML. */
  valeur: string | null;
  /** Ce qui cloche, en clair, quand ce n'est pas valide. */
  motif: string | null;
}

/**
 * Verifie un SIREN (9 chiffres) ou un SIRET (14 chiffres).
 *
 * Renvoie un verdict plutot qu'un booleen: l'appelant doit pouvoir dire au
 * client CE QUI ne va pas. « Numero invalide » n'aide personne a corriger.
 */
export function verifierIdentifiant(brut: string | null | undefined): VerdictIdentifiant {
  if (!brut || brut.trim().length === 0) {
    return { valide: false, type: null, valeur: null, motif: "identifiant absent" };
  }

  const v = normaliserIdentifiant(brut.trim());

  if (!/^\d+$/.test(v)) {
    return { valide: false, type: null, valeur: null, motif: "l'identifiant ne doit contenir que des chiffres" };
  }
  if (v.length !== 9 && v.length !== 14) {
    return {
      valide: false,
      type: null,
      valeur: null,
      motif: `longueur ${v.length}: un SIREN en compte 9, un SIRET 14`,
    };
  }

  const type: TypeIdentifiant = v.length === 9 ? "siren" : "siret";

  // La Poste: somme des chiffres multiple de 5, et non Luhn.
  if (v.startsWith(SIREN_LA_POSTE)) {
    const somme = [...v].reduce((s, c) => s + (c.charCodeAt(0) - 48), 0);
    return somme % 5 === 0
      ? { valide: true, type, valeur: v, motif: null }
      : { valide: false, type, valeur: null, motif: "cle de controle incorrecte (regle propre a La Poste)" };
  }

  return luhn(v)
    ? { valide: true, type, valeur: v, motif: null }
    : { valide: false, type, valeur: null, motif: "cle de controle incorrecte" };
}

/** Le SIREN porte par un identifiant, qu'il soit fourni en SIREN ou en SIRET. */
export function sirenDe(brut: string | null | undefined): string | null {
  const verdict = verifierIdentifiant(brut);
  if (!verdict.valide || !verdict.valeur) return null;
  return verdict.valeur.slice(0, 9);
}

/**
 * Categorie de l'operation facturee — mention obligatoire.
 *
 * Elle n'est pas decorative: elle determine l'exigibilite de la TVA. Une
 * livraison de biens rend la taxe exigible a l'emission; une prestation de
 * services, a l'encaissement — sauf option pour les debits, qui est la
 * quatrieme mention.
 */
export type CategorieOperation = "biens" | "services" | "mixte";

export const LIBELLE_CATEGORIE: Record<CategorieOperation, string> = {
  biens: "Livraison de biens",
  services: "Prestation de services",
  mixte: "Livraison de biens et prestation de services",
};

/**
 * Libelle de l'option pour les debits.
 *
 * Le texte reglementaire fixe un libelle UNIQUE, inscrit dans le Code general
 * des impots. Il se recopie a l'identique: le reformuler, meme mieux, c'est ne
 * plus porter la mention exigee.
 */
export const MENTION_TVA_DEBITS = "Option pour le paiement de la taxe d'apres les debits";
