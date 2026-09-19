/**
 * La contre-passation obeit aux memes regles que l encaissement.
 *
 * Mesure du 19/09 sur POST /encaissements/annuler. La route refusait bien
 * d annuler une annulation, mais il lui manquait deux gardes que la route
 * d encaissement applique.
 *
 *  1. ANNULER DEUX FOIS LA MEME ECRITURE etait accepte. Le SOLDE, lui, ne
 *     bougeait pas: soldeFacture ecarte les numeros annules par un ensemble,
 *     donc annuler deux fois donne le meme montant qu annuler une fois. C est
 *     exactement ce qui rendait le defaut invisible — aucun total ne s en
 *     plaignait. Le journal, lui, gardait deux contre-passations pour un seul
 *     reglement; il est en ajout seul et chaine, ces lignes ne se retirent
 *     pas, elles consomment des numeros de sequence, et l archive remise a un
 *     controleur montre deux annulations du meme encaissement — ce qui
 *     ressemble a ce que l inalterabilite est censee empecher.
 *  2. LA PERIODE CLOSE. L encaissement refuse une ecriture datee dans une
 *     periode close, precisement pour que l anti-fraude ne soit pas
 *     contournable par le bas. L annulation y entrait — et une cloture qui
 *     fige un cumul que l on peut encore diminuer ne fige rien.
 *
 * Les controles ci-dessous ont ete ecrits AVANT les corrections: cinq
 * tombaient, ce qui a mesure les deux defauts au lieu de les supposer.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { db, encaissementsTable, facturesClientTable, organisationsTable, usersTable } from "@workspace/db";
import router from "../routes/encaissements";

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
  a.use("/api", router);
  return a;
}

async function facture(total = "120.00") {
  const [f] = await db.insert(facturesClientTable).values({
    organisationId: orgId, reference: `ANN-${stamp}-${Math.random().toString(36).slice(2, 8)}`,
    title: "Travaux", clientName: "Client", status: "envoyee",
    items: [], subtotal: "100.00", taxAmount: "20.00",
    totalAmount: total, paidAmount: "0", currency: "EUR",
  } as any).returning({ id: facturesClientTable.id });
  return f!.id;
}

const encaisser = (corps: Record<string, unknown>) =>
  request(appli()).post("/api/encaissements").send(corps);
const annuler = (numero: number) =>
  request(appli()).post("/api/encaissements/annuler").send({ numero });
const lireFacture = async (id: number) =>
  (await db.select().from(facturesClientTable).where(eq(facturesClientTable.id, id)))[0];
const lignes = async (factureId: number) =>
  db.select().from(encaissementsTable)
    .where(and(eq(encaissementsTable.organisationId, orgId), eq(encaissementsTable.factureId, factureId)))
    .orderBy(encaissementsTable.numero);

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Annul ${stamp}`, slug: `annul-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [u] = await db.insert(usersTable).values({
    organisationId: orgId, email: `annul-${stamp}@example.test`,
    passwordHash: "x", prenom: "A", nom: "N", role: "administrateur", actif: true,
  }).returning({ id: usersTable.id });
  userId = u!.id;
}, 60_000);

afterAll(async () => {
  try { await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId)); } catch { /* journaux */ }
});

describe("une contre-passation normale", () => {
  it("ramene le montant regle a zero", async () => {
    const id = await facture();
    const e = await encaisser({ factureId: id, montant: 120, moyen: "virement" });
    expect(e.status).toBe(201);
    const r = await annuler(e.body.numero);
    expect(r.status).toBe(201);
    expect(Number((await lireFacture(id)).paidAmount)).toBe(0);
  });

  it("laisse l'ecriture d'origine en place : on contre-passe, on n'efface pas", async () => {
    const id = await facture();
    const e = await encaisser({ factureId: id, montant: 50, moyen: "virement" });
    await annuler(e.body.numero);
    const l = await lignes(id);
    expect(l).toHaveLength(2);
    expect(l[0].sens).toBe("encaissement");
    expect(l[1].sens).toBe("annulation");
    expect(l[1].annuleNumero).toBe(e.body.numero);
  });

  it("la contre-passation reste chainee sur la precedente", async () => {
    const id = await facture();
    const e = await encaisser({ factureId: id, montant: 30, moyen: "virement" });
    await annuler(e.body.numero);
    const l = await lignes(id);
    expect(l[1].empreintePrecedente, "chaine rompue par l'annulation").toBe(l[0].empreinte);
  });

  it("une annulation ne s'annule pas", async () => {
    const id = await facture();
    const e = await encaisser({ factureId: id, montant: 20, moyen: "virement" });
    const a = await annuler(e.body.numero);
    const r = await annuler(a.body.numero);
    expect(r.status).toBe(400);
  });

  it("une ecriture inconnue est refusee", async () => {
    expect((await annuler(999_999)).status).toBe(400);
  });

  it("un numero invalide est refuse avant toute lecture", async () => {
    expect((await annuler(0)).status).toBe(400);
    expect((await annuler(-3)).status).toBe(400);
  });
});

describe("annuler deux fois la meme ecriture", () => {
  it("est refuse", async () => {
    const id = await facture();
    const e = await encaisser({ factureId: id, montant: 120, moyen: "virement" });
    expect((await annuler(e.body.numero)).status).toBe(201);
    const seconde = await annuler(e.body.numero);
    expect(seconde.status, "deux contre-passations pour un seul encaissement").toBe(400);
  });

  it("le solde ne trahissait pas le defaut, et c'est pourquoi il durait", async () => {
    // `soldeFacture` ecarte les numeros annules par un ENSEMBLE: deux
    // contre-passations donnent donc le meme montant qu'une seule. Ce
    // controle enregistre la raison pour laquelle aucun total ne signalait
    // le probleme — celui qui chercherait le defaut dans les montants
    // chercherait au mauvais endroit.
    const id = await facture();
    const e = await encaisser({ factureId: id, montant: 120, moyen: "virement" });
    await annuler(e.body.numero);
    await annuler(e.body.numero);
    expect(Number((await lireFacture(id)).paidAmount)).toBe(0);
  });

  it("le journal ne contient qu'une seule contre-passation", async () => {
    const id = await facture();
    const e = await encaisser({ factureId: id, montant: 60, moyen: "virement" });
    await annuler(e.body.numero);
    await annuler(e.body.numero);
    const annulations = (await lignes(id)).filter((l) => l.sens === "annulation");
    expect(annulations).toHaveLength(1);
  });

  it("le refus dit pourquoi", async () => {
    const id = await facture();
    const e = await encaisser({ factureId: id, montant: 10, moyen: "virement" });
    await annuler(e.body.numero);
    const r = await annuler(e.body.numero);
    expect(String(r.body.error), "refus muet: l'operateur ne sait pas quoi corriger").toMatch(/deja annulee/i);
  });
});

describe("une periode close", () => {
  it("refuse la contre-passation, comme elle refuse l'encaissement", async () => {
    const id = await facture();
    const e = await encaisser({ factureId: id, montant: 100, moyen: "virement" });
    const jour = new Date().toISOString().slice(0, 10);
    const cloture = await request(appli()).post("/api/encaissements/cloturer")
      .send({ type: "journaliere", periode: jour });
    expect(cloture.status, "cloture impossible: le controle ne mesure rien").toBeLessThan(400);

    const r = await annuler(e.body.numero);
    expect(
      r.status,
      "une cloture qui fige un cumul qu'on peut encore diminuer ne fige rien",
    ).toBe(409);
  });

  it("le refus n'ajoute aucune ligne au journal scelle", async () => {
    // La periode du jour est close par le controle precedent : ce qui compte
    // n'est pas le code de retour mais le fait que le journal n'ait PAS bouge.
    const id = await facture();
    const e = await encaisser({ factureId: id, montant: 70, moyen: "virement" });
    expect(e.status, "la cloture doit aussi bloquer l'encaissement").toBe(409);

    const avant = (await db.select().from(encaissementsTable)
      .where(eq(encaissementsTable.organisationId, orgId))).length;
    await annuler(1);
    const apres = (await db.select().from(encaissementsTable)
      .where(eq(encaissementsTable.organisationId, orgId))).length;
    expect(apres, "une ligne s'est ajoutee apres la cloture").toBe(avant);
  });
});
