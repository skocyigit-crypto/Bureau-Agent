/**
 * Qui voit les pointages de qui.
 *
 * MESURE LE 17/09 : toutes les routes de lecture de `routes/checkins.ts`
 * (liste, statistiques, « presents maintenant », fiche, export CSV de 5 000
 * lignes) n'avaient AUCUN controle de role. Un compte `agent` ou `lecture_seule`
 * lisait les heures d'arrivee et de depart, les pauses, le lieu declare, le
 * resultat de la verification de zone et l'adresse IP de TOUS ses collegues —
 * et pouvait modifier ou supprimer leurs pointages, qui ont des consequences de
 * paie. #159/#160 avaient ferme les ecrans d'EVALUATION ; la table brute, elle,
 * restait ouverte.
 *
 * LA REGLE
 *
 *  - administrateur et super_admin : toute l'organisation (gestion du temps de
 *    travail, obligation de l'employeur) ;
 *  - les autres : LEURS pointages uniquement — ceux qu'ils ont saisis, et ceux
 *    crees sans auteur (synchronisation Google) a leur nom exact ;
 *  - l'export de toute l'equipe est reserve aux responsables.
 */

export const ROLES_RESPONSABLES = new Set(["administrateur", "super_admin"]);

export interface SessionPointage { userId?: number; userRole?: string; prenom?: string; nom?: string }

export type Portee = { type: "organisation" } | { type: "personnelle"; userId: number; nomComplet: string | null };

export function porteePointage(session: SessionPointage | undefined): Portee | null {
  if (!session?.userId) return null;
  if (session.userRole && ROLES_RESPONSABLES.has(session.userRole)) return { type: "organisation" };
  const nom = `${session.prenom ?? ""} ${session.nom ?? ""}`.trim().replace(/\s+/g, " ");
  return { type: "personnelle", userId: session.userId, nomComplet: nom ? nom.toLowerCase() : null };
}

/** La ligne appartient-elle a la personne ? (controle applicatif des routes par id) */
export function appartient(ligne: { createdBy: number | null; employeeName: string }, portee: Portee): boolean {
  if (portee.type === "organisation") return true;
  if (ligne.createdBy === portee.userId) return true;
  return ligne.createdBy === null && portee.nomComplet !== null
    && ligne.employeeName.trim().replace(/\s+/g, " ").toLowerCase() === portee.nomComplet;
}
