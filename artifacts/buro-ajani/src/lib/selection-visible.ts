/**
 * Une selection ne porte que sur ce qui est a l'ecran.
 *
 * Les listes gardent leurs cases cochees dans un `Set` qui ne bougeait pas
 * quand la page, le filtre, la recherche ou le tri changeaient. Consequence,
 * mesuree le 19/09 sur les onze ecrans qui proposent une suppression en lot :
 *
 *   1. l'utilisateur coche dix contacts page 1 ;
 *   2. il passe page 2, ou aucune ligne n'est cochee ;
 *   3. le bandeau affiche pourtant « Supprimer (10) » ;
 *   4. il clique — et supprime dix lignes qu'il ne voit pas.
 *
 * Le compteur CONTREDISAIT l'ecran, et l'action portait sur l'ancien contenu.
 * Le meme mecanisme s'applique a un filtre : selectionner « tous » sur
 * « clients », filtrer sur « fournisseurs », supprimer.
 *
 * La regle retenue est volontairement la plus simple qui soit juste : une
 * selection ne survit pas a la disparition de sa ligne. Elle ne demande de
 * connaitre ni la cause du changement ni les dependances propres a chaque
 * ecran — un `useEffect` par ecran, avec sa liste de dependances a tenir a
 * jour, aurait oublie un filtre tot ou tard.
 */
import { useEffect } from "react";

/**
 * Retire de la selection tout ce qui n'est plus affiche.
 *
 * @param visibles identifiants des lignes actuellement a l'ecran, ou
 *   `undefined` pendant un chargement — on ne touche alors a rien, sans quoi
 *   chaque rafraichissement effacerait la selection en cours.
 */
export function useSelectionVisible<T>(
  visibles: readonly T[] | undefined,
  selection: Set<T>,
  setSelection: (s: Set<T>) => void,
): void {
  // Clef stable: recalculer sur la seule identite du tableau relancerait
  // l'effet a chaque rendu, et sur la seule taille laisserait passer un
  // changement de page qui garde le meme nombre de lignes.
  const empreinte = visibles === undefined ? null : visibles.join("|");

  useEffect(() => {
    if (visibles === undefined) return;
    if (selection.size === 0) return;
    const affichees = new Set(visibles);
    const restantes = [...selection].filter((id) => affichees.has(id));
    if (restantes.length === selection.size) return;
    setSelection(new Set(restantes));
    // `selection` est volontairement hors des dependances: la mise a jour
    // qu'on vient de declencher la changerait, et l'effet se rappellerait
    // immediatement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empreinte]);
}

/**
 * Meme regle, pour les ecrans qui gardent leur selection dans un tableau.
 *
 * Trois listes (documents, prospects, pointages) n'utilisent pas un `Set`.
 * Leur donner une variante plutot que les convertir evite de toucher a leur
 * logique de bascule — et le defaut, lui, est exactement le meme.
 */
export function useSelectionVisibleListe<T>(
  visibles: readonly T[] | undefined,
  selection: readonly T[],
  setSelection: (s: T[]) => void,
): void {
  const empreinte = visibles === undefined ? null : visibles.join("|");

  useEffect(() => {
    if (visibles === undefined) return;
    if (selection.length === 0) return;
    const affichees = new Set(visibles);
    const restantes = selection.filter((id) => affichees.has(id));
    if (restantes.length === selection.length) return;
    setSelection(restantes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empreinte]);
}
