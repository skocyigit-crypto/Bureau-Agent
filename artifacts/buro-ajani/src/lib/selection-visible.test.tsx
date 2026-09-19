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
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { useSelectionVisible, useSelectionVisibleListe } from "./selection-visible";

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

describe("la variante pour les selections rangees dans un tableau", () => {
  /** Trois ecrans (documents, prospects, pointages) n'utilisent pas de `Set`. */
  function monterListe(visiblesInitiales: number[] | undefined, selectionInitiale: number[]) {
    let selection = selectionInitiale;
    const rendu = renderHook(
      ({ visibles }: { visibles: number[] | undefined }) =>
        useSelectionVisibleListe(visibles, selection, (s) => { selection = s; }),
      { initialProps: { visibles: visiblesInitiales } },
    );
    return {
      get selection() { return [...selection].sort((a, b) => a - b); },
      changerPage(visibles: number[] | undefined) { rendu.rerender({ visibles }); },
    };
  }

  it("changer de page vide la selection d'avant", () => {
    const e = monterListe([1, 2, 3], [1, 2, 3]);
    e.changerPage([4, 5, 6]);
    expect(e.selection).toEqual([]);
  });

  it("un filtre ne garde que ce qui reste affiche", () => {
    const e = monterListe([1, 2, 3], [1, 2, 3]);
    e.changerPage([2]);
    expect(e.selection).toEqual([2]);
  });

  it("un rendu identique ne touche a rien", () => {
    const e = monterListe([1, 2], [1]);
    e.changerPage([1, 2]);
    expect(e.selection).toEqual([1]);
  });

  it("un chargement en cours non plus", () => {
    const e = monterListe([1, 2], [1]);
    e.changerPage(undefined);
    expect(e.selection).toEqual([1]);
  });
});

describe("aucune liste a selection multiple n'echappe a la regle", () => {
  /**
   * Corriger les ecrans un par un laisse toujours le suivant. Ce controle
   * cherche le MOTIF — une selection multiple plus une action groupee — et
   * exige le garde-fou partout ou il apparait, y compris sur un ecran ecrit
   * demain.
   *
   * `file-approbation.tsx` est celui qui a echappe au premier passage, et
   * c'etait le pire des trois : sa file se rafraichit toute seule toutes les
   * 60 secondes et elle a deux onglets, si bien que la liste change sous les
   * yeux de celui qui coche. Le fichier ecrit lui-meme sa regle d'or —
   * « l'humain doit avoir vu ce qu'il valide » — et la selection conservee la
   * contredisait.
   */
  const ecransConcernes = (): string[] => {
    const pages = join(import.meta.dirname, "..", "pages");
    const parcourir = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) => {
        const p = join(d, e.name);
        if (e.isDirectory()) return parcourir(p);
        return p.endsWith(".tsx") && !p.includes(".test.") ? [p] : [];
      });
    return parcourir(pages).filter((p) => {
      const s = readFileSync(p, "utf8");
      // Une selection MULTIPLE: un `Set` ou un tableau. `useState<X | null>`
      // est un choix unique (un fournisseur d'IA, par exemple) et ne compte
      // pas — le compter ferait crier au loup, et un controle qui crie au
      // loup finit desactive.
      if (!/const \[selected\w*\s*,\s*setSelected\w*\]\s*=\s*useState<(?:Set<|\w+\[\])/.test(s)) return false;
      // Et une action GROUPEE: c'est elle qui rend la selection dangereuse.
      return /bulk|Promise\.all\(/.test(s);
    });
  };

  it("le releve trouve bien des ecrans a controler", () => {
    // Sans ce garde-fou, un motif devenu introuvable ferait passer
    // l'assertion suivante sans rien garantir.
    expect(ecransConcernes().length, "plus aucun ecran detecte: la detection est cassee").toBeGreaterThan(5);
  });

  it("chacun ramene sa selection a ce qui est affiche", () => {
    const sansGardeFou = ecransConcernes()
      .filter((p) => !/useSelectionVisible(Liste)?\s*\(/.test(readFileSync(p, "utf8")))
      .map((p) => p.split(/[\\/]/).slice(-1)[0]);
    expect(
      sansGardeFou,
      `selection multiple + action groupee sans useSelectionVisible: ${sansGardeFou.join(", ")}`,
    ).toEqual([]);
  });
});
