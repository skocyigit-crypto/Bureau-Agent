/**
 * Qui peut toucher au journal de caisse.
 *
 * Mesure du 19/09 : les huit routes du journal des reglements n'avaient
 * AUCUNE garde de role. Le role `lecture_seule` — dont le nom dit l'inverse —
 * pouvait donc :
 *
 *  - enregistrer un reglement ;
 *  - le contre-passer ;
 *  - CLOTURER une periode, operation irreversible par construction (« une
 *    cloture ne se defait pas », routes/encaissements.ts) ;
 *  - telecharger l'archive comptable et l'attestation de conformite,
 *    c'est-a-dire l'integralite des reglements de l'organisation.
 *
 * Le defaut n'etait pas visible : chaque route verifie soigneusement
 * l'organisation de l'appelant (`getOrgId`), ce qui donne l'impression d'un
 * controle d'acces. Mais le cloisonnement entre clients n'est pas le
 * cloisonnement entre collegues, et c'est le second qui manquait.
 *
 * Repartition retenue : l'encaissement reste ouvert aux agents — constater un
 * reglement sur un chantier fait partie de leur travail — et tout le reste
 * remonte au responsable.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, encaissementsTable, facturesClientTable, organisationsTable, usersTable } from "@workspace/db";
import router from "../routes/encaissements";

const stamp = Date.now();
let orgId = 0, userId = 0;

/** Une application dont la session porte le role demande. */
function appli(role: string) {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organisationId: orgId, userRole: role };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", router);
  return a;
}

async function facture() {
  const [f] = await db.insert(facturesClientTable).values({
    organisationId: orgId, reference: `ROL-${stamp}-${Math.random().toString(36).slice(2, 8)}`,
    title: "Travaux", clientName: "Client", status: "envoyee",
    items: [], subtotal: "100.00", taxAmount: "20.00",
    totalAmount: "120.00", paidAmount: "0", currency: "EUR",
  } as any).returning({ id: facturesClientTable.id });
  return f!.id;
}

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Roles ${stamp}`, slug: `roles-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [u] = await db.insert(usersTable).values({
    organisationId: orgId, email: `roles-${stamp}@example.test`,
    passwordHash: "x", prenom: "R", nom: "O", role: "administrateur", actif: true,
  }).returning({ id: usersTable.id });
  userId = u!.id;
}, 60_000);

afterAll(async () => {
  try { await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId)); } catch { /* journaux */ }
});

describe("le role lecture_seule ne peut rien ecrire", () => {
  it("n'enregistre pas de reglement", async () => {
    const id = await facture();
    const r = await request(appli("lecture_seule")).post("/api/encaissements")
      .send({ factureId: id, montant: 50, moyen: "virement" });
    expect(r.status, "un role « lecture seule » ecrivait dans le journal de caisse").toBe(403);
  });

  it("et aucune ligne n'apparait", async () => {
    const id = await facture();
    await request(appli("lecture_seule")).post("/api/encaissements")
      .send({ factureId: id, montant: 50, moyen: "virement" });
    const l = await db.select().from(encaissementsTable).where(eq(encaissementsTable.factureId, id));
    expect(l).toHaveLength(0);
  });

  it("ne contre-passe pas", async () => {
    const r = await request(appli("lecture_seule")).post("/api/encaissements/annuler").send({ numero: 1 });
    expect(r.status).toBe(403);
  });

  it("ne clot pas une periode — l'operation est irreversible", async () => {
    const r = await request(appli("lecture_seule")).post("/api/encaissements/cloturer")
      .send({ type: "annuelle", periode: "2020" });
    expect(r.status, "une cloture ne se defait pas: elle ne peut pas etre a la portee de tous").toBe(403);
  });

  it("ne telecharge pas l'archive comptable de l'organisation", async () => {
    const r = await request(appli("lecture_seule")).get("/api/encaissements/archive?type=annuelle&periode=2020");
    expect(r.status).toBe(403);
  });
});

describe("l'agent constate les reglements, sans plus", () => {
  it("il enregistre un encaissement : c'est son travail sur un chantier", async () => {
    const id = await facture();
    const r = await request(appli("agent")).post("/api/encaissements")
      .send({ factureId: id, montant: 40, moyen: "especes" });
    expect(r.status, "l'agent ne peut plus encaisser: la correction est trop large").toBe(201);
  });

  it("il ne contre-passe pas : la correction marque le journal definitivement", async () => {
    const id = await facture();
    const e = await request(appli("agent")).post("/api/encaissements")
      .send({ factureId: id, montant: 40, moyen: "especes" });
    const r = await request(appli("agent")).post("/api/encaissements/annuler")
      .send({ numero: e.body.numero });
    expect(r.status).toBe(403);
  });

  it("il ne clot aucune periode", async () => {
    const r = await request(appli("agent")).post("/api/encaissements/cloturer")
      .send({ type: "annuelle", periode: "2020" });
    expect(r.status).toBe(403);
  });

  it("il n'obtient ni archive ni attestation", async () => {
    expect((await request(appli("agent")).get("/api/encaissements/archive?type=annuelle&periode=2020")).status).toBe(403);
    expect((await request(appli("agent")).get("/api/encaissements/attestation")).status).toBe(403);
  });

  it("il ne verifie pas la chaine : elle expose tout le journal", async () => {
    expect((await request(appli("agent")).get("/api/encaissements/verifier")).status).toBe(403);
  });
});

describe("le responsable garde la main", () => {
  it("l'administrateur contre-passe", async () => {
    const id = await facture();
    const e = await request(appli("agent")).post("/api/encaissements")
      .send({ factureId: id, montant: 15, moyen: "virement" });
    const r = await request(appli("administrateur")).post("/api/encaissements/annuler")
      .send({ numero: e.body.numero });
    expect(r.status, "plus personne ne peut corriger une erreur de saisie").toBe(201);
  });

  it("il verifie la chaine", async () => {
    const r = await request(appli("administrateur")).get("/api/encaissements/verifier");
    expect(r.status).toBe(200);
  });

  it("le super-admin aussi, par la hierarchie des roles", async () => {
    const r = await request(appli("super_admin")).get("/api/encaissements/verifier");
    expect(r.status).toBe(200);
  });

  it("un role inconnu n'herite de rien", async () => {
    const r = await request(appli("stagiaire")).get("/api/encaissements/verifier");
    expect(r.status, "un role absent de la hierarchie ne doit pas ouvrir de porte").toBe(403);
  });
});
