/**
 * Ou tracer le trait « il est maintenant » dans une case d'une heure.
 *
 * La vue JOUR le calculait deja a la minute; la vue SEMAINE le posait a
 * `top-1/2`, c'est-a-dire toujours au milieu de l'heure. A 10 h 05, le trait
 * annoncait 10 h 30.
 *
 * Un repere temporel faux est pire qu'un repere absent: on lit l'agenda EN SE
 * FIANT a lui pour juger « est-ce que j'ai encore le temps ». Trente minutes
 * d'erreur, c'est la difference entre partir maintenant et arriver en retard.
 *
 * Le calcul tenait en une ligne dans une des deux vues et manquait dans
 * l'autre — la duplication est precisement ce qui permet a deux endroits de
 * diverger. Le voici une seule fois, et verifiable.
 */

/**
 * Position verticale, en pourcentage de la hauteur d'une case d'une heure.
 *
 * Bornee a [0, 100]: une valeur hors case sortirait le trait de sa ligne et le
 * ferait chevaucher l'heure voisine.
 */
export function positionDansLHeure(instant: Date = new Date()): number {
  const minutes = instant.getMinutes();
  if (!Number.isFinite(minutes)) return 0;
  const brut = (minutes / 60) * 100;
  return Math.min(100, Math.max(0, brut));
}

/**
 * L'heure vers laquelle ouvrir la grille.
 *
 * Les revues d'agendas sont unanimes: la vue doit s'ouvrir sur l'heure
 * courante — ou sur le debut des heures ouvrees si la journee n'a pas commence
 * — plutot qu'a minuit. Ouvrir sur une plage vide oblige a defiler avant de
 * pouvoir lire quoi que ce soit, chaque fois.
 *
 * `heures` est la plage affichee (ici 7 h a 21 h): on ne propose jamais une
 * heure qui n'y figure pas.
 */
export function heureDOuverture(
  heures: readonly number[],
  instant: Date = new Date(),
): number {
  if (heures.length === 0) return 0;
  const premiere = heures[0];
  const derniere = heures[heures.length - 1];
  const courante = instant.getHours();

  if (courante < premiere) return premiere;
  if (courante > derniere) return derniere;
  return courante;
}
