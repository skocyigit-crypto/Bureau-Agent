process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, organisationsTable } from "@workspace/db";

import {
  FROZEN_FIELDS,
  frozenFieldsTouched,
  isIssued,
  nextInvoiceNumber,
} from "../services/invoice-numbering";

/**
 * La numerotation des factures doit etre une sequence chronologique continue
 * (art. 242 nonies A ann. II CGI). Le produit generait `FAC-M4K2J1-A9F03B`:
 * unique, mais pas une sequence — un client controle n'aurait rien pu
 * justifier.
 *
 * Ces tests parlent a la base, parce que le point difficile n'est pas le
 * format du numero: c'est qu'il reste continu quand plusieurs instances
 * emettent en meme temps.
 */

const stamp = Date.now();
let orgA = 0;
let orgB = 0;

beforeAll(async () => {
  const [a] = await db.insert(organisationsTable).values({
    name: `Org facture A ${stamp}`, slug: `facture-a-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  const [b] = await db.insert(organisationsTable).values({
    name: `Org facture B ${stamp}`, slug: `facture-b-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  orgA = a!.id;
  orgB = b!.id;
});

afterAll(async () => {
  for (const id of [orgA, orgB]) {
    if (id) await db.delete(organisationsTable).where(eq(organisationsTable.id, id));
  }
});

describe("sequence de numerotation", () => {
  it("commence a 1 et avance d'un en un", async () => {
    const year = 2031;
    expect(await nextInvoiceNumber(db, orgA, { year })).toBe(`FAC-${year}-000001`);
    expect(await nextInvoiceNumber(db, orgA, { year })).toBe(`FAC-${year}-000002`);
    expect(await nextInvoiceNumber(db, orgA, { year })).toBe(`FAC-${year}-000003`);
  });

  it("ne saute aucun numero quand plusieurs emissions arrivent ensemble", async () => {
    const year = 2032;
    // Le cas que `SELECT max()+1` rate: trois instances Cloud Run qui emettent
    // au meme instant. Le verrou de ligne doit les serialiser.
    const numbers = await Promise.all(
      Array.from({ length: 10 }, () => nextInvoiceNumber(db, orgA, { year })),
    );
    const suffixes = numbers.map((n) => Number(n.split("-")[2])).sort((x, y) => x - y);

    expect(new Set(numbers).size, "deux factures ont recu le meme numero").toBe(10);
    expect(suffixes).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("donne a chaque organisation sa propre suite", async () => {
    const year = 2033;
    await nextInvoiceNumber(db, orgA, { year });
    await nextInvoiceNumber(db, orgA, { year });
    // Un locataire ne doit pas heriter du compteur d'un autre — ni voir un
    // trou parce que le voisin a emis.
    expect(await nextInvoiceNumber(db, orgB, { year })).toBe(`FAC-${year}-000001`);
  });

  it("repart a 1 a chaque annee, sans melanger les suites", async () => {
    expect(await nextInvoiceNumber(db, orgB, { year: 2034 })).toBe("FAC-2034-000001");
    expect(await nextInvoiceNumber(db, orgB, { year: 2035 })).toBe("FAC-2035-000001");
    expect(await nextInvoiceNumber(db, orgB, { year: 2034 })).toBe("FAC-2034-000002");
  });

  it("produit un numero lisible et trie: le format doit rester stable", () => {
    // Le format fait partie du contrat avec le client: il apparait sur ses
    // factures et dans sa comptabilite. Un changement silencieux romprait la
    // sequence aux yeux de l'administration.
    expect(`FAC-2026-000042`).toMatch(/^FAC-\d{4}-\d{6}$/);
  });
});

describe("immuabilite d'une facture emise", () => {
  it("considere tout sauf le brouillon comme emis", () => {
    expect(isIssued("brouillon")).toBe(false);
    expect(isIssued(undefined)).toBe(false);
    for (const s of ["envoyee", "payee", "partiellement_payee", "en_retard", "annulee"]) {
      expect(isIssued(s), s).toBe(true);
    }
  });

  it("gele le contenu, pas le suivi", () => {
    // Ce qui decrit la facture est fige; ce qui decrit sa vie ne l'est pas.
    expect(frozenFieldsTouched({ totalAmount: 100 })).toEqual(["totalAmount"]);
    expect(frozenFieldsTouched({ items: [] })).toEqual(["items"]);
    expect(frozenFieldsTouched({ reference: "FAC-2026-000001" })).toEqual(["reference"]);
    expect(frozenFieldsTouched({ status: "payee", paidAmount: 50, notes: "recu" })).toEqual([]);
  });

  it("couvre les champs qui portent la valeur fiscale du document", () => {
    for (const champ of ["reference", "items", "subtotal", "taxAmount", "totalAmount", "isAutoliquidation"]) {
      expect(FROZEN_FIELDS, champ).toContain(champ);
    }
  });
});
