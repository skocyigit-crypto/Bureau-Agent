/**
 * Un filtre qui ne peut RIEN rendre est un bouton qui ment.
 *
 * L'ecran « activite recente » offre neuf pastilles de filtre et agrege huit
 * sources. Le 24/09/2026, deux de ces pastilles — « devis » et « facture » —
 * etaient DEFINITIVEMENT vides : l'ecran lisait les reponses sous la clef
 * `.data`, que ni `GET /api/devis` ni `GET /api/factures-client` ne rendent.
 * Les deux categories n'etaient jamais alimentees, donc les deux filtres ne
 * pouvaient jamais afficher une ligne. Aucune erreur, aucun ecran rouge :
 * juste deux boutons qui rendent « rien », pour toujours.
 *
 * Ce fichier ne protege pas la correction de ce jour-la — `activite-recente`
 * a son propre controle cote serveur, qui appelle les vraies routes. Il
 * protege l'INVARIANT qui rend les filtres honnetes : toute pastille
 * correspond a un type que l'ecran produit, et tout type produit a sa
 * pastille.
 *
 * LES DEUX SENS COMPTENT, et ils ne cassent pas de la meme facon :
 *   - une pastille sans producteur ne rend jamais rien — elle ment ;
 *   - un type sans pastille est invisible au filtrage — il se noie dans
 *     « tout », et l'utilisateur ne peut pas l'isoler.
 *
 * (Classe rapportee par la session BTP-ULTRA le 24/09/2026 : chez elle, une
 * case a cocher vivait dans un dialogue qu'un bouton ouvrait sous la
 * condition `invoiceType === "DEVIS"` — dans un ecran dont la liste excluait
 * precisement les devis. Chaine verte, typecheck propre, symboles presents
 * dans le bundle : seul le fait d'essayer d'OUVRIR l'ecran l'a dit.)
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ECRAN = readFileSync(
  join(import.meta.dirname, "..", "..", "app", "activite-recente.tsx"),
  "utf8",
);

/** Les types qu'une ligne d'activite peut reellement porter. */
function typesProduits(): string[] {
  return [...new Set([...ECRAN.matchAll(/type: "([a-z_]+)"/g)].map((m) => m[1]!))];
}

/** Les pastilles de filtre offertes, « all » exclu. */
function pastilles(): string[] {
  const i = ECRAN.indexOf("filterAll");
  if (i < 0) return [];
  const debut = ECRAN.lastIndexOf("[", i);
  const fin = ECRAN.indexOf("];", debut);
  return [...ECRAN.slice(debut, fin).matchAll(/key: "([a-z_]+)"/g)]
    .map((m) => m[1]!)
    .filter((k) => k !== "all");
}

describe("le releve mesure bien quelque chose", () => {
  it("des types sont produits par l'ecran", () => {
    // Un ecran restructure rendrait une liste vide, et deux listes vides se
    // correspondent parfaitement — le controle passerait au vert sans rien
    // mesurer.
    expect(typesProduits().length, "aucun type d'activite lu").toBeGreaterThan(4);
  });

  it("des pastilles sont offertes", () => {
    expect(pastilles().length, "aucune pastille de filtre lue").toBeGreaterThan(4);
  });

  it("et « tout » existe toujours, en plus des autres", () => {
    expect(ECRAN).toMatch(/key: "all"/);
  });
});

describe("chaque pastille peut rendre quelque chose", () => {
  it("aucun filtre ne porte sur un type que l'ecran ne produit jamais", () => {
    const produits = typesProduits();
    const mortes = pastilles().filter((k) => !produits.includes(k));
    expect(mortes, "ces filtres rendraient « rien » pour toujours").toEqual([]);
  });

  it("et aucun type produit n'echappe au filtrage", () => {
    // L'autre sens : un type sans pastille se noie dans « tout » et ne peut
    // pas etre isole.
    const offerts = pastilles();
    const invisibles = typesProduits().filter((t) => !offerts.includes(t));
    expect(invisibles, "ces activites ne peuvent pas etre filtrees").toEqual([]);
  });

  it("les deux categories autrefois vides sont bien alimentees", () => {
    // Nommees parce que ce sont celles qui etaient mortes : le controle
    // general au-dessus les couvre, mais autant que le fichier dise laquelle
    // etait cassee.
    for (const t of ["devis", "facture"]) {
      expect(typesProduits(), `${t} n'est plus produit`).toContain(t);
    }
  });

  it("et le filtrage compare bien le type de la ligne a la pastille", () => {
    // Si la comparaison portait sur autre chose, les deux listes pourraient
    // correspondre sans que le filtre fonctionne.
    expect(ECRAN).toMatch(/activities\.filter\(a => a\.type === typeFilter\)/);
  });
});
