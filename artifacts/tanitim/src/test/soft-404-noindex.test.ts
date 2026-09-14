// @vitest-environment jsdom
/**
 * La page d'erreur ne doit pas se laisser indexer — et elle seule.
 *
 * Ce site est une application monopage: le serveur rend `index.html` pour
 * TOUTE adresse. Verifie en production:
 *
 *     GET /cette-page-nexiste-absolument-pas-12345  ->  200
 *
 * Pour un moteur de recherche c'est un « soft 404 »: il indexe une page
 * d'erreur comme un contenu. Sur un site vitrine dont le referencement est
 * l'unique fonction, l'index se remplit d'adresses qui n'existent pas — et
 * n'importe quel lien casse pointant vers le domaine en fabrique une nouvelle.
 *
 * Le code HTTP ne peut pas etre corrige cote client; `noindex` si.
 *
 * Le second test compte plus que le premier. Sur une application monopage, le
 * `<head>` SURVIT a la navigation: une balise `noindex` laissee derriere soi
 * apres un passage par la page d'erreur desindexerait ensuite les vraies
 * pages. Corriger un defaut de referencement en en creant un pire serait sans
 * excuse — et personne ne s'en apercevrait avant la chute du trafic.
 */
import { afterEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";

import { useDocumentMeta } from "@/hooks/use-document-meta";
import { PAGE_META } from "@/lib/page-meta";

function baliseRobots(): string | null {
  return document.head
    .querySelector('meta[name="robots"]')
    ?.getAttribute("content") ?? null;
}

afterEach(() => {
  document.head.querySelector('meta[name="robots"]')?.remove();
});

describe("la page introuvable", () => {
  it("est declaree non indexable", () => {
    expect(PAGE_META.notFound.noindex).toBe(true);
  });

  it("pose bien la balise robots", () => {
    renderHook(() => useDocumentMeta(PAGE_META.notFound));
    expect(baliseRobots()).toBe("noindex, follow");
  });
});

describe("les vraies pages", () => {
  it("ne portent aucune balise robots", () => {
    renderHook(() => useDocumentMeta(PAGE_META.mentionsLegales));
    expect(baliseRobots()).toBeNull();
  });

  it("retirent la balise laissee par la page d'erreur", () => {
    // Le scenario reel: un visiteur arrive sur une adresse morte, puis clique
    // « Retour a l'accueil ». Sans retrait, l'accueil hérite du `noindex`.
    renderHook(() => useDocumentMeta(PAGE_META.notFound));
    expect(baliseRobots()).toBe("noindex, follow");

    renderHook(() => useDocumentMeta(PAGE_META.home));
    expect(
      baliseRobots(),
      "la page d'accueil reste marquee non indexable apres un passage par la 404",
    ).toBeNull();
  });
});
