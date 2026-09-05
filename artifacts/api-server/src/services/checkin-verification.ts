/**
 * checkin-verification.ts — ce que le serveur peut CONSTATER d'un pointage.
 *
 * Le pointage etait cru sur parole: `location` arrivait du telephone sous forme
 * de chaine libre, et le serveur la recopiait. Un pointage a des consequences
 * de paie; n'importe qui pouvait poster « Chantier Haguenau » depuis chez lui
 * avec un simple appel a l'API.
 *
 * Le constat ne vient donc plus du corps de la requete, mais de l'etat de
 * position que le serveur tient a jour de son cote depuis les releves du mobile
 * (`user_location_state`, alimente par /location/ping). Deux canaux
 * independants: falsifier le pointage ne suffit plus, il faudrait aussi
 * falsifier la position — et celle-la est bornee aux horaires de travail et
 * verifiee contre les zones de l'organisation.
 *
 * Trois verdicts, parce que deux melangeraient des situations differentes. Un
 * releve manquant n'est PAS une fraude: le suivi peut etre desactive,
 * l'application fermee, ou l'on peut etre hors des horaires. Confondre
 * « je ne sais pas » avec « il n'y etait pas », c'est accuser quelqu'un a tort
 * sur une donnee de paie.
 */

export type VerdictPointage = "verifie" | "hors_zone" | "inconnu";

/**
 * Anciennete maximale d'un releve pour qu'il dise encore quelque chose du
 * moment du pointage.
 *
 * Le mobile releve au plus toutes les 60 secondes ou tous les 100 metres. Un
 * quart d'heure laisse passer une application mise en veille par le systeme ou
 * un reseau capricieux sur un chantier, sans aller jusqu'a couvrir un trajet:
 * en quinze minutes on ne revient pas du chantier voisin sans que le suivi ne
 * s'en apercoive.
 */
export const FRAICHEUR_MAX_MS = 15 * 60 * 1000;

export interface EtatPosition {
  /** Zones ou le serveur situait l'utilisateur au dernier releve. */
  currentGeofenceIds: number[] | null;
  /** Horodatage du dernier releve. */
  lastAt: Date | null;
}

export interface ConstatPointage {
  verdict: VerdictPointage;
  /** Zone retenue, quand il y en a une. */
  geofenceId: number | null;
}

/**
 * Confronte un pointage a ce que le serveur savait de la position.
 *
 * `instant` est la date retenue pour le pointage, apres bornage cote appelant:
 * comparer un releve a une heure choisie par le client rouvrirait la porte que
 * cette fonction ferme.
 */
export function constaterPresence(
  instant: Date,
  etat: EtatPosition | null | undefined,
): ConstatPointage {
  if (!etat || !etat.lastAt) return { verdict: "inconnu", geofenceId: null };

  const ecart = Math.abs(instant.getTime() - new Date(etat.lastAt).getTime());
  if (!Number.isFinite(ecart) || ecart > FRAICHEUR_MAX_MS) {
    return { verdict: "inconnu", geofenceId: null };
  }

  const zones = (etat.currentGeofenceIds ?? []).filter(
    (z) => Number.isInteger(z) && z > 0,
  );
  if (zones.length === 0) return { verdict: "hors_zone", geofenceId: null };

  // Plusieurs zones peuvent se chevaucher; la premiere suffit a etablir la
  // presence, et en retenir une seule evite de laisser croire a une precision
  // qu'on n'a pas.
  return { verdict: "verifie", geofenceId: zones[0] };
}

/**
 * Borne l'horodatage fourni par le client.
 *
 * `checkInAt` arrivait du telephone sans controle: un pointage pouvait etre
 * date de n'importe quand, y compris dans le futur. On accepte un decalage
 * vers le PASSE — un mobile hors ligne rattrape ses pointages en arrivant sur
 * le reseau — mais jamais vers le futur, et jamais au-dela d'une journee.
 */
export const RETARD_MAX_MS = 24 * 60 * 60 * 1000;

export function bornerHorodatage(
  demande: Date | null | undefined,
  maintenant: Date = new Date(),
): { instant: Date; retenuDuClient: boolean } {
  if (!demande) return { instant: maintenant, retenuDuClient: false };
  const t = new Date(demande).getTime();
  if (!Number.isFinite(t)) return { instant: maintenant, retenuDuClient: false };

  const ecart = t - maintenant.getTime();
  // Une minute de tolerance vers le futur: les horloges de telephone derivent.
  if (ecart > 60_000) return { instant: maintenant, retenuDuClient: false };
  if (-ecart > RETARD_MAX_MS) return { instant: maintenant, retenuDuClient: false };
  return { instant: new Date(t), retenuDuClient: true };
}
