/**
 * Une depense entre au registre par l'approbation d'un responsable, pas par
 * un champ que l'appelant remplit lui-meme.
 *
 * Mesure le 18/09 sur le banc (API reelle, un seul appel HTTP): en envoyant
 * `status: "approuve"` a la creation, la depense naissait deja validee —
 * l'ecran d'approbation existait, mais rien n'obligeait a y passer. Et le
 * meme agent pouvait ensuite approuver sa propre saisie (200).
 *
 * Valider une depense engage l'argent de l'entreprise: c'est un acte de
 * direction. Un agent saisit, un responsable approuve.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, depensesTable, organisationsTable, usersTable } from "@workspace/db";
import router from "../routes/depenses";

const stamp = Date.now();
let orgId = 0, agentId = 0, adminId = 0;
let n = 0;

function appli(userId: () => number, role: string) {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => { (req as any).session = { userId: userId(), organisationId: orgId, userRole: role }; (req as any).log = { info() {}, warn() {}, error() {} }; next(); });
  a.use("/api", router);
  return a;
}
const agent = () => appli(() => agentId, "agent");
const admin = () => appli(() => adminId, "administrateur");

async function creer(app: express.Express, corps: Record<string, unknown> = {}) {
  const r = await request(app).post("/api/depenses").send({
    vendor: `Fournisseur ${++n}`, amountTtc: 250, category: "carburant", expenseDate: "2026-09-18", ...corps,
  });
  return r;
}
const lire = async (id: number) => (await db.select().from(depensesTable).where(eq(depensesTable.id, id)))[0]!;

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({ name: `Dep ${stamp}`, slug: `dep-${stamp}`, maxUsers: 5, actif: true }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [a] = await db.insert(usersTable).values({ organisationId: orgId, email: `dep-agent-${stamp}@example.test`, passwordHash: "x", prenom: "A", nom: "G", role: "agent", actif: true }).returning({ id: usersTable.id });
  agentId = a!.id;
  const [ad] = await db.insert(usersTable).values({ organisationId: orgId, email: `dep-admin-${stamp}@example.test`, passwordHash: "x", prenom: "D", nom: "R", role: "administrateur", actif: true }).returning({ id: usersTable.id });
  adminId = ad!.id;
}, 60_000);
afterAll(async () => {
  try { await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId)); } catch { /* best-effort */ }
});

describe("creation d'une depense", () => {
  it("nait en attente", async () => {
    const r = await creer(agent());
    expect(r.status).toBe(201);
    expect((await lire(r.body.depense.id)).status).toBe("en_attente");
  });

  it("« status: approuve » envoye a la creation est ignore", async () => {
    const r = await creer(agent(), { status: "approuve" });
    expect(r.status).toBe(201);
    expect((await lire(r.body.depense.id)).status).toBe("en_attente");
  });

  it("… et personne n'est inscrit comme relecteur", async () => {
    const r = await creer(agent(), { status: "approuve" });
    const d = await lire(r.body.depense.id);
    expect([d.reviewedBy, d.reviewedAt]).toEqual([null, null]);
  });

  it("un administrateur ne contourne pas non plus", async () => {
    const r = await creer(admin(), { status: "approuve" });
    expect((await lire(r.body.depense.id)).status).toBe("en_attente");
  });
});

describe("approbation", () => {
  it("un agent ne peut pas approuver", async () => {
    const r = await creer(agent());
    const rep = await request(agent()).post(`/api/depenses/${r.body.depense.id}/approve`);
    expect(rep.status).toBe(403);
    expect((await lire(r.body.depense.id)).status).toBe("en_attente");
  });

  it("un agent ne peut pas rejeter non plus", async () => {
    const r = await creer(agent());
    expect((await request(agent()).post(`/api/depenses/${r.body.depense.id}/reject`)).status).toBe(403);
  });

  it("un responsable approuve", async () => {
    const r = await creer(agent());
    const rep = await request(admin()).post(`/api/depenses/${r.body.depense.id}/approve`);
    expect(rep.status).toBe(200);
    expect((await lire(r.body.depense.id)).status).toBe("approuve");
  });

  it("l'approbation inscrit QUI a relu et QUAND", async () => {
    const r = await creer(agent());
    await request(admin()).post(`/api/depenses/${r.body.depense.id}/approve`);
    const d = await lire(r.body.depense.id);
    expect(d.reviewedBy).toBe(adminId);
    expect(d.reviewedAt).not.toBeNull();
  });

  it("un responsable rejette", async () => {
    const r = await creer(agent());
    await request(admin()).post(`/api/depenses/${r.body.depense.id}/reject`);
    expect((await lire(r.body.depense.id)).status).toBe("rejete");
  });

  it("une depense d'une autre organisation reste introuvable", async () => {
    const [autre] = await db.insert(organisationsTable).values({ name: `Dep2 ${stamp}`, slug: `dep2-${stamp}`, maxUsers: 5, actif: true }).returning({ id: organisationsTable.id });
    const [d] = await db.insert(depensesTable).values({
      organisationId: autre!.id, vendor: "Ailleurs", category: "autre", amountHt: "10.00", amountTva: "0.00", amountTtc: "10.00", status: "en_attente",
    } as any).returning({ id: depensesTable.id });
    expect((await request(admin()).post(`/api/depenses/${d!.id}/approve`)).status).toBe(404);
    try { await db.delete(organisationsTable).where(eq(organisationsTable.id, autre!.id)); } catch { /* best-effort */ }
  });
});

/**
 * Modifier ce qui a ete approuve rouvre l'approbation.
 *
 * Mesure le 18/09 sur le banc: une depense approuvee a 250 EUR passait a
 * 5 000 EUR et restait « approuvee », avec le nom du responsable encore inscrit
 * comme relecteur. L'approbation couvrait un montant que personne n'avait
 * valide, et l'operation ne demandait aucun privilege.
 */
describe("modification apres approbation", () => {
  async function approuvee(corps: Record<string, unknown> = {}) {
    const r = await creer(agent(), corps);
    await request(admin()).post(`/api/depenses/${r.body.depense.id}/approve`);
    return r.body.depense.id as number;
  }

  it("changer le montant repasse la depense en attente", async () => {
    const id = await approuvee();
    const rep = await request(agent()).patch(`/api/depenses/${id}`).send({ amountTtc: 5000 });
    expect(rep.status).toBe(200);
    const d = await lire(id);
    expect([d.status, d.reviewedBy, d.reviewedAt]).toEqual(["en_attente", null, null]);
  });

  it("… et la reponse le dit, pour que l'ecran ne mente pas", async () => {
    const id = await approuvee();
    const rep = await request(agent()).patch(`/api/depenses/${id}`).send({ amountTtc: 900 });
    expect(rep.body.approbationReouverte).toBe(true);
  });

  it("changer le fournisseur aussi", async () => {
    const id = await approuvee();
    await request(agent()).patch(`/api/depenses/${id}`).send({ vendor: "Un autre" });
    expect((await lire(id)).status).toBe("en_attente");
  });

  it("changer la date aussi", async () => {
    const id = await approuvee();
    await request(agent()).patch(`/api/depenses/${id}`).send({ expenseDate: "2026-01-15" });
    expect((await lire(id)).status).toBe("en_attente");
  });

  it("corriger une note ne rouvre rien", async () => {
    const id = await approuvee();
    const rep = await request(agent()).patch(`/api/depenses/${id}`).send({ notes: "facture recue par courrier" });
    expect(rep.body.approbationReouverte).toBe(false);
    expect((await lire(id)).status).toBe("approuve");
  });

  it("renvoyer le MEME montant ne rouvre rien", async () => {
    const id = await approuvee({ amountTtc: 250 });
    const rep = await request(agent()).patch(`/api/depenses/${id}`).send({ amountTtc: 250, notes: "re-enregistre" });
    expect(rep.body.approbationReouverte).toBe(false);
    expect((await lire(id)).status).toBe("approuve");
  });

  it("une depense en attente reste en attente (rien a rouvrir)", async () => {
    const r = await creer(agent());
    await request(agent()).patch(`/api/depenses/${r.body.depense.id}`).send({ amountTtc: 400 });
    expect((await lire(r.body.depense.id)).status).toBe("en_attente");
  });

  it("apres correction, un responsable peut re-approuver", async () => {
    const id = await approuvee();
    await request(agent()).patch(`/api/depenses/${id}`).send({ amountTtc: 300 });
    expect((await request(admin()).post(`/api/depenses/${id}/approve`)).status).toBe(200);
    const d = await lire(id);
    expect([d.status, d.reviewedBy]).toEqual(["approuve", adminId]);
  });
});
