import type { ExpenseCategory } from "@workspace/db/schema";

/**
 * La TVA facturee n'est pas la TVA recuperable.
 *
 * CE QUI ETAIT MESURE LE 16/09
 *
 * `depenses` stocke `amountHt`, `amountTva`, `amountTtc` et une `category`.
 * Le montant de TVA etait conserve tel quel, et RIEN dans le depot ne
 * distinguait la part effectivement deductible: le mot « deductible » n'y
 * apparaissait qu'une fois, dans l'en-tete d'un fichier de tests.
 *
 * Or le droit a deduction depend du poste de depense, et plusieurs exclusions
 * sont totales. Une PME du BTP qui remonte `amountTva` dans sa CA3 sur-deduit
 * donc mecaniquement sur au moins trois postes courants — carburant de
 * vehicule de tourisme, entretien de ce meme vehicule, hebergement — et une
 * sur-deduction se solde par un rappel assorti d'interets de retard.
 *
 * CE QUE CE MODULE FAIT, ET NE FAIT PAS
 *
 * Il rend une FRACTION et une raison, pas une ecriture comptable. Quand la
 * reponse depend d'une information que le produit ne possede pas — la nature
 * du vehicule, la presence d'alcool sur une note de restaurant, le
 * beneficiaire d'un cadeau — il le dit au lieu de choisir a la place de
 * l'utilisateur. Un module qui trancherait seul produirait une deduction
 * fausse avec l'autorite d'un calcul.
 *
 * Aucune valeur n'est ecrite en base: c'est une lecture, pas une decision.
 */

/** Ce qu'il manque pour conclure, quand la categorie ne suffit pas. */
export type MotifIndetermine = "nature-vehicule" | "poste-de-deplacement" | "alcool" | "seuil-cadeau";

export interface Deductibilite {
  /** Fraction de la TVA facturee qui est recuperable, de 0 a 1. */
  fraction: number;
  /** Montant recuperable, arrondi au centime. */
  montantDeductible: number;
  /** Explication citant la regle, destinee a etre affichee. */
  raison: string;
  /**
   * Vrai quand la fraction retenue est une HYPOTHESE: le produit ne dispose
   * pas de l'information qui trancherait. L'utilisateur doit confirmer.
   */
  aConfirmer: boolean;
  motif: MotifIndetermine | null;
}

/** Vehicule auquel se rattache une depense de carburant ou d'entretien. */
export type NatureVehicule = "tourisme" | "utilitaire" | "inconnu";

function arrondi(v: number): number {
  return Math.round(v * 100) / 100;
}

function resultat(
  tva: number,
  fraction: number,
  raison: string,
  motif: MotifIndetermine | null = null,
): Deductibilite {
  const f = Math.max(0, Math.min(1, fraction));
  return {
    fraction: f,
    montantDeductible: arrondi(Math.max(0, tva) * f),
    raison,
    aConfirmer: motif !== null,
    motif,
  };
}

/**
 * Fraction deductible d'une depense.
 *
 * `natureVehicule` n'a de sens que pour le carburant et l'entretien; partout
 * ailleurs elle est ignoree.
 */
export function deductibiliteTva(
  category: ExpenseCategory | string,
  montantTva: number,
  options: { natureVehicule?: NatureVehicule } = {},
): Deductibilite {
  const tva = Number.isFinite(montantTva) ? Math.max(0, montantTva) : 0;
  const vehicule = options.natureVehicule ?? "inconnu";

  switch (category) {
    case "carburant":
      // Essence et gazole sont alignes depuis 2026: 80 % sur un vehicule de
      // tourisme, 100 % sur un utilitaire. C'est la nature du vehicule, et
      // elle seule, qui decide.
      if (vehicule === "utilitaire") {
        return resultat(tva, 1, "Carburant d'un vehicule utilitaire : TVA deductible en totalite.");
      }
      if (vehicule === "tourisme") {
        return resultat(tva, 0.8, "Carburant d'un vehicule de tourisme : TVA deductible a 80 %.");
      }
      // Hypothese PRUDENTE: on retient 80 %, la fraction du vehicule de
      // tourisme. Retenir 100 % par defaut ferait sur-deduire en silence, ce
      // qui est precisement le risque que ce module existe pour eviter.
      return resultat(
        tva,
        0.8,
        "Carburant : 80 % retenus (vehicule de tourisme). Indiquez s'il s'agit " +
          "d'un utilitaire pour recuperer la totalite.",
        "nature-vehicule",
      );

    case "entretien_vehicule":
      // L'exclusion des vehicules de tourisme est TOTALE et vise l'achat, la
      // location et l'entretien — a la difference du carburant, qui reste
      // deductible a 80 %.
      if (vehicule === "utilitaire") {
        return resultat(tva, 1, "Entretien d'un vehicule utilitaire : TVA deductible en totalite.");
      }
      if (vehicule === "tourisme") {
        return resultat(tva, 0, "Entretien d'un vehicule de tourisme : TVA exclue du droit a deduction.");
      }
      return resultat(
        tva,
        0,
        "Entretien de vehicule : TVA exclue par defaut (vehicule de tourisme). " +
          "Indiquez s'il s'agit d'un utilitaire pour la recuperer.",
        "nature-vehicule",
      );

    case "deplacement":
      // Le poste melange deux regimes opposes: un peage est deductible de
      // droit commun (art. 271 du CGI), un hebergement de dirigeant ou de
      // salarie est exclu meme quand le deplacement est entierement
      // professionnel. Impossible de trancher sans savoir ce que la depense
      // recouvre.
      return resultat(
        tva,
        1,
        "Deplacement : peages et transports sont deductibles, l'hebergement " +
          "des dirigeants et salaries ne l'est pas. Verifiez la nature de la depense.",
        "poste-de-deplacement",
      );

    case "repas":
      // Seul poste de representation integralement deductible — a l'exception
      // des boissons alcoolisees, jamais deductibles.
      return resultat(
        tva,
        1,
        "Restauration : TVA deductible en totalite, sauf sur les boissons alcoolisees.",
        "alcool",
      );

    case "assurance":
      // Les primes d'assurance sont exonerees de TVA: elles supportent la taxe
      // sur les conventions d'assurance, qui n'est pas recuperable. Une TVA
      // saisie sur ce poste est donc une erreur de saisie, pas une deduction.
      return resultat(
        tva,
        0,
        "Assurance : operation exoneree de TVA. Un montant de TVA saisi ici est " +
          "probablement une erreur de saisie.",
      );

    case "taxes":
      return resultat(tva, 0, "Taxes et impots : hors champ de la TVA, rien a deduire.");

    case "fournitures":
    case "materiel":
    case "sous_traitance":
    case "loyer":
    case "telephone_internet":
    case "honoraires":
      return resultat(tva, 1, "TVA deductible en totalite (depense affectee a l'activite).");

    default:
      // « autre » et toute categorie inconnue: on ne devine pas. 100 % est le
      // regime de droit commun, mais la categorie ne permet pas de l'affirmer.
      return resultat(
        tva,
        1,
        "Categorie non precisee : droit commun applique (100 %). Classez la " +
          "depense pour que la regle soit verifiee.",
        "seuil-cadeau",
      );
  }
}

/** Total recuperable sur un ensemble de depenses. */
export function totalDeductible(
  depenses: Array<{ category: string; montantTva: number; natureVehicule?: NatureVehicule }>,
): { total: number; aConfirmer: number } {
  let total = 0;
  let aConfirmer = 0;
  for (const d of depenses) {
    const r = deductibiliteTva(d.category, d.montantTva, { natureVehicule: d.natureVehicule });
    total += r.montantDeductible;
    if (r.aConfirmer) aConfirmer += 1;
  }
  return { total: arrondi(total), aConfirmer };
}
