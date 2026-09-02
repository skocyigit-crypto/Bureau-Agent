import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgres://user:pass@127.0.0.1:5432/testdb";
});

import { cosineSim } from "../services/knowledge-base";

/**
 * Un vecteur n'est comparable qu'a un vecteur du MEME modele.
 *
 * La colonne `embed_model` etait ecrite a l'indexation et jamais relue. La
 * recherche comparait donc le vecteur de la requete a tous les vecteurs
 * stockes, sans regarder quel modele les avait produits.
 *
 * Ce serait sans consequence si les dimensions coincidaient — elles ne
 * coincident pas (768 pour text-embedding-004, 1536 ailleurs) — et surtout si
 * l'ecart se voyait. Il ne se voit pas: `cosineSim` tronque a la longueur la
 * plus courte et rend un nombre parfaitement plausible. Pas d'erreur, pas de
 * journal, juste des reponses moins bonnes que personne ne relie a la cause.
 *
 * Le risque n'est pas theorique: `KB_EMBED_MODEL` est une variable
 * d'environnement, et le modele utilise appartient a une famille que le
 * fournisseur retire progressivement (un modele Gemini deja retire repond
 * aujourd'hui « no longer available to new users »). Le jour du changement,
 * les anciens chunks gardent leurs vecteurs.
 */

const SERVICE = path.resolve(
  import.meta.dirname, "..", "services", "knowledge-base.ts",
);
const source = fs.readFileSync(SERVICE, "utf8");

describe("comparaison de vecteurs", () => {
  it("ne signale rien quand les dimensions different", () => {
    // Le coeur du probleme: la fonction ne peut PAS servir de garde-fou.
    // Elle rend un score credible pour des vecteurs incomparables, donc le
    // filtrage doit se faire en amont.
    const court = [1, 0, 0];
    const long = [1, 0, 0, 0.9, 0.9, 0.9];

    const score = cosineSim(court, long);

    expect(score).toBeGreaterThan(0.9);
    expect(Number.isNaN(score)).toBe(false);
  });
});

describe("recherche semantique", () => {
  it("lit le modele de chaque vecteur", () => {
    // Ecrire la colonne sans jamais la relire donnait l'illusion d'une
    // precaution qui n'existait pas.
    expect(source, "embed_model n'est pas selectionne").toContain(
      "embedModel: documentChunksTable.embedModel",
    );
  });

  it("n'utilise que les vecteurs du modele courant", () => {
    // Les autres retombent sur le classement lexical, chemin que la fonction
    // gere deja pour les chunks sans vecteur.
    const comparisons = source.match(/r\.embedModel === KB_EMBED_MODEL/g) ?? [];

    expect(
      comparisons.length,
      "le modele doit etre verifie a la fois pour activer le semantique et pour chaque vecteur",
    ).toBeGreaterThanOrEqual(2);
  });

  it("ne prend la branche semantique que s'il existe un vecteur exploitable", () => {
    // Sans cette condition, un lot entierement indexe par un autre modele
    // prendrait la branche semantique pour n'y produire que des zeros, au lieu
    // du classement lexical seul.
    const hasEmbeddings = source.slice(
      source.indexOf("const hasEmbeddings"),
      source.indexOf("const useSemantic"),
    );

    expect(hasEmbeddings).toContain("KB_EMBED_MODEL");
  });
});
