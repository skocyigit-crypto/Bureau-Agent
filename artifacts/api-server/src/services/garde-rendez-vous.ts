/**
 * Bornes temporelles du lien public de rendez-vous.
 *
 * Mesure le 17/09 : une offre envoyee lundi pour mardi, encore valable jeudi,
 * laissait le client reserver le creneau de mardi (deja passe). Un rendez-vous
 * deja tenu pouvait etre annule ou reprogramme apres coup (l'historique de
 * l'agenda devenait faux), et une reprogrammation sur creneau libre acceptait
 * n'importe quelle date future (an 2090).
 */
export const DELAI_MINIMUM_MIN = 60;
/** Meme horizon que les creneaux libres proposes (getPublicAvailableSlots). */
export const HORIZON_REPROGRAMMATION_JOURS = 60;

export function creneauEncoreReservable(debut: Date, maintenant = new Date()): boolean {
  return debut.getTime() >= maintenant.getTime() + DELAI_MINIMUM_MIN * 60_000;
}

export function dansLHorizon(debut: Date, maintenant = new Date()): boolean {
  return debut.getTime() <= maintenant.getTime() + HORIZON_REPROGRAMMATION_JOURS * 86_400_000;
}

/**
 * Un horaire propose par la secretaire telephonique IA est-il inscriptible ?
 *
 * Mesure le 18/09 : `isSlotFree` ne verifie que le chevauchement et les
 * fermetures. Quand le modele lisait mal l'intention de l'appelant (« mardi »
 * de la semaine passee, une annee erronee), le rendez-vous s'inscrivait dans
 * le passe ou en 2090 : il n'apparaissait jamais dans l'agenda du client, et
 * l'appelant repartait en croyant avoir un creneau. Memes bornes que le lien
 * public de rendez-vous : elles decrivent la meme regle metier.
 */
export function horaireInscriptibleParIa(debut: Date, maintenant = new Date()): boolean {
  return Number.isFinite(debut.getTime()) && creneauEncoreReservable(debut, maintenant) && dansLHorizon(debut, maintenant);
}

/** Un rendez-vous dont l'heure est passee ne se modifie plus depuis le lien. */
export function rendezVousDejaPasse(debut: Date | null | undefined, maintenant = new Date()): boolean {
  return !!debut && debut.getTime() <= maintenant.getTime();
}
