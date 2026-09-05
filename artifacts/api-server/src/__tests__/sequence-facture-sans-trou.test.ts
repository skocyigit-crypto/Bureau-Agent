/**
 * La sequence des factures ne doit pas laisser de trou, meme quand l'emission
 * echoue.
 *
 * L'article 242 nonies A de l'annexe II au CGI impose un numero « base sur une
 * sequence chronologique continue, SANS RUPTURE ». Le point delicat n'est pas
 * d'incrementer un compteur: c'est ce qui se passe quand la suite echoue.
 * Si le numero est attribue puis que l'ecriture de la facture tombe — panne
 * reseau, contrainte violee, instance arretee en plein vol — le numero est
 * consomme et aucune facture ne le porte. La sequence a un trou, et un trou ne
 * se comble pas apres coup.
 *
 * `emettreFacturePlateforme` prend le numero DANS la transaction qui ecrit la
 * facture, precisement pour que l'echec de l'une annule l'autre. Ce fichier
 * verifie cette propriete au niveau ou elle se decide — la transaction — et
 * non par un commentaire.
 *
 * Il ne touche volontairement qu'a `platform_invoice_sequences`: pas
 * d'organisation, pas de facture. La propriete testee est celle du compteur,
 * et la reduire a son strict necessaire la rend verifiable meme quand le reste
 * du schema evolue.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, platformInvoiceSequencesTable } from "@workspace/db";

import { nextPlatformInvoiceNumber } from "../services/platform-invoice-issue";

/** Annees de test, hors de toute annee civile plausible. */
const ANNEE_ROLLBACK = 2190;
const ANNEE_SUITE = 2191;

afterAll(async () => {
  try {
    for (const annee of [ANNEE_ROLLBACK, ANNEE_SUITE]) {
      await db.delete(platformInvoiceSequencesTable)
        .where(eq(platformInvoiceSequencesTable.year, annee));
    }
  } catch {
    // Menage « au mieux »: les annees utilisees n'entrent en collision avec
    // aucune donnee reelle.
  }
});

function numero(reference: string): number {
  return Number(reference.split("-")[2]);
}

describe("continuite de la sequence des factures", () => {
  it("rend le numero quand la transaction echoue", async () => {
    // Un premier numero, valide.
    const avant = await db.transaction(async (tx) =>
      nextPlatformInvoiceNumber(tx, ANNEE_ROLLBACK),
    );

    // Une transaction qui prend un numero puis echoue: exactement le cas ou
    // l'emission tombe apres l'attribution.
    await expect(
      db.transaction(async (tx) => {
        await nextPlatformInvoiceNumber(tx, ANNEE_ROLLBACK);
        throw new Error("echec simule apres attribution du numero");
      }),
    ).rejects.toThrow("echec simule");

    // Le numero suivant doit reprendre juste apres le premier. S'il saute,
    // l'annulation n'a pas rendu le compteur et la sequence a un trou.
    const apres = await db.transaction(async (tx) =>
      nextPlatformInvoiceNumber(tx, ANNEE_ROLLBACK),
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
        nextPlatformInvoiceNumber(tx, ANNEE_SUITE),
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
    // Trois instances Cloud Run peuvent emettre au meme instant. Un
    // `SELECT max()+1` donnerait deux fois le meme numero; l'increment se fait
    // donc sous le verrou de l'ecriture. Dix demandes lancees ensemble doivent
    // rendre dix numeros DISTINCTS et contigus.
    const refs = await Promise.all(
      Array.from({ length: 10 }, () =>
        db.transaction(async (tx) => nextPlatformInvoiceNumber(tx, ANNEE_SUITE)),
      ),
    );
    const obtenus = refs.map(numero).sort((a, b) => a - b);
    expect(new Set(obtenus).size, "deux factures ont recu le meme numero").toBe(10);
    for (let i = 1; i < obtenus.length; i += 1) {
      expect(obtenus[i], "trou dans la sequence sous concurrence").toBe(obtenus[i - 1] + 1);
    }
  });
});
