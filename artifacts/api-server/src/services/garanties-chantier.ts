/**
 * Ce que la reception des travaux declenche.
 *
 * CE QUI MANQUAIT — MESURE DU 16/09
 *
 * Le module « Projets » est un suivi de projet generique : titre, statut,
 * priorite, budget, avancement, jalons, equipe. Recherche dans tout le depot :
 *
 *   carte BTP                       0 occurrence
 *   permis de construire            0
 *   registre du personnel           0
 *   PPSPS / coordonnateur SPS       0
 *   reception des travaux           1 — dans la fixture d'un test d'extraction PDF
 *   garantie decennale              1 — la meme ligne de la meme fixture
 *
 * Autrement dit, le vocabulaire juridique du chantier n'existait dans ce
 * produit que sous forme de chaine de caracteres dans un jeu d'essai.
 *
 * POURQUOI LA RECEPTION, ET PAS LE RESTE
 *
 * Parmi tout ce qui manque, la reception est la seule date dont DEPENDENT
 * d'autres obligations deja presentes dans le produit. Elle fait partir :
 *
 *   - la garantie de parfait achevement : 1 an, couvre les reserves ;
 *   - la garantie de bon fonctionnement : 2 ans, equipements dissociables ;
 *   - la garantie decennale             : 10 ans, solidite et destination ;
 *   - la restitution de la retenue de garantie : 12 mois en marche prive.
 *
 * Sans elle, aucune de ces echeances n'est calculable — et l'assurance
 * decennale, dont ce meme lot rend la mention obligatoire sur les devis et
 * les factures, court sur une periode que le produit ne sait pas situer.
 *
 * DEUX PIEGES QUE CE MODULE EVITE
 *
 * 1. Une reception AVEC RESERVES est une reception. Elle fait partir la
 *    decennale comme une reception sans reserve. La confondre avec un refus
 *    de reception est l'erreur classique, et elle decale de plusieurs mois
 *    une periode de dix ans.
 *
 * 2. La levee des reserves ne deplace AUCUNE garantie. Elle solde le parfait
 *    achevement sur les points reserves; le point de depart reste la
 *    reception.
 */

/** Duree de restitution de la retenue de garantie en marche prive. */
export const RETENUE_GARANTIE_MOIS = 12;

export type CodeGarantie =
  | "parfait-achevement"
  | "bon-fonctionnement"
  | "decennale"
  | "retenue-garantie";

export interface Echeance {
  code: CodeGarantie;
  libelle: string;
  /** Article ou texte fondateur, pour que l'echeance soit verifiable. */
  reference: string;
  /** Date a laquelle la garantie ou le delai prend fin. */
  fin: Date;
  /** Jours restants a la date d'evaluation. Negatif si la periode est close. */
  joursRestants: number;
  expiree: boolean;
}

/**
 * Ajoute un nombre d'ANNEES a une date, en gardant le jour calendaire.
 *
 * `setFullYear` gere le 29 fevrier en basculant au 1er mars, ce qui est le
 * comportement voulu : une reception du 29 fevrier 2024 fait expirer la
 * decennale le 1er mars 2034, et non un 29 fevrier qui n'existe pas.
 */
function plusAnnees(d: Date, annees: number): Date {
  const r = new Date(d.getTime());
  r.setFullYear(r.getFullYear() + annees);
  return r;
}

function plusMois(d: Date, mois: number): Date {
  const r = new Date(d.getTime());
  r.setMonth(r.getMonth() + mois);
  return r;
}

function joursEntre(a: Date, b: Date): number {
  return Math.ceil((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * Echeances ouvertes par une reception.
 *
 * Rend un tableau vide si la date est absente ou illisible : un chantier non
 * receptionne n'a pas d'echeance, et inventer une date de depart ferait courir
 * dix ans depuis un instant arbitraire.
 */
export function echeancesDepuisReception(
  receptionDate: Date | string | null | undefined,
  maintenant: Date = new Date(),
): Echeance[] {
  if (receptionDate === null || receptionDate === undefined || receptionDate === "") return [];
  const depart = receptionDate instanceof Date ? receptionDate : new Date(receptionDate);
  if (Number.isNaN(depart.getTime())) return [];

  const brut: Array<{ code: CodeGarantie; libelle: string; reference: string; fin: Date }> = [
    {
      code: "parfait-achevement",
      libelle: "Garantie de parfait achevement",
      reference: "C. civ. art. 1792-6",
      fin: plusAnnees(depart, 1),
    },
    {
      code: "bon-fonctionnement",
      libelle: "Garantie de bon fonctionnement (biennale)",
      reference: "C. civ. art. 1792-3",
      fin: plusAnnees(depart, 2),
    },
    {
      code: "decennale",
      libelle: "Garantie decennale",
      reference: "C. civ. art. 1792 et 1792-4-1",
      fin: plusAnnees(depart, 10),
    },
    {
      code: "retenue-garantie",
      libelle: "Restitution de la retenue de garantie",
      reference: "Loi n° 71-584 du 16 juillet 1971",
      fin: plusMois(depart, RETENUE_GARANTIE_MOIS),
    },
  ];

  return brut.map((e) => {
    const joursRestants = joursEntre(maintenant, e.fin);
    return { ...e, joursRestants, expiree: joursRestants < 0 };
  });
}

export interface EtatReception {
  receptionnee: boolean;
  avecReserves: boolean;
  /** Reserves encore ouvertes: prononcees et non levees. */
  reservesOuvertes: boolean;
  echeances: Echeance[];
  /** Ce que l'exploitant doit savoir maintenant. */
  avertissements: string[];
}

export function etatReception(
  projet: {
    receptionDate?: Date | string | null;
    receptionWithReserves?: boolean | null;
    reservesLiftedAt?: Date | string | null;
    actualEndDate?: Date | string | null;
  },
  maintenant: Date = new Date(),
): EtatReception {
  const echeances = echeancesDepuisReception(projet.receptionDate, maintenant);
  const receptionnee = echeances.length > 0;
  const avecReserves = !!projet.receptionWithReserves;
  const levee = projet.reservesLiftedAt ? new Date(projet.reservesLiftedAt) : null;
  const reservesOuvertes =
    avecReserves && (!levee || Number.isNaN(levee.getTime()));

  const avertissements: string[] = [];

  if (!receptionnee) {
    // Le cas qui compte: des travaux termines mais jamais receptionnes. La
    // decennale ne court pas, et l'assurance peut ne pas couvrir — c'est
    // exactement la situation qu'un artisan decouvre au moment du sinistre.
    if (projet.actualEndDate) {
      avertissements.push(
        "Les travaux sont termines mais la reception n'est pas enregistree. " +
          "Tant qu'elle n'est pas prononcee, aucune garantie legale ne court et " +
          "la retenue de garantie n'est pas exigible.",
      );
    }
    return { receptionnee: false, avecReserves, reservesOuvertes, echeances, avertissements };
  }

  if (reservesOuvertes) {
    const pa = echeances.find((e) => e.code === "parfait-achevement");
    avertissements.push(
      "Des reserves ont ete prononcees et ne sont pas levees. Elles relevent de " +
        "la garantie de parfait achevement" +
        (pa && !pa.expiree ? `, qui expire dans ${pa.joursRestants} jours.` : ", desormais expiree."),
    );
  }

  const retenue = echeances.find((e) => e.code === "retenue-garantie");
  if (retenue && !retenue.expiree && retenue.joursRestants <= 60) {
    avertissements.push(
      `La retenue de garantie devient exigible dans ${retenue.joursRestants} jours.`,
    );
  }

  return { receptionnee: true, avecReserves, reservesOuvertes, echeances, avertissements };
}
