/**
 * « Supprimer (10) » pouvait supprimer dix lignes qu'on ne voyait plus.
 *
 * Les listes gardent leurs cases cochees dans un `Set` que rien ne vidait
 * quand la page, le filtre, la recherche ou le tri changeaient :
 *
 *   1. dix contacts coches page 1 ;
 *   2. passage page 2, ou aucune ligne n'est cochee ;
 *   3. le bandeau affiche pourtant « Supprimer (10) » ;
 *   4. clic — et dix lignes invisibles disparaissent.
 *
 * Le compteur CONTREDISAIT l'ecran, et l'action portait sur l'ancien contenu.
 * Ces controles montent le hook pour de vrai : verifier le code source dirait
 * qu'il est appele, pas qu'il fait ce qu'il faut.
 */
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSelectionVisible } from "./selection-visible";

/** Monte le hook et rend la selection telle qu'elle est apres l'effet. */
function monter(visiblesInitiales: number[] | undefined, selectionInitiale: number[]) {
  let selection = new Set(selectionInitiale);
  const rendu = renderHook(
    ({ visibles }: { visibles: number[] | undefined }) =>
      useSelectionVisible(visibles, selection, (s) => { selection = s; }),
    { initialProps: { visibles: visiblesInitiales } },
  );
  return {
    get selection() { return [...selection].sort((a, b) => a - b); },
    changerPage(visibles: number[] | undefined) { rendu.rerender({ visibles }); },
  };
}

describe("changer ce qui est affiche vide ce qui ne l'est plus", () => {
  it("passer a la page suivante deselectionne la page precedente", () => {
    const e = monter([1, 2, 3], [1, 2, 3]);
    e.changerPage([4, 5, 6]);
    expect(e.selection, "« Supprimer (3) » aurait porte sur la page d'avant").toEqual([]);
  });

  it("un filtre qui retire une ligne la retire de la selection", () => {
    const e = monter([1, 2, 3], [1, 2, 3]);
    e.changerPage([1, 3]);
    expect(e.selection).toEqual([1, 3]);
  });

  it("une page de meme taille ne passe pas inapercue", () => {
    // Comparer les tailles seulement laisserait passer exactement ce cas.
    const e = monter([1, 2], [1, 2]);
    e.changerPage([3, 4]);
    expect(e.selection).toEqual([]);
  });

  it("supprimer une ligne selectionnee la retire du compte", () => {
    const e = monter([1, 2, 3], [2]);
    e.changerPage([1, 3]);
    expect(e.selection).toEqual([]);
  });
});

describe("ce qui ne doit PAS effacer la selection", () => {
  it("un rendu identique la laisse intacte", () => {
    const e = monter([1, 2, 3], [1, 2]);
    e.changerPage([1, 2, 3]);
    expect(e.selection, "une selection qui s'efface toute seule est inutilisable").toEqual([1, 2]);
  });

  it("un chargement en cours ne touche a rien", () => {
    // `undefined` = les lignes ne sont pas encore la. Les traiter comme « rien
    // d'affiche » effacerait la selection a chaque rafraichissement.
    const e = monter([1, 2, 3], [1, 2]);
    e.changerPage(undefined);
    expect(e.selection).toEqual([1, 2]);
  });

  it("une selection vide reste vide sans effet de bord", () => {
    const e = monter([1, 2], []);
    e.changerPage([3, 4]);
    expect(e.selection).toEqual([]);
  });

  it("ajouter une ligne sans en retirer garde la selection", () => {
    const e = monter([1, 2], [1]);
    e.changerPage([1, 2, 3]);
    expect(e.selection).toEqual([1]);
  });

  it("l'ordre des lignes ne compte pas comme une disparition", () => {
    // Un tri change l'ordre, pas le contenu: la selection doit tenir.
    const e = monter([1, 2, 3], [1, 3]);
    e.changerPage([3, 2, 1]);
    expect(e.selection).toEqual([1, 3]);
  });
});

describe("le cas complet du defaut", () => {
  it("apres un changement de page, le compteur ne peut plus contredire l'ecran", () => {
    const e = monter([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]);
    expect(e.selection).toHaveLength(5);
    e.changerPage([6, 7, 8, 9, 10]);
    // Le bandeau lit `selectedIds.size`: il affiche donc zero, comme l'ecran.
    expect(e.selection).toHaveLength(0);
  });

  it("revenir en arriere ne ressuscite pas l'ancienne selection", () => {
    const e = monter([1, 2], [1, 2]);
    e.changerPage([3, 4]);
    e.changerPage([1, 2]);
    expect(e.selection).toEqual([]);
  });
});
