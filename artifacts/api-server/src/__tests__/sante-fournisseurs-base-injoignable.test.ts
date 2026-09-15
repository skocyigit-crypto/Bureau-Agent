/**
 * Quand la base ne repond pas, la supervision doit se taire — pas rassurer.
 *
 * Ce fichier existe parce qu'un test qui semblait couvrir cette propriete ne
 * la couvrait pas. Dans `sante-fournisseurs-partagee`, le cas « on ne sait
 * rien » etait joue sur une base JOIGNABLE et VIDE: le chemin d'erreur n'etait
 * jamais emprunte. La preuve en a ete faite par mutation — en remplacant le
 * `return []` du bloc `catch` par un etat sain fabrique, les onze tests
 * restaient verts.
 *
 * Or c'est exactement le defaut qui a coute une journee le 1er septembre 2026,
 * puis une matinee le 15: une absence d'information lue comme une bonne
 * nouvelle. Une panne de base ne dit rien de la sante de Gemini; repondre
 * « tout va bien » a ce moment-la est la pire des reponses possibles, parce
 * qu'elle est indiscernable d'une vraie.
 *
 * La regle tenue ici: le chemin d'erreur rend une liste VIDE. L'appelant
 * (`providerHealthPartagee`) retombe alors sur sa memoire locale — degradee,
 * mais honnete.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  process.env.SESSION_SECRET =
    process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgres://user:pass@127.0.0.1:5432/testdb";
});

const base = vi.hoisted(() => ({ lectures: 0 }));

vi.mock("@workspace/db", () => ({
  aiProviderObservationsTable: { provider: "provider" },
  db: {
    select: () => ({
      from: async () => {
        base.lectures += 1;
        throw new Error("ECONNREFUSED 127.0.0.1:5432");
      },
    }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => ({
          catch: () => undefined,
        }),
      }),
    }),
  },
}));

describe("la base de donnees est injoignable", () => {
  it("la lecture partagee rend une liste vide, pas un etat sain", async () => {
    const { lireObservationsPartagees, reinitialiserObservations } = await import(
      "../services/ai-provider-observations"
    );
    reinitialiserObservations();

    const lignes = await lireObservationsPartagees();

    expect(base.lectures, "le chemin d'erreur n'a pas ete emprunte").toBeGreaterThan(0);
    expect(
      lignes,
      "une base muette ne doit jamais devenir « tous les fournisseurs vont bien »",
    ).toEqual([]);
  });

  it("l'echec de lecture ne remonte pas a l'appelant", async () => {
    // La supervision est un confort. Elle ne doit pas casser le chemin qui
    // l'appelle, ni faire echouer un agent de sante entier pour une lecture.
    const { lireObservationsPartagees, reinitialiserObservations } = await import(
      "../services/ai-provider-observations"
    );
    reinitialiserObservations();
    await expect(lireObservationsPartagees()).resolves.toEqual([]);
  });

  it("l'ecriture d'une observation ne jette pas non plus", async () => {
    // Ce relai est traverse a chaque appel d'IA: une exception ici ferait
    // perdre des reponses utilisateur pour un probleme de supervision.
    const { enregistrerObservation, reinitialiserObservations } = await import(
      "../services/ai-provider-observations"
    );
    reinitialiserObservations();
    expect(() => enregistrerObservation("gemini", false, "429", 1)).not.toThrow();
  });

  it("une base muette n'est pas mise en cache comme une reponse valable", async () => {
    // Sinon la premiere panne de base geleerait un etat vide pendant toute la
    // duree du cache, y compris apres le retablissement.
    const { lireObservationsPartagees, reinitialiserObservations } = await import(
      "../services/ai-provider-observations"
    );
    reinitialiserObservations();
    const avant = base.lectures;
    await lireObservationsPartagees();
    await lireObservationsPartagees();
    expect(
      base.lectures - avant,
      "la seconde lecture a ete servie par un cache d'echec",
    ).toBe(2);
  });
});
