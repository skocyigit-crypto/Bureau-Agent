/**
 * Un rapport qui ignore doit le dire, pas inventer.
 *
 * CE QUI ETAIT MESURE LE 17/09
 *
 * `GET /dashboard/weekly-report` rendait, pour une semaine SANS AUCUN APPEL :
 *
 *     peakHour: 9            (peakHourResult[0]?.hour ?? 9)
 *     peakDay:  "Lun"        (peakDayResult[0]?.day ?? "Lun")
 *     answerRate: 0          (twc > 0 ? ... : 0)
 *     callsDiff: 0           (pwc === 0 ? 0 : ...)
 *
 * Le tableau de bord affichait donc « pic d'activite : 9h, lundi » pour une
 * semaine ou personne n'a appele, et un taux de reponse de 0 % — le chiffre
 * d'une equipe qui ne decroche jamais — pour une semaine sans donnee.
 *
 * Et l'ecran d'analyse colorait la variation avec `diff > 0 ? vert : rouge` :
 * passer de 0 appel la semaine precedente a 50 cette semaine s'affichait
 * « 0 % », en ROUGE, fleche vers le bas. Une hausse lue comme une baisse.
 *
 * LA REGLE
 *
 * Zero n'est pas « inconnu ». Quand la donnee manque, ces fonctions rendent
 * `null`, et l'interface affiche un tiret. Un rapport qui rassure — ou qui
 * alarme — quand il ignore est pire qu'un rapport qui se tait.
 */

const arrondi1 = (v: number): number => Math.round(v * 10) / 10;

/** Pourcentage `num / den`, ou `null` sans denominateur. */
export function taux(num: number, den: number): number | null {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return null;
  return arrondi1((num / den) * 100);
}

/**
 * Variation relative entre deux periodes, en pourcentage.
 *
 * `null` quand la periode de reference est inconnue ou nulle : une hausse
 * depuis zero n'a pas de pourcentage — de 0 a 50, ce n'est ni +0 % ni +∞ %,
 * c'est « nouveau ».
 */
export function variationPourcent(actuel: number | null, precedent: number | null): number | null {
  if (actuel === null || precedent === null) return null;
  if (!Number.isFinite(actuel) || !Number.isFinite(precedent) || precedent === 0) return null;
  return arrondi1(((actuel - precedent) / precedent) * 100);
}

/** Ecart en points entre deux taux. `null` si l'un des deux est inconnu. */
export function ecartPoints(actuel: number | null, precedent: number | null): number | null {
  if (actuel === null || precedent === null) return null;
  return arrondi1(actuel - precedent);
}

/** Moyenne SQL ramenee en nombre, `null` si aucune ligne n'a ete agregee. */
export function moyenneOuNull(valeur: number | string | null | undefined, lignes: number): number | null {
  if (lignes <= 0 || valeur === null || valeur === undefined) return null;
  const n = Number(valeur);
  return Number.isFinite(n) ? n : null;
}
