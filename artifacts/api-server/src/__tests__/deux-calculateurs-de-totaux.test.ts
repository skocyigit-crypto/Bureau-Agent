/**
 * Deux portes creaient des factures client, et ne calculaient pas pareil.
 *
 * `/api/factures-client` passe par `services/invoice-totals.ts`, la source de
 * verite : arrondi au centime, ventilation de la TVA par taux, autoliquidation.
 * `/license-management/create-client-invoice` recalculait tout de son cote :
 *
 *  - aucun `round2`. La colonne `numeric(12,2)` rattrape les totaux a
 *    l'ecriture — c'est ce qui rendait le defaut invisible — mais pas le
 *    `total` de chaque ligne, stocke en JSON, ni le montant porte au journal
 *    d'audit et renvoye a l'appelant ;
 *  - aucune ventilation par taux, alors qu'une facture de BTP mixe couramment
 *    20 %, 10 % et 5,5 % et que la ventilation est obligatoire ;
 *  - l'autoliquidation (art. 283-2 nonies du CGI) purement ignoree : le
 *    sous-traitant facturait une TVA qu'il ne doit pas facturer ;
 *  - le `total` de chaque ligne stocke en TTC, alors que l'autre porte y range
 *    le HT. Les memes factures, dans la meme table, se lisaient de deux facons.
 *
 * La numerotation avait deja ete ramenee sur la sequence commune ; les
 * MONTANTS, eux, divergeaient encore.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, facturesClientTable, organisationsTable, usersTable } from "@workspace/db";
import licenseRouter from "../routes/license-management";

const stamp = Date.now();
let orgId = 0, userId = 0;

function appli() {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organisationId: orgId, userRole: "administrateur" };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", licenseRouter);
  return a;
}

/** Cree une facture par la seconde porte et rend la ligne en base. */
async function creer(corps: Record<string, unknown>) {
  const r = await request(appli()).post("/api/license-management/create-client-invoice").send({
    clientName: "Client", title: "Travaux", ...corps,
  });
  if (r.status !== 201) return { r, ligne: null as any };
  const [ligne] = await db.select().from(facturesClientTable)
    .where(eq(facturesClientTable.id, r.body.facture.id));
  return { r, ligne };
}

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Totaux ${stamp}`, slug: `totaux-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [u] = await db.insert(usersTable).values({
    organisationId: orgId, email: `totaux-${stamp}@example.test`,
    passwordHash: "x", prenom: "T", nom: "O", role: "administrateur", actif: true,
  }).returning({ id: usersTable.id });
  userId = u!.id;
}, 60_000);

afterAll(async () => {
  try { await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId)); } catch { /* journaux */ }
});

describe("les montants ne sont plus arrondis par accident", () => {
  const centimes = [{ description: "Pose", quantity: 3, unitPrice: 33.333, taxRate: 20 }];

  it("le total d'une ligne est arrondi au centime", async () => {
    // La colonne `numeric(12,2)` rattrape les totaux de la facture, ce qui
    // masquait le defaut. Le `total` d'une ligne, lui, est du JSON: il gardait
    // la trainee de flottant telle quelle.
    const { ligne } = await creer({ items: centimes });
    const lignes = ligne.items as Array<{ total: number }>;
    expect(String(lignes[0]!.total), "un total de ligne a quatorze decimales est illisible et infalsifiable")
      .not.toMatch(/\.\d{3,}/);
  });

  it("le montant renvoye a l'appelant est celui qui est enregistre", async () => {
    const { r, ligne } = await creer({ items: centimes });
    expect(Number(r.body.facture.totalAmount)).toBe(Number(ligne.totalAmount));
  });

  it("le TTC retombe sur HT + TVA", async () => {
    const { ligne } = await creer({ items: centimes });
    expect(Number(ligne.totalAmount)).toBe(
      Math.round((Number(ligne.subtotal) + Number(ligne.taxAmount)) * 100) / 100,
    );
  });
});

describe("la TVA est ventilee par taux", () => {
  const melange = [
    { description: "Main d'oeuvre renovation", quantity: 1, unitPrice: 1000, taxRate: 10 },
    { description: "Materiaux", quantity: 1, unitPrice: 1000, taxRate: 20 },
  ];

  it("chaque taux porte sa propre TVA", async () => {
    const { ligne } = await creer({ items: melange });
    expect(Number(ligne.taxAmount), "100 EUR a 10 % + 200 EUR a 20 %").toBe(300);
  });

  it("le sous-total reste le hors taxes", async () => {
    const { ligne } = await creer({ items: melange });
    expect(Number(ligne.subtotal)).toBe(2000);
  });

  it("le total de chaque ligne est le HT, comme dans l'autre porte", async () => {
    // Cette route y rangeait le TTC: la meme table se lisait de deux facons.
    const { ligne } = await creer({ items: melange });
    const lignes = ligne.items as Array<{ total: number; taxRate: number }>;
    expect(lignes[0]!.total, "un total de ligne TTC fausse toute relecture").toBe(1000);
  });
});

describe("l'autoliquidation est respectee", () => {
  it("aucune TVA n'est facturee", async () => {
    // Sous-traitance BTP, art. 283-2 nonies du CGI: le preneur autoliquide.
    const { ligne } = await creer({
      isAutoliquidation: true,
      items: [{ description: "Sous-traitance", quantity: 1, unitPrice: 5000, taxRate: 20 }],
    });
    expect(Number(ligne.taxAmount), "le sous-traitant facturait une TVA qu'il ne doit pas facturer").toBe(0);
  });

  it("le TTC vaut alors le HT", async () => {
    const { ligne } = await creer({
      isAutoliquidation: true,
      items: [{ description: "Sous-traitance", quantity: 1, unitPrice: 5000, taxRate: 20 }],
    });
    expect(Number(ligne.totalAmount)).toBe(5000);
  });

  it("et la facture le dit", async () => {
    const { ligne } = await creer({
      isAutoliquidation: true,
      items: [{ description: "Sous-traitance", quantity: 1, unitPrice: 5000, taxRate: 20 }],
    });
    expect(ligne.isAutoliquidation, "la mention obligatoire depend de ce drapeau").toBe(true);
  });

  it("une facture ordinaire n'est pas marquee autoliquidee", async () => {
    const { ligne } = await creer({ items: [{ description: "Pose", quantity: 1, unitPrice: 100, taxRate: 20 }] });
    expect(ligne.isAutoliquidation).toBe(false);
  });
});

describe("les garde-fous de la source de verite s'appliquent aussi ici", () => {
  it("un montant hors capacite de la colonne est refuse proprement", async () => {
    const { r } = await creer({ items: [{ description: "X", quantity: 1, unitPrice: 9_999_999_999_999, taxRate: 20 }] });
    expect(r.status, "sans ce controle, l'insert echouait en 500 opaque").toBe(400);
  });

  it("une quantite negative ne produit pas un total negatif", async () => {
    const { ligne } = await creer({ items: [{ description: "X", quantity: -5, unitPrice: 100, taxRate: 20 }] });
    expect(Number(ligne.subtotal)).toBe(0);
  });

  it("une facture sans ligne reste creable, a zero", async () => {
    const { r, ligne } = await creer({ items: [] });
    expect(r.status).toBe(201);
    expect(Number(ligne.totalAmount)).toBe(0);
  });

  it("la numerotation reste celle de la sequence commune", async () => {
    // Acquis precedent: ce controle garde qu'on ne l'a pas defait en chemin.
    const { ligne } = await creer({ items: [{ description: "Pose", quantity: 1, unitPrice: 100, taxRate: 20 }] });
    expect(ligne.reference).toMatch(/^FAC-\d{4}-\d{6}$/);
  });
});
