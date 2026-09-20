/**
 * Aucune porte ne fait entrer d'argent sans ecriture au journal.
 *
 * `factures_client.paid_amount` est un CACHE du journal de caisse : la route
 * `/encaissements` le recalcule par somme des ecritures et le reecrit, statut
 * compris. Trois portes l'ecrivaient pourtant en direct, sans creer la moindre
 * ligne :
 *
 *  - l'outil IA `record_payment` ;
 *  - `PATCH /factures-client/:id` avec `{ paidAmount }` ;
 *  - le meme PATCH avec `{ status: "payee" }`, qui calait `paidAmount` sur le
 *    total.
 *
 * Le defaut est silencieux et il se mord la queue : le reglement n'apparait ni
 * au journal ni a l'ecran Encaissements, et le premier encaissement REEL sur
 * la meme facture recalcule le cache depuis les ecritures — qui l'ignorent.
 * Le montant saisi disparait alors, sans que rien ne le dise.
 *
 * `services/encaissement-enregistrement.ts` nomme ce defaut « le pire qu'un
 * logiciel de facturation puisse avoir » et dit avoir ferme les portes
 * coupables. Deux l'etaient ; trois ne l'etaient pas.
 *
 * Ces controles passent par le VRAI routeur et la VRAIE base, et relisent le
 * JOURNAL — pas le cache.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { db, encaissementsTable, facturesClientTable, organisationsTable, usersTable } from "@workspace/db";
import facturesRouter from "../routes/factures-client";
import aiRouter from "../routes/ai-analysis";
import { enregistrerEncaissement } from "../services/encaissement-enregistrement";

const stamp = Date.now();
let orgId = 0, userId = 0;

function appli(routeur: express.Router) {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organisationId: orgId, userRole: "administrateur" };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", routeur);
  return a;
}

/** Une facture envoyee de 120,00 EUR. */
async function facture(v: Record<string, unknown> = {}) {
  const [f] = await db.insert(facturesClientTable).values({
    organisationId: orgId,
    reference: `FAC-JRN-${stamp}-${Math.floor(Math.random() * 1e6)}`,
    title: "Pose",
    clientName: "Dupont SARL",
    items: [{ description: "Pose", quantity: 1, unitPrice: 100, taxRate: 20, total: 100 }],
    subtotal: "100.00",
    taxAmount: "20.00",
    totalAmount: "120.00",
    currency: "EUR",
    status: "envoyee",
    paidAmount: "0",
    ...v,
  } as any).returning();
  return f!;
}

const relire = async (id: number) =>
  (await db.select().from(facturesClientTable).where(eq(facturesClientTable.id, id)))[0]!;

const ecrituresDe = async (factureId: number) =>
  db.select().from(encaissementsTable)
    .where(and(eq(encaissementsTable.organisationId, orgId), eq(encaissementsTable.factureId, factureId)));

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Journal ${stamp}`, slug: `journal-${stamp}`, maxUsers: 10, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [u] = await db.insert(usersTable).values({
    organisationId: orgId, email: `journal-${stamp}@example.test`, passwordHash: "x",
    prenom: "J", nom: "R", role: "administrateur", actif: true,
  }).returning({ id: usersTable.id });
  userId = u!.id;
}, 60_000);

afterAll(async () => {
  try {
    await db.delete(facturesClientTable).where(eq(facturesClientTable.organisationId, orgId));
    await db.delete(usersTable).where(eq(usersTable.organisationId, orgId));
    await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
  } catch { /* journal en ajout seul */ }
});

describe("le montant encaisse ne se saisit pas sur la facture", () => {
  it("un PATCH qui change paidAmount est refuse", async () => {
    const f = await facture();
    const r = await request(appli(facturesRouter as express.Router))
      .patch(`/api/factures-client/${f.id}`).send({ paidAmount: 50 });
    expect(r.status, "l'argent est entre sans ecriture").toBe(409);
  });

  it("et il dit par ou passer", async () => {
    const f = await facture();
    const r = await request(appli(facturesRouter as express.Router))
      .patch(`/api/factures-client/${f.id}`).send({ paidAmount: 50 });
    expect(r.body.remediation, "le refus n'indique aucun chemin").toMatch(/encaissements/);
  });

  it("le cache reste a zero apres le refus", async () => {
    const f = await facture();
    await request(appli(facturesRouter as express.Router))
      .patch(`/api/factures-client/${f.id}`).send({ paidAmount: 50 });
    expect(Number((await relire(f.id)).paidAmount)).toBe(0);
  });

  it("renvoyer la MEME valeur reste accepte", async () => {
    // L'ecran renvoie le formulaire complet, `paidAmount` compris. Refuser un
    // formulaire qui n'a rien change rendrait la fiche non modifiable.
    const f = await facture();
    const r = await request(appli(facturesRouter as express.Router))
      .patch(`/api/factures-client/${f.id}`).send({ paidAmount: 0, notes: "Relance du 20/09" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });

  it("y compris ecrite comme la base la rend", async () => {
    // La base rend « 0.00 », le formulaire renvoie 0: la meme somme sous deux
    // ecritures.
    const f = await facture();
    const r = await request(appli(facturesRouter as express.Router))
      .patch(`/api/factures-client/${f.id}`).send({ paidAmount: "0.00" });
    expect(r.status).toBe(200);
  });
});

describe("une facture se solde par un encaissement, pas par un statut", () => {
  it("marquer « payee » a la main est refuse", async () => {
    const f = await facture();
    const r = await request(appli(facturesRouter as express.Router))
      .patch(`/api/factures-client/${f.id}`).send({ status: "payee" });
    expect(r.status).toBe(409);
  });

  it("et la facture ne se declare pas soldee", async () => {
    const f = await facture();
    await request(appli(facturesRouter as express.Router))
      .patch(`/api/factures-client/${f.id}`).send({ status: "payee" });
    const apres = await relire(f.id);
    expect(apres.status).not.toBe("payee");
    expect(Number(apres.paidAmount)).toBe(0);
  });

  it("aucune ecriture n'a ete creee non plus", async () => {
    // Le refus ne doit pas « compenser » en fabriquant une ecriture: c'est
    // l'utilisateur qui decide d'encaisser.
    const f = await facture();
    await request(appli(facturesRouter as express.Router))
      .patch(`/api/factures-client/${f.id}`).send({ status: "payee" });
    expect((await ecrituresDe(f.id)).length).toBe(0);
  });

  it("annuler une facture reste possible", async () => {
    // Le gel porte sur le CONTENU, et le refus ci-dessus sur le seul statut
    // « payee ». Les autres changements de statut restent ouverts.
    const f = await facture();
    const r = await request(appli(facturesRouter as express.Router))
      .patch(`/api/factures-client/${f.id}`).send({ status: "annulee" });
    expect(r.status).toBe(200);
  });

  it("un vrai encaissement, lui, solde la facture", async () => {
    // Sans ce controle, les refus ci-dessus seraient satisfaits par une route
    // qui n'encaisse plus du tout.
    const f = await facture();
    const ecriture = await enregistrerEncaissement({
      organisationId: orgId, factureId: f.id, montantCentimes: 12000, moyen: "virement", createdBy: userId,
    });
    expect(ecriture.ok, JSON.stringify(ecriture)).toBe(true);
    const apres = await relire(f.id);
    expect(Number(apres.paidAmount)).toBeCloseTo(120, 2);
    expect(apres.status).toBe("payee");
  });

  it("et il laisse une trace au journal", async () => {
    const f = await facture();
    await enregistrerEncaissement({
      organisationId: orgId, factureId: f.id, montantCentimes: 5000, moyen: "especes", createdBy: userId,
    });
    const lignes = await ecrituresDe(f.id);
    expect(lignes.length, "un reglement sans ecriture").toBe(1);
    expect(Number(lignes[0]!.montantCentimes)).toBe(5000);
  });

  it("un reglement partiel se lit comme tel", async () => {
    const f = await facture();
    await enregistrerEncaissement({
      organisationId: orgId, factureId: f.id, montantCentimes: 5000, moyen: "especes", createdBy: userId,
    });
    expect((await relire(f.id)).status).toBe("partiellement_payee");
  });

  it("« partielle » n'est jamais ecrit nulle part", async () => {
    // L'outil IA posait ce mot, que le produit n'emploie pas: la facture
    // sortait de la prevision de tresorerie (`COLLECTIBLE_STATUSES`) et son
    // badge d'ecran n'avait pas de libelle.
    const f = await facture();
    await enregistrerEncaissement({
      organisationId: orgId, factureId: f.id, montantCentimes: 1000, moyen: "especes", createdBy: userId,
    });
    expect((await relire(f.id)).status).not.toBe("partielle");
  });
});

describe("l'outil IA encaisse par la meme porte que tout le monde", () => {
  /**
   * `POST /ai/execute` avec `type: "record_payment"` est le troisieme chemin
   * qui ecrivait le cache en direct. Il posait de surcroit le statut
   * « partielle », et son `UPDATE` n'etait borne que par l'identifiant de
   * facture, sans l'organisation.
   */
  const executer = (body: Record<string, unknown>) =>
    request(appli(aiRouter as express.Router)).post("/api/ai/execute").send(body);

  it("un reglement passe par l'assistant laisse une ecriture", async () => {
    const f = await facture();
    const r = await executer({ type: "record_payment", target: { invoiceId: f.id, amount: 60, method: "virement" } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await ecrituresDe(f.id)).length, "le cache a ete ecrit sans ecriture").toBe(1);
  });

  it("et le statut derive est celui du produit", async () => {
    const f = await facture();
    await executer({ type: "record_payment", target: { invoiceId: f.id, amount: 60, method: "virement" } });
    const apres = await relire(f.id);
    expect(apres.status).toBe("partiellement_payee");
    expect(apres.status).not.toBe("partielle");
  });

  it("un solde complet marque la facture payee", async () => {
    const f = await facture();
    await executer({ type: "record_payment", target: { invoiceId: f.id, amount: 120, method: "virement" } });
    expect((await relire(f.id)).status).toBe("payee");
  });

  it("un montant superieur au reste du est refuse", async () => {
    // `enregistrerEncaissement` refuse le trop-percu non voulu; l'ancien
    // chemin l'acceptait sans rien dire.
    const f = await facture();
    const r = await executer({ type: "record_payment", target: { invoiceId: f.id, amount: 500, method: "virement" } });
    expect(r.body?.result?.success ?? r.body?.success).toBe(false);
    expect((await ecrituresDe(f.id)).length).toBe(0);
  });

  it("une facture d'une autre organisation reste hors d'atteinte", async () => {
    const [autre] = await db.insert(organisationsTable).values({
      name: `Autre journal ${stamp}`, slug: `autre-journal-${stamp}`, maxUsers: 2, actif: true,
    }).returning({ id: organisationsTable.id });
    try {
      const [f] = await db.insert(facturesClientTable).values({
        organisationId: autre!.id, reference: `FAC-AILLEURS-${stamp}`, title: "Ailleurs",
        clientName: "X", items: [], subtotal: "0.00", taxAmount: "0.00", totalAmount: "100.00",
        currency: "EUR", status: "envoyee", paidAmount: "0",
      } as any).returning();
      await executer({ type: "record_payment", target: { invoiceId: f!.id, amount: 10, method: "virement" } });
      const [apres] = await db.select().from(facturesClientTable).where(eq(facturesClientTable.id, f!.id));
      expect(Number(apres!.paidAmount), "une facture d'un autre client a ete touchee").toBe(0);
      await db.delete(facturesClientTable).where(eq(facturesClientTable.organisationId, autre!.id));
    } finally {
      await db.delete(organisationsTable).where(eq(organisationsTable.id, autre!.id));
    }
  });
});
