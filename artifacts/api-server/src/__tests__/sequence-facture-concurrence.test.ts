/**
 * La suite des numeros de facture doit rester continue, meme quand deux
 * factures partent en meme temps.
 *
 * L'article 242 nonies A de l'annexe II au CGI impose une sequence continue:
 * un trou ou un doublon n'est pas un detail d'affichage, c'est ce qu'un
 * controle regarde en premier. Et le depot garde la trace d'un defaut passe
 * ou « la sequence perdait des numeros ».
 *
 * Ce defaut-la ne se voit jamais en usage sequentiel. Il apparait quand deux
 * requetes lisent le dernier numero avant que l'une des deux ne l'ait ecrit —
 * la fenetre classique entre un SELECT et un UPDATE. Aucun test unitaire ne
 * l'attrape, parce qu'un test unitaire n'a jamais deux requetes en vol.
 *
 * D'ou ces deux verifications, qui se completent:
 *
 *   - le COMPORTEMENT: plusieurs demandes lancees ensemble contre une vraie base;
 *   - la FORME: l'incrementation tient en une seule instruction atomique.
 *
 * La seconde existe parce que la premiere pourrait passer par chance. Un
 * `SELECT` suivi d'un `UPDATE` ne se trompe pas a tous les coups: il se trompe
 * parfois, ce qui est pire, et une suite de tests verte le laisserait passer
 * jusqu'au jour ou deux clients facturent a la meme seconde.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db, organisationsTable } from "@workspace/db";
import { nextInvoiceNumber } from "../services/invoice-numbering";

let orgId = 0;

afterEach(async () => {
  if (orgId) {
    await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
    orgId = 0;
  }
});

describe("plusieurs factures demandees en meme temps", () => {
  it("donnent autant de numeros distincts et consecutifs", async () => {
    const [org] = await db
      .insert(organisationsTable)
      .values({
        name: "Verification sequence",
        slug: `sequence-${Date.now()}`,
        email: `sequence-${Date.now()}@exemple.test`,
        maxUsers: 3,
        actif: true,
      })
      .returning({ id: organisationsTable.id });
    orgId = org.id;

    /*
     * Huit, et pas vingt: c'est la taille du pool de connexions
     * (`DB_POOL_MAX`, 8 par defaut). Vingt demandes simultanees en reclamaient
     * douze de plus que le pool ne peut en donner, et vitest executant les
     * fichiers dans des processus separes — chacun avec SON pool — la pression
     * se multipliait: en integration continue, les connexions expiraient, et
     * pas seulement pour ce test. Un test qui fait tomber les autres ne
     * mesure plus rien, il ajoute du bruit.
     *
     * Huit suffit a la propriete: ce qui compte est que plusieurs demandes
     * soient reellement EN VOL ensemble, pas leur nombre. Le vingtieme appel
     * n'apportait aucune collision que le huitieme n'exposait deja.
     */
    const COMBIEN = 8;
    const numeros = await Promise.all(
      Array.from({ length: COMBIEN }, () =>
        nextInvoiceNumber(db as never, orgId, { year: 2026 }),
      ),
    );

    // Deux factures portant le meme numero est la faute la plus grave: elle
    // rend la comptabilite indefendable.
    expect(new Set(numeros).size, "deux factures ne peuvent pas porter le meme numero").toBe(COMBIEN);

    // Un trou l'est presque autant: il donne a penser qu'une facture a ete
    // emise puis retiree.
    const rangs = numeros.map((r) => Number(r.split("-").pop())).sort((a, b) => a - b);
    expect(rangs, "la suite doit etre continue, sans trou").toEqual(
      Array.from({ length: COMBIEN }, (_, i) => i + 1),
    );
  });
});

describe("la forme qui rend ce resultat fiable", () => {
  const source = readFileSync(
    join(import.meta.dirname, "..", "services", "invoice-numbering.ts"),
    "utf8",
  );

  it("incremente en une seule instruction, sans lecture prealable", () => {
    // `ON CONFLICT ... DO UPDATE ... RETURNING` verrouille la ligne par
    // l'ecriture elle-meme: il n'existe aucun instant ou deux requetes ont lu
    // la meme valeur sans que l'une ait ecrit.
    expect(source).toMatch(/ON CONFLICT[\s\S]*DO UPDATE[\s\S]*RETURNING/);
  });

  it("ne lit pas le dernier numero avant de l'incrementer", () => {
    // La forme fautive: `SELECT last_number ...` puis `UPDATE`. Entre les deux,
    // une autre requete peut lire la meme valeur.
    const bloc = source.slice(source.indexOf("nextInvoiceNumber"));
    expect(
      /SELECT\s+last_number/i.test(bloc),
      "une lecture separee rouvre la fenetre entre le SELECT et l'UPDATE",
    ).toBe(false);
  });
});
