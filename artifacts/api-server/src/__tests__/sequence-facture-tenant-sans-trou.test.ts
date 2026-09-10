/**
 * La sequence de facturation D'UN LOCATAIRE ne doit pas laisser de trou, meme
 * quand l'ecriture de la facture echoue apres l'attribution du numero.
 *
 * Pourquoi ce fichier existe a cote de `sequence-facture-sans-trou.test.ts`.
 * Celui-la demontre la propriete pour la sequence de l'EDITEUR
 * (`nextPlatformInvoiceNumber` / `platform_invoice_sequences`), qui prend bien
 * un `tx`. La sequence des CLIENTS — `nextInvoiceNumber` /
 * `invoice_sequences`, celle qui numerote les factures que chaque entreprise
 * emet a ses propres clients — n'avait aucun test de cette nature, alors que
 * c'est elle que l'article 242 nonies A de l'annexe II au CGI regarde chez le
 * client lors d'un controle.
 *
 * Ses trois appelants (`routes/factures-client.ts`, `routes/devis.ts`,
 * `routes/ai-analysis.ts`) prenaient le numero HORS transaction: le compteur
 * avancait, l'insertion pouvait tomber ensuite, et le numero etait consomme
 * sans qu'aucune facture ne le porte. Un trou ne se comble pas apres coup.
 *
 * Le test ne touche qu'`invoice_sequences` et l'organisation jetable qui la
 * porte: la propriete est celle du compteur, et la reduire a son strict
 * necessaire la rend verifiable meme quand le reste du schema evolue.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, organisationsTable } from "@workspace/db";

import { nextInvoiceNumber } from "../services/invoice-numbering";

/** Annees de test, hors de toute annee civile plausible. */
const ANNEE_ROLLBACK = 2192;
const ANNEE_SUITE = 2193;

const stamp = Date.now();
let org = 0;

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Org sequence sans trou ${stamp}`,
    slug: `sequence-sans-trou-${stamp}`,
    maxUsers: 5,
    actif: true,
  }).returning({ id: organisationsTable.id });
  org = o!.id;
});

afterAll(async () => {
  // La suppression de l'organisation emporte ses lignes d'`invoice_sequences`
  // (cle etrangere `on delete cascade`).
  if (org) await db.delete(organisationsTable).where(eq(organisationsTable.id, org));
});

function numero(reference: string): number {
  return Number(reference.split("-")[2]);
}

describe("continuite de la sequence de facturation d'un locataire", () => {
  it("rend le numero quand la transaction echoue", async () => {
    const avant = await db.transaction(async (tx) =>
      nextInvoiceNumber(tx, org, { year: ANNEE_ROLLBACK }),
    );

    // Exactement le cas reel: le numero est pris, puis l'insertion de la
    // facture tombe (contrainte violee, reseau, instance arretee).
    await expect(
      db.transaction(async (tx) => {
        await nextInvoiceNumber(tx, org, { year: ANNEE_ROLLBACK });
        throw new Error("echec simule apres attribution du numero");
      }),
    ).rejects.toThrow("echec simule");

    const apres = await db.transaction(async (tx) =>
      nextInvoiceNumber(tx, org, { year: ANNEE_ROLLBACK }),
    );

    expect(
      numero(apres),
      "le numero attribue dans une transaction annulee n'a pas ete rendu: " +
      "la sequence porte un trou, ce que l'article 242 nonies A interdit",
    ).toBe(numero(avant) + 1);
  });

  it("avance d'un en un sur des emissions successives", async () => {
    const numeros: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const ref = await db.transaction(async (tx) =>
        nextInvoiceNumber(tx, org, { year: ANNEE_SUITE }),
      );
      numeros.push(numero(ref));
    }
    for (let i = 1; i < numeros.length; i += 1) {
      expect(numeros[i], `saut entre ${numeros[i - 1]} et ${numeros[i]}`).toBe(
        numeros[i - 1] + 1,
      );
    }
  });

  it("tient sous des emissions concurrentes", async () => {
    const refs = await Promise.all(
      Array.from({ length: 10 }, () =>
        db.transaction(async (tx) => nextInvoiceNumber(tx, org, { year: ANNEE_SUITE })),
      ),
    );
    const obtenus = refs.map(numero).sort((a, b) => a - b);
    expect(new Set(obtenus).size, "deux factures ont recu le meme numero").toBe(10);
    for (let i = 1; i < obtenus.length; i += 1) {
      expect(obtenus[i], "trou dans la sequence sous concurrence").toBe(obtenus[i - 1] + 1);
    }
  });
});
