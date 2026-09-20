/**
 * Trois endroits ou un chiffre faux avait l'air d'un calcul.
 *
 *  1. `account_health_check` (outil de l'assistant) rapportait six champs qui
 *     n'existent pas sur un `CompteClientCalcule` — c'etaient les colonnes de
 *     l'ancienne table `compte_client`, abandonnee parce que rien ne
 *     l'ecrivait. Le resultat n'etait pas un trou, c'etait pire : « delai
 *     moyen : 0 jours » et « limite de credit : 0,00 € » sont des CHIFFRES,
 *     rendus a cote d'un score de sante et d'un impaye qui, eux, sont justes.
 *     Le `let accounts: any[]` avait eteint le controle de type qui l'aurait
 *     dit.
 *
 *  2. `PATCH /depenses/:id` ecrivait HT, TVA et TTC colonne par colonne,
 *     independamment. Corriger une depense de 250 EUR TTC en 300 laissait
 *     l'ancien HT en place : le registre remis au comptable, et la TVA
 *     deductible qui en derive, portaient un triplet qui ne s'additionne pas.
 *
 *  3. `record-payment` et `mark-invoice-paid` refaisaient un `update` du
 *     statut APRES `enregistrerEncaissement`, hors transaction, avec la
 *     valeur lue AVANT l'ecriture. Un acompte laissait la facture en
 *     « envoyee » au lieu de « partiellement payee » : elle continuait d'etre
 *     relancee pour une somme que le client venait de virer.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, depensesTable, facturesClientTable, organisationsTable, usersTable } from "@workspace/db";
import depensesRouter from "../routes/depenses";
import licenceRouter from "../routes/license-management";

const stamp = Date.now();
let orgId = 0, userId = 0;

function appli(routeur: express.Router, role = "administrateur") {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organisationId: orgId, userRole: role };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", routeur);
  return a;
}

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Chiffres ${stamp}`, slug: `chiffres-${stamp}`, maxUsers: 10, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [u] = await db.insert(usersTable).values({
    organisationId: orgId, email: `chiffres-${stamp}@example.test`, passwordHash: "x",
    prenom: "C", nom: "V", role: "administrateur", actif: true,
  }).returning({ id: usersTable.id });
  userId = u!.id;
}, 60_000);

afterAll(async () => {
  try {
    await db.delete(depensesTable).where(eq(depensesTable.organisationId, orgId));
    await db.delete(facturesClientTable).where(eq(facturesClientTable.organisationId, orgId));
    await db.delete(usersTable).where(eq(usersTable.organisationId, orgId));
    await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
  } catch { /* journaux en ajout seul */ }
});

// ── 1. L'assistant ne cite que ce qui est calcule ────────────────────────────

describe("l'analyse de sante client ne cite que des chiffres reels", () => {
  const source = readFileSync(join(import.meta.dirname, "..", "routes", "ai-analysis.ts"), "utf8");
  const bloc = (() => {
    const i = source.indexOf('case "account_health_check"');
    return source.slice(i, source.indexOf('case "cash_flow_forecast"', i));
  })();

  const champsDisparus = [
    "nbFactures", "nbFacturesPayees", "nbFacturesEnRetard",
    "delaiMoyenPaiement", "creditLimit",
  ];

  for (const champ of champsDisparus) {
    it(`${champ} n'est plus rapporte: il n'existe pas`, () => {
      expect(bloc, `${champ} vient de l'ancienne table compte_client`).not.toContain(`a.${champ}`);
    });
  }

  it("le statut inexistant non plus", () => {
    expect(bloc).not.toMatch(/statut: a\.status/);
  });

  it("le type est remis, pour que la derive suivante se voie", () => {
    // `any[]` est ce qui a laissé passer six champs fantomes.
    expect(bloc, "le type a ete rendu a any").toContain("accounts: CompteClientCalcule[]");
  });

  it("et ce qui est reellement calcule est rapporte", () => {
    // La balance agee et le retard le plus ancien valent mieux que des
    // champs inventes — et ils existent, eux.
    for (const vrai of ["healthScore", "riskLevel", "solde", "montantEnRetard", "joursRetardMax", "agingO30"]) {
      expect(bloc, `${vrai} devrait etre rapporte`).toContain(`a.${vrai}`);
    }
  });
});

// ── 2. Une depense corrigee reste coherente ─────────────────────────────────

async function depense(v: Record<string, unknown> = {}) {
  const [d] = await db.insert(depensesTable).values({
    organisationId: orgId,
    vendor: "Fournisseur BTP",
    amountHt: "208.33",
    amountTva: "41.67",
    amountTtc: "250.00",
    category: "materiaux",
    paymentStatus: "a_payer",
    ...v,
  } as any).returning();
  return d!;
}

const relireDepense = async (id: number) =>
  (await db.select().from(depensesTable).where(eq(depensesTable.id, id)))[0]!;

const sAdditionne = (d: { amountHt: string | null; amountTva: string | null; amountTtc: string | null }) =>
  Math.abs((Number(d.amountHt) + Number(d.amountTva)) - Number(d.amountTtc)) < 0.02;

describe("HT + TVA font toujours le TTC d'une depense", () => {
  it("corriger le seul TTC reventile les trois montants", async () => {
    const d = await depense();
    const r = await request(appli(depensesRouter as express.Router))
      .patch(`/api/depenses/${d.id}`).send({ amountTtc: 300 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const apres = await relireDepense(d.id);
    expect(Number(apres.amountTtc)).toBeCloseTo(300, 2);
    expect(sAdditionne(apres), `HT ${apres.amountHt} + TVA ${apres.amountTva} != TTC ${apres.amountTtc}`).toBe(true);
  });

  it("l'ancien HT ne survit pas a la correction", async () => {
    const d = await depense();
    await request(appli(depensesRouter as express.Router))
      .patch(`/api/depenses/${d.id}`).send({ amountTtc: 300 });
    expect(Number((await relireDepense(d.id)).amountHt), "le HT d'avant est reste").not.toBeCloseTo(208.33, 2);
  });

  it("corriger le seul HT recalcule le TTC", async () => {
    const d = await depense();
    await request(appli(depensesRouter as express.Router))
      .patch(`/api/depenses/${d.id}`).send({ amountHt: 400, amountTva: 80 });
    const apres = await relireDepense(d.id);
    expect(Number(apres.amountTtc)).toBeCloseTo(480, 2);
    expect(sAdditionne(apres)).toBe(true);
  });

  it("modifier autre chose ne touche pas aux montants", async () => {
    // Une reconstitution declenchee a tort reecrirait des montants que
    // personne n'a demande a changer.
    const d = await depense();
    await request(appli(depensesRouter as express.Router))
      .patch(`/api/depenses/${d.id}`).send({ vendor: "Autre fournisseur" });
    const apres = await relireDepense(d.id);
    expect(Number(apres.amountHt)).toBeCloseTo(208.33, 2);
    expect(Number(apres.amountTtc)).toBeCloseTo(250, 2);
  });
});

// ── 3. Le statut derive n'est plus ecrase ───────────────────────────────────

async function facture(v: Record<string, unknown> = {}) {
  const [f] = await db.insert(facturesClientTable).values({
    organisationId: orgId,
    reference: `FAC-DER-${stamp}-${Math.floor(Math.random() * 1e6)}`,
    title: "Chantier",
    clientName: "Dupont SARL",
    items: [{ description: "Pose", quantity: 1, unitPrice: 100, taxRate: 20, total: 100 }],
    subtotal: "100.00", taxAmount: "20.00", totalAmount: "120.00",
    currency: "EUR", status: "envoyee", paidAmount: "0",
    ...v,
  } as any).returning();
  return f!;
}

const relireFacture = async (id: number) =>
  (await db.select().from(facturesClientTable).where(eq(facturesClientTable.id, id)))[0]!;

describe("un acompte enregistre par l'administration se voit", () => {
  it("la facture passe en reglement partiel", async () => {
    const f = await facture();
    const r = await request(appli(licenceRouter as express.Router, "super_admin"))
      .post("/api/license-management/record-payment")
      .send({ factureClientId: f.id, amount: 50, paymentMethod: "virement" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await relireFacture(f.id)).status, "elle sera relancee comme impayee").toBe("partiellement_payee");
  });

  it("et non « envoyee », comme avant", async () => {
    const f = await facture();
    await request(appli(licenceRouter as express.Router, "super_admin"))
      .post("/api/license-management/record-payment")
      .send({ factureClientId: f.id, amount: 50, paymentMethod: "virement" });
    expect((await relireFacture(f.id)).status).not.toBe("envoyee");
  });

  it("le moyen de paiement, lui, est bien conserve", async () => {
    // C'est la seule chose que cette route doit encore ecrire.
    const f = await facture();
    await request(appli(licenceRouter as express.Router, "super_admin"))
      .post("/api/license-management/record-payment")
      .send({ factureClientId: f.id, amount: 50, paymentMethod: "cheque" });
    expect((await relireFacture(f.id)).paymentMethod).toBe("cheque");
  });

  it("un solde complet marque bien la facture payee", async () => {
    const f = await facture();
    await request(appli(licenceRouter as express.Router, "super_admin"))
      .post("/api/license-management/record-payment")
      .send({ factureClientId: f.id, amount: 120, paymentMethod: "virement" });
    const apres = await relireFacture(f.id);
    expect(apres.status).toBe("payee");
    expect(apres.paidAt).not.toBeNull();
  });

  it("le montant encaisse suit le journal", async () => {
    const f = await facture();
    await request(appli(licenceRouter as express.Router, "super_admin"))
      .post("/api/license-management/record-payment")
      .send({ factureClientId: f.id, amount: 50, paymentMethod: "virement" });
    expect(Number((await relireFacture(f.id)).paidAmount)).toBeCloseTo(50, 2);
  });
});
