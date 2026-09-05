/**
 * location-window.ts — quand le suivi de presence a le droit de tourner.
 *
 * Le suivi tournait 24 heures sur 24: la nuit, le week-end, en conges. La
 * CNIL admet la geolocalisation d'un salarie lorsqu'elle est proportionnee au
 * but poursuivi, mais pas comme moyen de le surveiller en dehors de son temps
 * de travail. Savoir sur quel chantier se trouve une equipe a 10 h et savoir
 * ou dort un salarie a 23 h ne relevent pas de la meme finalite — et seule la
 * premiere en est une.
 *
 * Ce module est PUR: il ne connait ni base ni requete HTTP. Une regle qui
 * decide si une personne est surveillee ou non doit pouvoir etre lue,
 * verifiee et testee sans monter une application.
 *
 * Deux proprietes comptent plus que le reste, et les tests les tiennent:
 *   - une configuration illisible FERME la fenetre au lieu de l'ouvrir. Un
 *     champ corrompu ne doit pas produire une surveillance permanente;
 *   - la borne haute est EXCLUE. A 20:00 pile, la journee est finie.
 */

/** Configuration portee par l'organisation. */
export interface FenetreSuivi {
  /** Jours ISO autorises, separes par des virgules: 1 = lundi … 7 = dimanche. */
  jours: string;
  /** Debut inclus, "HH:MM" en 24 h. */
  debut: string;
  /** Fin exclue, "HH:MM" en 24 h. */
  fin: string;
  /** Fuseau IANA de l'organisation. */
  fuseau: string;
}

/** Minutes depuis minuit, ou `null` si le format n'est pas "HH:MM" valide. */
function minutes(heure: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(heure.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Jour ISO (1-7) et minutes depuis minuit, LUS DANS LE FUSEAU DE
 * L'ORGANISATION.
 *
 * Le serveur tourne en UTC. Comparer une heure UTC a « 07:00-20:00 » aurait
 * decale la fenetre de deux heures l'ete: le suivi se serait arrete a 18 h
 * locale et aurait repris a 5 h du matin. `Intl` fait la conversion sans
 * dependance ni table de fuseaux a maintenir.
 */
function localiser(instant: Date, fuseau: string): { jourIso: number; minutes: number } | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: fuseau,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parties = Object.fromEntries(
      fmt.formatToParts(instant).map((p) => [p.type, p.value]),
    );
    const JOURS: Record<string, number> = {
      Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
    };
    const jourIso = JOURS[parties.weekday as string];
    const h = Number(parties.hour);
    const min = Number(parties.minute);
    if (!jourIso || !Number.isFinite(h) || !Number.isFinite(min)) return null;
    // `hour12: false` rend minuit "24" sur certaines plateformes.
    return { jourIso, minutes: (h % 24) * 60 + min };
  } catch {
    // Fuseau inconnu: on ne devine pas. Voir le commentaire de `dansLaFenetre`.
    return null;
  }
}

/**
 * La position peut-elle etre collectee a cet instant ?
 *
 * Renvoie `false` des qu'un doute existe. C'est le sens de la regle: en cas
 * de configuration illisible, la bonne valeur par defaut est de NE PAS
 * surveiller. Ouvrir la fenetre « au cas ou » transformerait une erreur de
 * saisie en surveillance permanente, ce qui est precisement le defaut
 * corrige.
 */
export function dansLaFenetre(instant: Date, config: FenetreSuivi): boolean {
  const debut = minutes(config.debut);
  const fin = minutes(config.fin);
  if (debut === null || fin === null) return false;
  // Une fenetre vide ou inversee n'a pas de sens: on refuse plutot que
  // d'interpreter « 20:00-07:00 » comme une surveillance de nuit.
  if (fin <= debut) return false;

  const jours = config.jours
    .split(",")
    .map((j) => Number(j.trim()))
    .filter((j) => Number.isInteger(j) && j >= 1 && j <= 7);
  if (jours.length === 0) return false;

  const local = localiser(instant, config.fuseau);
  if (!local) return false;

  if (!jours.includes(local.jourIso)) return false;
  // Borne haute exclue: a 20:00 pile, la journee est finie.
  return local.minutes >= debut && local.minutes < fin;
}
