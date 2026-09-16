/**
 * Les delais d'une violation de donnees, et ce qu'il faut avoir a dire.
 *
 * CE QUI MANQUAIT
 *
 * Le contrat de sous-traitance signe avec chaque client promet : « l'editeur
 * notifie le client dans les meilleurs delais et au plus tard soixante-douze
 * (72) heures [...] les elements necessaires a sa propre notification a la
 * CNIL. »
 *
 * Cote code : aucune table, aucun delai, aucune liste d'elements. Un
 * engagement contractuel sans mecanisme est une promesse qu'on decouvre
 * intenable le jour ou elle se declenche — et ce jour-la, personne n'a le
 * temps d'improviser.
 *
 * LE PIEGE DES 72 HEURES
 *
 * Le contrat autorise l'editeur a notifier jusqu'a 72 heures. Or le CLIENT
 * dispose lui aussi de 72 heures pour notifier la CNIL, a compter de SA prise
 * de connaissance — c'est-a-dire de notre notification. Le notifier a
 * 71 heures serait contractuellement conforme et pratiquement inutile : il
 * lui resterait le temps de lire le message.
 *
 * La CNIL et le CEPD attendent du sous-traitant une notification sous 24 a
 * 48 heures, precisement pour cette raison. La cible interne est donc fixee a
 * 24 heures, et le maximum contractuel de 72 heures est traite comme ce qu'il
 * est : une limite a ne pas atteindre, pas un objectif.
 *
 * Le module ne modifie pas le contrat — ce n'est pas une decision technique.
 * Il applique la cible plus stricte et signale l'ecart.
 */

/** Cible interne: laisse au client le temps de tenir ses propres 72 heures. */
export const CIBLE_NOTIFICATION_H = 24;
/** Maximum promis par le contrat de sous-traitance. */
export const MAXIMUM_CONTRACTUEL_H = 72;
/** Delai du responsable de traitement envers la CNIL (art. 33.1). */
export const DELAI_CNIL_H = 72;

const H = 3_600_000;

export interface Violation {
  decouverteLe: Date | string;
  nature?: string | null;
  personnesConcernees?: string | null;
  consequences?: string | null;
  mesures?: string | null;
  clientNotifieLe?: Date | string | null;
  motifRetard?: string | null;
}

/** Les quatre elements du 33.3, et leur libelle. */
export const ELEMENTS_REQUIS = [
  { champ: "nature", libelle: "La nature de la violation, et si possible les categories et le nombre approximatif de personnes et d'enregistrements concernes." },
  { champ: "personnesConcernees", libelle: "Les categories et le nombre approximatif de personnes concernees." },
  { champ: "consequences", libelle: "Les consequences probables de la violation." },
  { champ: "mesures", libelle: "Les mesures prises ou proposees pour y remedier et en attenuer les effets." },
] as const;

export interface EtatViolation {
  /** Echeance interne: ce que le module vise. */
  cible: Date;
  /** Echeance contractuelle: ce que le contrat promet au client. */
  limiteContractuelle: Date;
  /** Heures ecoulees depuis la prise de connaissance. */
  heuresEcoulees: number;
  /** Le client a-t-il ete prevenu ? */
  notifie: boolean;
  /** La cible de 24 h est-elle depassee ? */
  cibleDepassee: boolean;
  /** La limite contractuelle est-elle depassee ? */
  limiteDepassee: boolean;
  /** Elements du 33.3 encore absents. */
  elementsManquants: string[];
  /** Ce que l'exploitant doit savoir maintenant. */
  avertissements: string[];
}

function versDate(v: Date | string | null | undefined): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function rempli(v: string | null | undefined): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

export function etatViolation(v: Violation, maintenant: Date = new Date()): EtatViolation {
  const decouverte = versDate(v.decouverteLe);
  if (!decouverte) {
    // Sans prise de connaissance, aucun delai ne court. Inventer une date
    // ferait afficher une echeance fausse — et le retard EST le manquement.
    throw new Error("La date de prise de connaissance est requise pour calculer les delais.");
  }

  const cible = new Date(decouverte.getTime() + CIBLE_NOTIFICATION_H * H);
  const limiteContractuelle = new Date(decouverte.getTime() + MAXIMUM_CONTRACTUEL_H * H);
  const notification = versDate(v.clientNotifieLe);
  const notifie = notification !== null;

  // Une fois le client notifie, le compteur s'arrete a CETTE date: continuer a
  // compter jusqu'a maintenant afficherait un retard qui grandit alors que
  // l'obligation est tenue.
  const reference = notification ?? maintenant;
  const heuresEcoulees = Math.max(0, (reference.getTime() - decouverte.getTime()) / H);

  const elementsManquants = ELEMENTS_REQUIS
    .filter((e) => !rempli(v[e.champ as keyof Violation] as string | null | undefined))
    .map((e) => e.libelle);

  const cibleDepassee = heuresEcoulees > CIBLE_NOTIFICATION_H;
  const limiteDepassee = heuresEcoulees > MAXIMUM_CONTRACTUEL_H;

  const avertissements: string[] = [];

  if (!notifie && limiteDepassee) {
    avertissements.push(
      `Le maximum contractuel de ${MAXIMUM_CONTRACTUEL_H} h est depasse (${Math.floor(heuresEcoulees)} h). ` +
        "Le client n'a pas ete prevenu et ne peut plus tenir ses propres 72 heures envers la CNIL.",
    );
  } else if (!notifie && cibleDepassee) {
    avertissements.push(
      `La cible de ${CIBLE_NOTIFICATION_H} h est depassee. Chaque heure prise ici est retiree ` +
        "des 72 heures dont le client dispose pour notifier la CNIL.",
    );
  }

  if (elementsManquants.length > 0) {
    avertissements.push(
      `${elementsManquants.length} element(s) de l'article 33.3 manquent : une notification incomplete ` +
        "est un manquement distinct du retard.",
    );
  }

  if (cibleDepassee && !rempli(v.motifRetard)) {
    // L'article 33.1 exige les motifs du retard. Les ecrire apres coup n'a pas
    // la meme valeur que les consigner au moment ou le retard se produit.
    avertissements.push(
      "Le motif du retard n'est pas renseigne. L'article 33.1 l'exige des que le delai est depasse.",
    );
  }

  return {
    cible,
    limiteContractuelle,
    heuresEcoulees,
    notifie,
    cibleDepassee,
    limiteDepassee,
    elementsManquants,
    avertissements,
  };
}

/**
 * Echeance du CLIENT envers la CNIL.
 *
 * Elle court a compter de SA prise de connaissance — donc de notre
 * notification, pas de notre decouverte. Rend `null` tant qu'il n'a pas ete
 * prevenu : son delai n'a alors pas commence.
 */
export function echeanceCnilDuClient(v: Violation): Date | null {
  const notification = versDate(v.clientNotifieLe);
  if (!notification) return null;
  return new Date(notification.getTime() + DELAI_CNIL_H * H);
}
