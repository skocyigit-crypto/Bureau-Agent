/**
 * Detecter qu'un rendez-vous en chevauche un autre, AVANT de l'enregistrer.
 *
 * POURQUOI
 *
 * C'est le motif que toutes les revues d'interfaces d'agenda citent en premier
 * — « la conception qui inspire confiance previent a l'instant ou un nouvel
 * evenement en croise un existant » — et l'agenda n'en faisait rien: on
 * pouvait poser deux rendez-vous sur le meme creneau sans un mot.
 *
 * Dans le batiment, ce n'est pas une gene d'affichage. Un conducteur de
 * travaux qui s'engage a deux endroits a 9 h ne s'en apercoit pas en
 * enregistrant: il s'en apercoit sur place, quand le client attend. Le cout
 * est un deplacement perdu et une confiance entamee, pas un doublon dans une
 * liste.
 *
 * CE QUE CE MODULE NE FAIT PAS
 *
 * Il ne REFUSE rien. Un chevauchement est parfois voulu — un devis telephonique
 * pendant un trajet, deux equipes distinctes le meme matin. L'outil signale et
 * laisse decider; un agenda qui interdit se contourne, et on cesse alors de
 * l'utiliser.
 */

/** Le strict minimum pour situer un evenement dans le temps. */
export interface CreneauAgenda {
  id?: number;
  title?: string | null;
  startDate: string | Date;
  endDate?: string | Date | null;
  /** Les evenements « journee entiere » ne se chevauchent pas a l'heure pres. */
  allDay?: boolean | null;
  status?: string | null;
}

export interface Chevauchement {
  /** L'evenement deja en place que le nouveau croise. */
  existant: CreneauAgenda;
  /** Minutes reellement communes aux deux creneaux. */
  minutesCommunes: number;
}

/** Duree par defaut d'un evenement sans fin declaree: une heure. */
const DUREE_PAR_DEFAUT_MS = 60 * 60 * 1000;

/**
 * Les etats qui ne retiennent pas de creneau.
 *
 * Un rendez-vous annule n'occupe plus rien: le signaler ferait crier l'outil
 * sur un agenda parfaitement libre, et quelques faux avertissements suffisent
 * a rendre les vrais invisibles.
 */
const ETATS_SANS_CRENEAU = new Set(["annule", "annulee", "cancelled", "refuse"]);

function bornes(creneau: CreneauAgenda): { debut: number; fin: number } | null {
  const debut = new Date(creneau.startDate).getTime();
  if (!Number.isFinite(debut)) return null;

  const brutFin = creneau.endDate ? new Date(creneau.endDate).getTime() : NaN;
  // Une fin absente, illisible, ou anterieure au debut ne doit pas produire un
  // creneau negatif: on retombe sur une duree par defaut plutot que de rendre
  // la comparaison absurde.
  const fin = Number.isFinite(brutFin) && brutFin > debut ? brutFin : debut + DUREE_PAR_DEFAUT_MS;
  return { debut, fin };
}

function occupeUnCreneau(creneau: CreneauAgenda): boolean {
  if (creneau.allDay) return false;
  const etat = (creneau.status ?? "").toLowerCase();
  return !ETATS_SANS_CRENEAU.has(etat);
}

/**
 * Les evenements existants que `candidat` chevauche, du plus recouvrant au
 * moins recouvrant.
 *
 * Deux creneaux qui se touchent bout a bout (10 h-11 h puis 11 h-12 h) ne se
 * chevauchent pas: la comparaison est stricte. C'est le cas le plus frequent
 * d'une journee bien remplie, et le signaler serait du bruit pur.
 */
export function chevauchements(
  candidat: CreneauAgenda,
  existants: readonly CreneauAgenda[],
): Chevauchement[] {
  if (!occupeUnCreneau(candidat)) return [];
  const bornesCandidat = bornes(candidat);
  if (!bornesCandidat) return [];

  const trouves: Chevauchement[] = [];

  for (const existant of existants) {
    // Modifier un evenement ne doit pas le faire se chevaucher lui-meme.
    if (candidat.id != null && existant.id === candidat.id) continue;
    if (!occupeUnCreneau(existant)) continue;

    const b = bornes(existant);
    if (!b) continue;

    const debutCommun = Math.max(bornesCandidat.debut, b.debut);
    const finCommune = Math.min(bornesCandidat.fin, b.fin);
    if (finCommune <= debutCommun) continue;

    trouves.push({
      existant,
      minutesCommunes: Math.round((finCommune - debutCommun) / 60000),
    });
  }

  return trouves.sort((a, b) => b.minutesCommunes - a.minutesCommunes);
}

/**
 * Une phrase pour l'utilisateur, ou `null` si rien ne se chevauche.
 *
 * Elle NOMME ce qui est en travers et donne l'heure: « ce creneau en croise un
 * autre » n'aiderait personne a decider. C'est ce qui distingue un
 * avertissement d'une alarme.
 */
export function messageChevauchement(trouves: readonly Chevauchement[]): string | null {
  if (trouves.length === 0) return null;

  const premier = trouves[0];
  const heure = new Date(premier.existant.startDate).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const titre = (premier.existant.title ?? "").trim() || "un autre rendez-vous";

  if (trouves.length === 1) {
    return `Ce creneau en croise un autre : « ${titre} » a ${heure}.`;
  }
  return `Ce creneau en croise ${trouves.length} autres, dont « ${titre} » a ${heure}.`;
}
