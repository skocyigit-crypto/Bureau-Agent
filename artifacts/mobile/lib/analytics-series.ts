/**
 * Transformer les reponses d'analyse en series de graphique — sans planter,
 * et sans inventer.
 *
 * CE QUI ETAIT MESURE LE 17/09
 *
 * L'ecran d'analyse mobile appelait l'API directement, avec ses propres types
 * ecrits a la main, sans passer par le client genere. Rien ne l'obligeait donc
 * a suivre la forme reelle des reponses — et il ne la suivait pas :
 *
 *   HORAIRE — l'API rend  { hours: [{ hour: 9, total, answered, missed }] }
 *             l'ecran lisait { hours: [{ hour: "09:00", calls }] }
 *             et appelait `h.hour.replace(":00", "h")` sur un NOMBRE.
 *
 *     Mesure : `TypeError: h.hour.replace is not a function`. Le calcul est
 *     fait pendant le rendu : l'ecran d'analyse s'effondrait des que la
 *     requete horaire reussissait — c'est-a-dire chez tout client ayant des
 *     appels.
 *
 *   HEBDO    — l'ecran lisait `weekly.days`, `weekly.currentWeek`,
 *             `weekly.previousWeek`. Aucun point d'API ne rend ces champs.
 *             Le graphique retombait alors sur sept barres a ZERO (L M M J V
 *             S D), affichees comme la mesure d'une semaine sans activite —
 *             pour une entreprise qui avait peut-etre recu deux cents appels.
 *
 * LA REGLE
 *
 * Une donnee absente rend `null`, et l'ecran le dit. Une serie de zeros n'est
 * pas « pas de donnees » : c'est une affirmation.
 */

export interface PointSerie {
  label: string;
  value: number;
}

/** Une heure telle que l'API la rend. */
interface HeureApi {
  hour?: unknown;
  total?: unknown;
  calls?: unknown;
}

function nombre(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Libelle d'une heure. Accepte le nombre que l'API rend, et la chaine
 * « 09:00 » que l'ecran attendait : un changement de forme cote serveur ne
 * doit plus pouvoir faire tomber l'ecran.
 */
export function libelleHeure(hour: unknown): string | null {
  if (typeof hour === "number" && Number.isInteger(hour) && hour >= 0 && hour <= 23) {
    return `${hour}h`;
  }
  if (typeof hour === "string") {
    const m = hour.match(/^(\d{1,2})(?::\d{2})?$/);
    if (m) {
      const h = Number(m[1]);
      if (h >= 0 && h <= 23) return `${h}h`;
    }
  }
  return null;
}

/**
 * Serie horaire, ou `null` si la reponse ne contient rien d'exploitable.
 *
 * Les heures illisibles sont ignorees une a une plutot que de faire echouer
 * toute la serie.
 */
export function serieHoraire(reponse: unknown): PointSerie[] | null {
  const hours = (reponse as { hours?: unknown } | null)?.hours;
  if (!Array.isArray(hours)) return null;

  const points: PointSerie[] = [];
  for (const brut of hours as HeureApi[]) {
    const label = libelleHeure(brut?.hour);
    // `total` est le nom reel du champ; `calls` est garde pour compatibilite.
    const value = nombre(brut?.total) ?? nombre(brut?.calls);
    if (label === null || value === null) continue;
    points.push({ label, value });
  }
  return points.length > 0 ? points : null;
}

/**
 * Serie hebdomadaire par jour, ou `null`.
 *
 * Aucun point d'API ne fournit aujourd'hui de detail par jour. Plutot que de
 * fabriquer sept zeros, on rend `null` et l'ecran n'affiche pas de graphique.
 */
export function serieHebdomadaire(
  reponse: unknown,
  mesure: "calls" | "tasks",
): PointSerie[] | null {
  const days = (reponse as { days?: unknown } | null)?.days;
  if (!Array.isArray(days)) return null;

  const points: PointSerie[] = [];
  for (const d of days as Array<Record<string, unknown>>) {
    const label = typeof d?.label === "string" ? d.label.slice(0, 3) : null;
    const value = nombre(d?.[mesure]);
    if (label === null || value === null) continue;
    points.push({ label, value });
  }
  return points.length > 0 ? points : null;
}
