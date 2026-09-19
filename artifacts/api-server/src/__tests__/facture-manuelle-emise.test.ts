/**
 * Le bouton « generer la facture » produisait un document sans mentions.
 *
 * `/license-management/auto-generate-invoice` inserait une facture en
 * « en_attente » — donc exigible, et adressee au client par courriel juste
 * apres — sans jamais appeler `emettreFacturePlateforme`. Le document partait
 * sans NUMERO, sans DATE D'EMISSION et sans ligne de TVA, c'est-a-dire sans
 * les mentions que l'article 242 nonies A de l'annexe II au CGI rend
 * obligatoires. Le courriel affichait meme une reference fabriquee
 * (« INV-mois-orgId ») qui ne correspondait a aucune donnee stockee : le
 * client recevait un identifiant que le vendeur ne connaissait pas.
 *
 * Deux autres ecarts avec le moteur mensuel, mesures au meme endroit :
 *  - il facturait un essai et un abonnement SUSPENDU, que le cron refuse de
 *    facturer (le suspendu est en lecture seule : on lui facturerait un mois
 *    qu'on l'a empeche d'utiliser) ;
 *  - les tarifs de depassement etaient recopies en durs, la ou le moteur lit
 *    `OVERAGE_RATES`.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db, invoicesTable, organisationsTable, subscriptionsTable, usersTable, OVERAGE_RATES } from "@workspace/db";
import router from "../routes/license-management";

const stamp = Date.now();
let adminOrg = 0, adminUser = 0;
let compteur = 0;

function appli() {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: adminUser, organisationId: adminOrg, userRole: "super_admin" };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", router);
  return a;
}

async function client(plan = "starter", statut = "active"): Promise<number> {
  const tag = `${stamp}-${compteur++}`;
  const [org] = await db.insert(organisationsTable).values({
    name: `Fact ${tag}`, slug: `fact-${tag}`, maxUsers: 5, actif: true,
    autoEmailInvoice: false,
  } as any).returning({ id: organisationsTable.id });
  await db.insert(subscriptionsTable).values({
    organisationId: org!.id, plan, status: statut, licenseKey: `FACT-${tag}`,
    maxUsers: 5, maxContacts: 500, maxCallsPerMonth: 2000, price: "29",
  } as any);
  return org!.id;
}

const generer = (targetOrgId: number) =>
  request(appli()).post("/api/license-management/auto-generate-invoice").send({ targetOrgId });

const factures = async (orgId: number) =>
  db.select().from(invoicesTable).where(eq(invoicesTable.organisationId, orgId));

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Admin ${stamp}`, slug: `admin-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  adminOrg = o!.id;
  const [u] = await db.insert(usersTable).values({
    organisationId: adminOrg, email: `admin-fact-${stamp}@example.test`,
    passwordHash: "x", prenom: "A", nom: "F", role: "super_admin", actif: true,
  }).returning({ id: usersTable.id });
  adminUser = u!.id;
}, 60_000);

afterAll(async () => {
  try { await db.delete(organisationsTable).where(eq(organisationsTable.id, adminOrg)); } catch { /* journaux */ }
});

describe("la facture produite porte ses mentions obligatoires", () => {
  it("elle recoit un numero", async () => {
    const id = await client();
    expect((await generer(id)).status).toBe(200);
    const [f] = await factures(id);
    expect(f.reference, "facture exigible sans numero de sequence").toBeTruthy();
  });

  it("elle porte une date d'emission", async () => {
    const id = await client();
    await generer(id);
    const [f] = await factures(id);
    expect(f.issuedAt).toBeTruthy();
  });

  it("elle porte la TVA et un total TTC coherent", async () => {
    const id = await client();
    await generer(id);
    const [f] = await factures(id);
    const ht = Number(f.totalAmount);
    const tva = Number(f.vatAmount);
    expect(tva, "aucune ligne de TVA sur une facture francaise").toBeGreaterThan(0);
    expect(Number(f.totalTtc)).toBeCloseTo(ht + tva, 2);
  });

  it("elle identifie l'acheteur", async () => {
    const id = await client();
    await generer(id);
    const [f] = await factures(id);
    expect(f.buyerSnapshot, "identite de l'acheteur absente").toBeTruthy();
  });

  it("deux factures portent des numeros differents", async () => {
    const a = await client();
    const b = await client();
    await generer(a);
    await generer(b);
    const [fa] = await factures(a);
    const [fb] = await factures(b);
    expect(fa.reference).not.toBe(fb.reference);
  });
});

describe("ce qui ne doit pas etre facture", () => {
  it("un essai ne se facture pas", async () => {
    const id = await client("essai");
    const r = await generer(id);
    expect(r.status).toBe(400);
    expect(await factures(id), "facture emise sur une periode d'essai").toHaveLength(0);
  });

  it("un abonnement suspendu non plus", async () => {
    const id = await client("starter", "suspended");
    const r = await generer(id);
    expect(r.status, "on facture un mois qu'on a empeche d'utiliser").toBe(400);
    expect(await factures(id)).toHaveLength(0);
  });

  it("le motif du refus nomme le statut", async () => {
    const id = await client("starter", "suspended");
    expect((await generer(id)).body.error).toMatch(/suspended/);
  });

  it("une seconde generation sur le meme mois est refusee", async () => {
    const id = await client();
    await generer(id);
    expect((await generer(id)).status, "deux factures pour le meme mois").toBe(400);
    expect(await factures(id)).toHaveLength(1);
  });

  it("une organisation inconnue rend 404", async () => {
    expect((await generer(999_999_999)).status).toBe(404);
  });
});

describe("les tarifs ne sont pas recopies", () => {
  const source = readFileSync(
    join(import.meta.dirname, "..", "routes", "license-management.ts"), "utf8",
  );

  it("le bouton lit les memes tarifs que le moteur mensuel", () => {
    expect(
      source,
      "tarifs en durs: une revision laisserait ce bouton facturer les anciens prix",
    ).toMatch(/OVERAGE_RATES\.extraUserPerMonth/);
  });

  it("les trois tarifs viennent de la meme source", () => {
    for (const cle of Object.keys(OVERAGE_RATES)) {
      expect(source, `tarif ${cle} non partage`).toContain(`OVERAGE_RATES.${cle}`);
    }
  });

  it("le courriel n'annonce plus une reference fabriquee", () => {
    expect(source, "le client recevait un identifiant inconnu du vendeur").not.toContain("INV-${monthLabel}-${tgtOrg}");
  });
});

/**
 * La numerotation des factures client, par l'autre porte.
 *
 * `/license-management/create-client-invoice` calculait son numero par
 * `count(*) + 1` sur les factures de l'organisation, alors que
 * `/api/factures-client` tient une sequence dediee
 * (services/invoice-numbering.ts). Trois consequences, toutes contraires a
 * l'article 242 nonies A de l'annexe II au CGI :
 *
 *  - deux creations simultanees comptaient la meme valeur et produisaient le
 *    MEME numero ;
 *  - la suppression d'une facture faisait reutiliser un numero deja emis ;
 *  - les deux portes numerotaient chacune de son cote, sur les memes factures,
 *    donc la sequence ne pouvait pas etre continue.
 */
describe("numerotation des factures client creees depuis l'administration", () => {
  const creer = (corps: Record<string, unknown>) =>
    request(appli()).post("/api/license-management/create-client-invoice").send(corps);

  const corpsType = {
    clientName: "Client", title: "Travaux",
    items: [{ description: "Pose", quantity: 1, unitPrice: 100, taxRate: 20 }],
  };

  it("attribue un numero de la sequence dediee", async () => {
    const r = await creer(corpsType);
    expect(r.status).toBe(201);
    expect(r.body.facture.reference, "numero absent").toBeTruthy();
  });

  it("deux factures ne portent jamais le meme numero", async () => {
    const [a, b] = await Promise.all([creer(corpsType), creer(corpsType)]);
    expect(
      a.body.facture.reference,
      "deux creations simultanees comptaient la meme valeur",
    ).not.toBe(b.body.facture.reference);
  });

  it("dix creations simultanees donnent dix numeros distincts", async () => {
    const lot = await Promise.all(Array.from({ length: 10 }, () => creer(corpsType)));
    const refs = lot.map(r => r.body.facture?.reference);
    expect(new Set(refs).size, `doublons: ${refs.join(", ")}`).toBe(10);
  });

  it("le numero ne depend plus du nombre de factures existantes", () => {
    const source = readFileSync(
      join(import.meta.dirname, "..", "routes", "license-management.ts"), "utf8",
    );
    const bloc = source.slice(source.indexOf(`"/license-management/create-client-invoice"`));
    expect(bloc.slice(0, 4000), "compteur par count(*): une suppression reutilise un numero").not.toMatch(/count\(\*\)::int`\s*\}\)\.from\(facturesClientTable\)/);
    expect(bloc.slice(0, 4000)).toMatch(/nextInvoiceNumber\(tx, orgId\)/);
  });

  it("le numero est pris dans la transaction d'insertion", () => {
    const source = readFileSync(
      join(import.meta.dirname, "..", "routes", "license-management.ts"), "utf8",
    );
    const bloc = source.slice(source.indexOf(`"/license-management/create-client-invoice"`));
    // On compare les positions des APPELS, pas des mentions en commentaire.
    const iTx = bloc.indexOf("await db.transaction(");
    const iNum = bloc.indexOf("nextInvoiceNumber(tx, orgId)");
    expect(iTx, "numero hors transaction: un echec laisse un trou dans la sequence").toBeGreaterThan(-1);
    expect(iNum).toBeGreaterThan(iTx);
  });
});
