/**
 * cloture-comptable.ts — la condition de CONSERVATION, et ce qu'elle attrape.
 *
 * Le 3° bis du I de l'article 286 du CGI exige quatre choses d'un logiciel qui
 * enregistre des reglements. Le chainage des ecritures
 * (`chainage-encaissements.ts`) en couvre deux: inalterabilite et
 * securisation. Il attrape la MODIFICATION d'une ecriture.
 *
 * Il n'attrape PAS la suppression de la fin du journal.
 *
 * Quelqu'un qui retire les trois dernieres ecritures laisse une chaine
 * parfaitement valide: les numeros vont de 1 a n-3 sans trou, chaque empreinte
 * s'accroche a la precedente, et la verification repond « intacte ». La fraude
 * la plus simple — encaisser en especes puis effacer la ligne le soir —
 * passerait sans bruit.
 *
 * C'est ce trou que la conservation ferme. A chaque cloture on fige un TOTAL
 * CUMULE, qui ne se remet jamais a zero. Des annees plus tard, un controleur
 * compare deux nombres: la somme des ecritures presentes, et le cumul fige a
 * la derniere cloture. S'ils different, des ecritures ont disparu — et l'ecart
 * dit exactement combien.
 *
 * Les deux mecanismes sont complementaires et aucun ne remplace l'autre:
 *
 *     chainage   -> une ecriture a ete MODIFIEE
 *     clotures   -> une ecriture a ete SUPPRIMEE
 *
 * Les clotures sont elles-memes chainees entre elles, pour la meme raison
 * qu'on chaine les ecritures: un cumul fige qu'on pourrait reecrire ne fige
 * rien.
 *
 * Module PUR: aucune I/O. Un controleur doit pouvoir refaire chaque calcul.
 */
import { createHash } from "node:crypto";

import type { EcritureChainee } from "./chainage-encaissements";

export type TypeCloture = "journaliere" | "mensuelle" | "annuelle";

export interface Cloture {
  organisationId: number;
  type: TypeCloture;
  /** "2026-09-11" (jour), "2026-09" (mois), "2026" (annee). */
  periode: string;
  /** Premiere et derniere ecriture couvertes. Null si la periode est vide. */
  premierNumero: number | null;
  dernierNumero: number | null;
  nbEcritures: number;
  /** Somme des ecritures de CETTE periode, en centimes. */
  totalPeriodeCentimes: number;
  /**
   * Somme de TOUTES les ecritures depuis l'origine, en centimes.
   *
   * C'est le nombre qui attrape une suppression. Il ne se remet jamais a zero
   * — ni a la fin du mois, ni a la fin de l'exercice. Un « total » qui
   * repartirait de zero chaque annee ne prouverait plus rien sur les annees
   * precedentes.
   */
  totalCumuleCentimes: number;
  /** Empreinte de la cloture precedente, ou la graine. */
  empreintePrecedente: string;
}

export interface ClotureScellee extends Cloture {
  empreinte: string;
}

export function graineCloture(organisationId: number): string {
  return createHash("sha256")
    .update(`ajant-bureau:clotures:v1:org:${organisationId}`)
    .digest("hex");
}

/**
 * Forme canonique d'une cloture. Meme discipline que pour les ecritures:
 * ordre fige, version explicite, champs nuls ecrits comme chaine vide.
 */
export function formeCanoniqueCloture(c: Cloture): string {
  return [
    "v1",
    String(c.organisationId),
    c.type,
    c.periode,
    c.premierNumero === null ? "" : String(c.premierNumero),
    c.dernierNumero === null ? "" : String(c.dernierNumero),
    String(c.nbEcritures),
    String(c.totalPeriodeCentimes),
    String(c.totalCumuleCentimes),
    c.empreintePrecedente,
  ].join("|");
}

export function empreinteCloture(c: Cloture): string {
  return createHash("sha256").update(formeCanoniqueCloture(c), "utf8").digest("hex");
}

/** La periode a laquelle appartient un horodatage ISO, pour un type donne. */
export function periodeDe(dateIso: string, type: TypeCloture): string {
  // On decoupe la chaine ISO plutot que de passer par `Date`: le fuseau local
  // de la machine qui calcule ne doit pas decider a quel jour appartient un
  // encaissement. Deux instances Cloud Run dans deux regions produiraient
  // sinon deux clotures differentes pour les memes ecritures.
  const jour = dateIso.slice(0, 10);
  if (type === "journaliere") return jour;
  if (type === "mensuelle") return jour.slice(0, 7);
  return jour.slice(0, 4);
}

/**
 * Calcule la cloture d'une periode.
 *
 * `toutes` doit contenir TOUTES les ecritures de l'organisation, dans l'ordre:
 * le cumul porte sur l'origine, pas sur la periode. `precedente` est la
 * derniere cloture du meme type, ou null pour la premiere.
 */
export function calculerCloture(
  organisationId: number,
  type: TypeCloture,
  periode: string,
  toutes: EcritureChainee[],
  precedente: ClotureScellee | null,
): ClotureScellee {
  const dedans = toutes.filter((e) => periodeDe(e.dateEncaissement, type) === periode);

  const totalPeriode = dedans.reduce((s, e) => s + e.montantCentimes, 0);
  // Le cumul compte tout ce qui est DANS ou AVANT la periode. Se contenter
  // d'ajouter le total de la periode au cumul precedent donnerait un faux
  // cumul si une ecriture anterieure avait ete saisie apres coup.
  const jusquIci = toutes.filter((e) => periodeDe(e.dateEncaissement, type) <= periode);
  const totalCumule = jusquIci.reduce((s, e) => s + e.montantCentimes, 0);

  const cloture: Cloture = {
    organisationId,
    type,
    periode,
    premierNumero: dedans.length > 0 ? dedans[0].numero : null,
    dernierNumero: dedans.length > 0 ? dedans[dedans.length - 1].numero : null,
    nbEcritures: dedans.length,
    totalPeriodeCentimes: totalPeriode,
    totalCumuleCentimes: totalCumule,
    empreintePrecedente: precedente ? precedente.empreinte : graineCloture(organisationId),
  };

  return { ...cloture, empreinte: empreinteCloture(cloture) };
}

export type MotifIncoherence =
  | "chainon_cloture_rompu"
  | "empreinte_cloture_incorrecte"
  | "cumul_ne_correspond_pas"
  | "cumul_regresse";

export interface VerdictConservation {
  coherent: boolean;
  motif: MotifIncoherence | null;
  /** La periode ou l'incoherence apparait. */
  periode: string | null;
  /** En centimes: ce qui manque (positif) ou ce qui est en trop (negatif). */
  ecartCentimes: number | null;
  explication: string | null;
}

/**
 * Confronte les clotures au journal.
 *
 * C'est ici que se detecte une suppression: le cumul fige a la cloture ne
 * correspond plus a ce que le journal contient aujourd'hui.
 *
 * Les clotures doivent etre du meme type et fournies dans l'ordre des periodes.
 */
export function verifierConservation(
  clotures: ClotureScellee[],
  toutes: EcritureChainee[],
  organisationId: number,
): VerdictConservation {
  let attendue = graineCloture(organisationId);
  let cumulPrecedent: number | null = null;

  for (const c of clotures) {
    if (c.empreintePrecedente !== attendue) {
      return {
        coherent: false,
        motif: "chainon_cloture_rompu",
        periode: c.periode,
        ecartCentimes: null,
        explication:
          `La cloture ${c.periode} ne s'accroche pas a la precedente: une cloture ` +
          `anterieure a ete modifiee ou retiree.`,
      };
    }
    if (empreinteCloture(c) !== c.empreinte) {
      return {
        coherent: false,
        motif: "empreinte_cloture_incorrecte",
        periode: c.periode,
        ecartCentimes: null,
        explication: `Le contenu de la cloture ${c.periode} ne correspond plus a son empreinte.`,
      };
    }

    // Un cumul ne peut que croitre ou rester egal: il additionne des montants
    // dont les annulations sont deja signees. Une baisse signale un cumul
    // reecrit a la main.
    if (cumulPrecedent !== null && c.totalCumuleCentimes < cumulPrecedent) {
      return {
        coherent: false,
        motif: "cumul_regresse",
        periode: c.periode,
        ecartCentimes: c.totalCumuleCentimes - cumulPrecedent,
        explication:
          `Le total cumule diminue a la cloture ${c.periode}: un cumul ne recule jamais.`,
      };
    }

    // Le coeur: on recompte le journal tel qu'il est AUJOURD'HUI, et on le
    // compare au cumul fige a l'epoque.
    const recompte = toutes
      .filter((e) => periodeDe(e.dateEncaissement, c.type) <= c.periode)
      .reduce((s, e) => s + e.montantCentimes, 0);

    if (recompte !== c.totalCumuleCentimes) {
      const ecart = c.totalCumuleCentimes - recompte;
      return {
        coherent: false,
        motif: "cumul_ne_correspond_pas",
        periode: c.periode,
        ecartCentimes: ecart,
        explication:
          ecart > 0
            ? `Il manque ${(ecart / 100).toFixed(2)} € dans le journal par rapport a la cloture ` +
              `${c.periode}: des ecritures ont ete supprimees apres cette cloture.`
            : `Le journal contient ${((-ecart) / 100).toFixed(2)} € de plus que la cloture ` +
              `${c.periode}: des ecritures ont ete ajoutees avec une date anterieure a une ` +
              `periode deja close.`,
      };
    }

    cumulPrecedent = c.totalCumuleCentimes;
    attendue = c.empreinte;
  }

  return { coherent: true, motif: null, periode: null, ecartCentimes: null, explication: null };
}

/**
 * Une periode est-elle deja close ?
 *
 * Sert a refuser un encaissement date dans une periode close. Sans ce refus,
 * l'anti-fraude serait contournable par le bas: il suffirait d'anti-dater une
 * ecriture pour la glisser sous un cumul deja fige — et la verification la
 * signalerait comme un ajout, sans pouvoir dire lequel est le bon.
 */
export function periodeClose(dateIso: string, clotures: ClotureScellee[]): ClotureScellee | null {
  for (const c of clotures) {
    if (periodeDe(dateIso, c.type) <= c.periode) return c;
  }
  return null;
}
