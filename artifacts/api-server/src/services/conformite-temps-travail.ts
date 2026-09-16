/**
 * Les bornes que le Code du travail pose autour d'une journee — et qu'aucune
 * ligne de ce produit ne connaissait.
 *
 * CE QUI ETAIT MESURE LE 16/09
 *
 * `checkins` enregistre une arrivee, un depart, des minutes de pause et un
 * total. Ces lignes alimentent la paie et les quatre surfaces d'evaluation
 * corrigees le 15/09 (#154, #159, #160). Le total etait calcule
 * (`depart - arrivee - pause`), et RIEN ne le confrontait a quoi que ce soit :
 *
 *   - repos quotidien de 11 h (L3131-1)       : 0 occurrence dans le depot
 *   - duree maximale quotidienne de 10 h      : 0
 *   - duree maximale hebdomadaire de 48 h     : 0
 *   - moyenne de 44 h sur 12 semaines         : 0
 *   - pause de 20 min au-dela de 6 h (L3121-16) : la colonne existait, aucune
 *     regle ne la lisait
 *
 * Une journee de 13 heures sans pause s'enregistrait donc sans un mot, puis
 * partait en paie et en evaluation de performance. Ce sont exactement les
 * seuils qu'une inspection du travail verifie, et le depassement des durees
 * maximales est une contravention de 4e classe, par salarie concerne.
 *
 * AVERTIR, PAS REFUSER
 *
 * Le module rend des constats, il ne bloque pas l'enregistrement. Un pointage
 * refuse parce qu'il depasse un seuil serait un pointage FAUX : la journee a
 * eu lieu, et la faire disparaitre du registre est plus grave que le
 * depassement lui-meme — c'est precisement ce que le decompte sert a prouver.
 * On enregistre la realite, et on la signale.
 *
 * Les derogations existent (12 h par accord, 60 h sur autorisation), et ce
 * module ne les connait pas : il nomme un ecart au regime de droit commun,
 * a charge pour l'employeur de savoir s'il est couvert.
 */

/** L3131-1 : 11 heures consecutives entre deux journees. */
export const REPOS_QUOTIDIEN_MIN_H = 11;
/** L3121-18 : 10 heures de travail effectif par jour. */
export const DUREE_QUOTIDIENNE_MAX_H = 10;
/** L3121-20 : 48 heures sur une meme semaine. */
export const DUREE_HEBDO_MAX_H = 48;
/** L3121-22 : 44 heures en moyenne sur 12 semaines consecutives. */
export const DUREE_HEBDO_MOYENNE_MAX_H = 44;
/** L3121-16 : 20 minutes des que le travail quotidien atteint 6 heures. */
export const PAUSE_MIN_MINUTES = 20;
export const SEUIL_PAUSE_H = 6;

export type CodeConstat =
  | "duree-quotidienne"
  | "pause-insuffisante"
  | "repos-quotidien"
  | "duree-hebdomadaire"
  | "moyenne-12-semaines";

export interface Constat {
  code: CodeConstat;
  message: string;
  /** Article du Code du travail, pour que le constat soit verifiable. */
  article: string;
}

export interface Journee {
  /** Debut de la periode de travail. */
  debut: Date;
  /** Fin. `null` si le pointage est encore ouvert. */
  fin: Date | null;
  /** Minutes de pause deduites. */
  pauseMinutes: number;
}

function heures(ms: number): number {
  return ms / 3_600_000;
}

/** Arrondi a une decimale, pour des messages lisibles. */
function h1(v: number): string {
  return (Math.round(v * 10) / 10).toString().replace(".", ",");
}

/**
 * Minutes de travail effectif d'une journee : presence moins pauses.
 *
 * Rendue ici plutot que relue depuis `totalMinutes`, pour que le controle ne
 * dependent pas du champ qu'il est justement cense surveiller.
 */
export function minutesTravaillees(j: Journee): number {
  if (!j.fin) return 0;
  const brut = Math.round((j.fin.getTime() - j.debut.getTime()) / 60_000);
  return Math.max(0, brut - Math.max(0, j.pauseMinutes));
}

/** Constats portant sur UNE journee, prise isolement. */
export function verifierJournee(j: Journee): Constat[] {
  const constats: Constat[] = [];
  if (!j.fin) return constats;

  const minutes = minutesTravaillees(j);
  const h = minutes / 60;

  if (h > DUREE_QUOTIDIENNE_MAX_H) {
    constats.push({
      code: "duree-quotidienne",
      article: "L3121-18",
      message:
        `Journee de ${h1(h)} h de travail effectif : la duree maximale quotidienne ` +
        `est de ${DUREE_QUOTIDIENNE_MAX_H} h (12 h seulement par accord ou derogation).`,
    });
  }

  // La pause se declenche des que le travail ATTEINT six heures — pas au-dela.
  if (h >= SEUIL_PAUSE_H && j.pauseMinutes < PAUSE_MIN_MINUTES) {
    constats.push({
      code: "pause-insuffisante",
      article: "L3121-16",
      message:
        `${j.pauseMinutes} min de pause pour ${h1(h)} h de travail : ` +
        `${PAUSE_MIN_MINUTES} min consecutives sont dues des ${SEUIL_PAUSE_H} h.`,
    });
  }

  return constats;
}

/**
 * Constats portant sur l'ENCHAINEMENT de deux journees.
 *
 * Le repos quotidien ne se voit sur aucune ligne prise seule : il est dans
 * l'intervalle entre la fin d'une journee et le debut de la suivante. C'est
 * la raison pour laquelle il faut une fonction distincte, et c'est aussi
 * pourquoi il passait inapercu.
 */
export function verifierEnchainement(precedente: Journee, suivante: Journee): Constat[] {
  if (!precedente.fin) return [];
  const intervalleH = heures(suivante.debut.getTime() - precedente.fin.getTime());
  // Un intervalle negatif signale des pointages qui se chevauchent: ce n'est
  // pas un defaut de repos, et le nommer ainsi enverrait chercher au mauvais
  // endroit.
  if (intervalleH < 0) return [];
  if (intervalleH >= REPOS_QUOTIDIEN_MIN_H) return [];
  return [{
    code: "repos-quotidien",
    article: "L3131-1",
    message:
      `${h1(intervalleH)} h seulement entre la fin d'une journee et le debut de la ` +
      `suivante : le repos quotidien minimal est de ${REPOS_QUOTIDIEN_MIN_H} h.`,
  }];
}

/** Constats portant sur une semaine complete. */
export function verifierSemaine(journees: Journee[]): Constat[] {
  const minutes = journees.reduce((s, j) => s + minutesTravaillees(j), 0);
  const h = minutes / 60;
  if (h <= DUREE_HEBDO_MAX_H) return [];
  return [{
    code: "duree-hebdomadaire",
    article: "L3121-20",
    message:
      `${h1(h)} h sur la semaine : la duree maximale hebdomadaire est de ` +
      `${DUREE_HEBDO_MAX_H} h.`,
  }];
}

/**
 * Moyenne sur douze semaines consecutives.
 *
 * Ce plafond-la est le plus facile a franchir sans s'en apercevoir : aucune
 * semaine n'a besoin d'etre anormale. Douze semaines a 45 h sont toutes
 * legales une a une, et ensemble elles ne le sont pas.
 */
export function verifierMoyenne12Semaines(heuresParSemaine: number[]): Constat[] {
  if (heuresParSemaine.length < 12) return [];
  const constats: Constat[] = [];
  for (let i = 0; i + 12 <= heuresParSemaine.length; i++) {
    const fenetre = heuresParSemaine.slice(i, i + 12);
    const moyenne = fenetre.reduce((a, b) => a + b, 0) / 12;
    if (moyenne > DUREE_HEBDO_MOYENNE_MAX_H) {
      constats.push({
        code: "moyenne-12-semaines",
        article: "L3121-22",
        message:
          `${h1(moyenne)} h en moyenne sur 12 semaines consecutives : le plafond ` +
          `est de ${DUREE_HEBDO_MOYENNE_MAX_H} h.`,
      });
      // Un seul constat suffit: enumerer toutes les fenetres glissantes
      // produirait des dizaines de lignes disant la meme chose.
      break;
    }
  }
  return constats;
}
