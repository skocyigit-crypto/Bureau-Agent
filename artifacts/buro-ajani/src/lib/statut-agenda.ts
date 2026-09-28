/**
 * Statut d'un evenement d'agenda tel que l'ecran le connait.
 *
 * Avant le 28/09, la secretaire telephonique inscrivait ses rendez-vous
 * « a_confirmer », statut que l'agenda ignore : le badge affichait le code
 * brut et la fenetre d'edition une liste de statuts vide. Ces rendez-vous
 * attendent bien une confirmation ; on les montre « en attente ». Depuis, la
 * secretaire n'ecrit un rendez-vous qu'apres le « oui » de l'appelant, en
 * « confirme ».
 */
const ANCIENS_STATUTS: Record<string, string> = {
  a_confirmer: "en_attente",
};

export function statutAgenda<T extends string | null | undefined>(status: T): T | string {
  return (typeof status === "string" && ANCIENS_STATUTS[status]) || status;
}
