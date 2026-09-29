/**
 * Devis accepte -> facture, devis accepte -> chantier (plan du 29/09, section 5).
 *
 * Trois regles, sur une vraie base :
 *  - seul un devis ACCEPTE se facture ; la conversion ne l'accepte plus au
 *    passage (elle contournait la regle qui reserve l'acceptation a
 *    l'administration) ;
 *  - seul un devis accepte ouvre un chantier, par un geste explicite, et
 *    n'en ouvre qu'UN, meme sous deux clics simultanes ;
 *  - accepter le devis gagne l'opportunite dont il vient.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { auditLogsTable, db, devisTable, facturesClientTable, organisationsTable, projetsTable, prospectsTable, usersTable } from "@workspace/db";
import devisRouter from "../routes/devis";

const stamp = Date.now();
const ids: Record<string, number> = {};
const JOUR = 24 * 60 * 60 * 1000;

function appli(orgId = ids.orgA, role = "administrateur", userId = ids.admin) {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organisationId: orgId, userRole: role, userEmail: `x-${stamp}@exemple.test` };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", devisRouter);
  return a;
}

async function unDevis(v: Record<string, unknown> = {}, orgId = ids.orgA) {
  const [d] = await db.insert(devisTable).values({
    organisationId: orgId, reference: `DV-${stamp}-${Math.random().toString(36).slice(2, 8)}`,
    title: "Ravalement", clientName: "SCI Duval", clientAddress: "3 rue du Port", items: [],
    subtotal: "1000.00", taxAmount: "200.00", totalAmount: "1200.00",
    status: "accepte", validUntil: new Date(Date.now() + 30 * JOUR), ...v,
  } as any).returning();
  return d!;
}
const relire = async (id: number) => (await db.select().from(devisTable).where(eq(devisTable.id, id)))[0]!;
const chantiersDu = (devisId: number) => db.select().from(projetsTable).where(eq(projetsTable.devisId, devisId));

beforeAll(async () => {
  for (const k of ["orgA", "orgB"]) {
    const [o] = await db.insert(organisationsTable).values({ name: `DevisChantier ${k} ${stamp}`, slug: `dc-${k.toLowerCase()}-${stamp}`, maxUsers: 5, actif: true }).returning({ id: organisationsTable.id });
    ids[k] = o!.id;
  }
  const [u] = await db.insert(usersTable).values({ organisationId: ids.orgA, email: `admin-dc-${stamp}@exemple.test`, passwordHash: "x", prenom: "Ada", nom: "Admin", role: "administrateur", actif: true }).returning({ id: usersTable.id });
  ids.admin = u!.id;
  const [a] = await db.insert(usersTable).values({ organisationId: ids.orgA, email: `agent-dc-${stamp}@exemple.test`, passwordHash: "x", prenom: "Aga", nom: "Agent", role: "agent", actif: true }).returning({ id: usersTable.id });
  ids.agent = a!.id;
});

afterAll(async () => {
  try {
    for (const o of [ids.orgA, ids.orgB]) {
      await db.delete(projetsTable).where(eq(projetsTable.organisationId, o));
      await db.delete(facturesClientTable).where(eq(facturesClientTable.organisationId, o));
      await db.delete(devisTable).where(eq(devisTable.organisationId, o));
      await db.delete(prospectsTable).where(eq(prospectsTable.organisationId, o));
    }
    await db.delete(organisationsTable).where(inArray(organisationsTable.id, [ids.orgA, ids.orgB]));
  } catch { /* le journal d'audit peut retenir l'organisation */ }
});

describe("devis -> facture : seul un devis accepte se facture", () => {
  it.each(["brouillon", "envoye"])("un devis %s est refuse, avec l'action qui debloque", async (statut) => {
    const d = await unDevis({ status: statut });
    const r = await request(appli()).post(`/api/devis/${d.id}/convert-to-facture`).send({});
    expect(r.status, r.text).toBe(409);
    expect(r.body.code).toBe("devis_non_accepte");
    expect(r.body.remediation).toMatch(/administrateur/);
    expect((await relire(d.id)).status, "la conversion n'accepte plus le devis au passage").toBe(statut);
    expect((await relire(d.id)).convertedToInvoice).toBeNull();
  });

  it("un devis refuse ne se facture pas", async () => {
    const d = await unDevis({ status: "refuse" });
    const r = await request(appli()).post(`/api/devis/${d.id}/convert-to-facture`).send({});
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("devis_refuse");
  });

  it("un agent ne peut plus faire accepter un devis en le facturant", async () => {
    const d = await unDevis({ status: "brouillon" });
    const r = await request(appli(ids.orgA, "agent", ids.agent)).post(`/api/devis/${d.id}/convert-to-facture`).send({});
    expect(r.status).toBe(409);
    const apres = await relire(d.id);
    expect(apres.status).toBe("brouillon");
    expect(apres.acceptedAt).toBeNull();
  });

  it("un devis accepte devient une facture brouillon, et le devis garde son acceptation", async () => {
    const accepteLe = new Date(Date.now() - 2 * JOUR);
    const d = await unDevis({ status: "accepte", acceptedAt: accepteLe, acceptedBy: ids.admin });
    const r = await request(appli()).post(`/api/devis/${d.id}/convert-to-facture`).send({});
    expect(r.status, r.text).toBe(201);
    expect(r.body.facture).toMatchObject({ status: "brouillon", devisId: d.id });
    const apres = await relire(d.id);
    expect(apres.convertedToInvoice).toBe(r.body.facture.id);
    expect(apres.acceptedAt?.getTime()).toBe(accepteLe.getTime());
    expect(apres.acceptedBy).toBe(ids.admin);
    const traces = await db.select().from(auditLogsTable).where(and(eq(auditLogsTable.action, "devis.converti_facture"), eq(auditLogsTable.resourceId, String(d.id))));
    expect(traces).toHaveLength(1);
  });
});

describe("devis -> chantier : un geste explicite, un seul chantier", () => {
  it("un devis non accepte n'ouvre pas de chantier", async () => {
    const d = await unDevis({ status: "envoye" });
    const r = await request(appli()).post(`/api/devis/${d.id}/chantier`).send({});
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("devis_non_accepte");
    expect(await chantiersDu(d.id)).toHaveLength(0);
  });

  it("un devis accepte ouvre un chantier relie au devis, au client et a l'opportunite", async () => {
    const [p] = await db.insert(prospectsTable).values({ organisationId: ids.orgA, title: "Ravalement Duval", stage: "gagne" }).returning({ id: prospectsTable.id });
    const d = await unDevis({ prospectId: p!.id });
    const r = await request(appli()).post(`/api/devis/${d.id}/chantier`).send({});
    expect(r.status, r.text).toBe(201);
    expect(r.body.projet).toMatchObject({ devisId: d.id, prospectId: p!.id, clientName: "SCI Duval", address: "3 rue du Port", status: "planifie", organisationId: ids.orgA });
    // Le prix de vente n'est pas l'enveloppe de depenses.
    expect(r.body.projet.budget).toBeNull();
    const traces = await db.select().from(auditLogsTable).where(and(eq(auditLogsTable.action, "chantier.ouvert_depuis_devis"), eq(auditLogsTable.resourceId, String(r.body.projet.id))));
    expect(traces).toHaveLength(1);
  });

  it("un second appel rend le meme chantier, sans en creer un autre", async () => {
    const d = await unDevis();
    const a = await request(appli()).post(`/api/devis/${d.id}/chantier`).send({});
    const b = await request(appli()).post(`/api/devis/${d.id}/chantier`).send({});
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.dejaOuvert).toBe(true);
    expect(b.body.projet.id).toBe(a.body.projet.id);
    expect(await chantiersDu(d.id)).toHaveLength(1);
  });

  it("deux clics simultanes n'ouvrent qu'un chantier", async () => {
    const d = await unDevis();
    const reponses = await Promise.all(Array.from({ length: 5 }, () => request(appli()).post(`/api/devis/${d.id}/chantier`).send({})));
    expect(reponses.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(reponses.map((r) => r.body.projet.id)).size).toBe(1);
    expect(await chantiersDu(d.id)).toHaveLength(1);
  });

  it("le devis d'une autre organisation reste introuvable", async () => {
    const d = await unDevis({}, ids.orgB);
    const r = await request(appli()).post(`/api/devis/${d.id}/chantier`).send({});
    expect(r.status).toBe(404);
    expect(await chantiersDu(d.id)).toHaveLength(0);
  });

  it("la base elle-meme refuse un second chantier pour le meme devis", async () => {
    const d = await unDevis();
    await db.insert(projetsTable).values({ organisationId: ids.orgA, title: "Premier", devisId: d.id });
    await expect(db.insert(projetsTable).values({ organisationId: ids.orgA, title: "Doublon", devisId: d.id })).rejects.toThrow();
    // Sans devis, aucune contrainte : les chantiers libres restent possibles.
    await db.insert(projetsTable).values([{ organisationId: ids.orgA, title: "Libre 1" }, { organisationId: ids.orgA, title: "Libre 2" }]);
  });
});

describe("accepter le devis gagne l'opportunite", () => {
  it("le prospect passe a « gagne », date comprise", async () => {
    const [p] = await db.insert(prospectsTable).values({ organisationId: ids.orgA, title: "Toiture", stage: "proposition" }).returning({ id: prospectsTable.id });
    const d = await unDevis({ status: "envoye", prospectId: p!.id });
    const r = await request(appli()).patch(`/api/devis/${d.id}`).send({ status: "accepte" });
    expect(r.status, r.text).toBe(200);
    const [apres] = await db.select().from(prospectsTable).where(eq(prospectsTable.id, p!.id));
    expect(apres!.stage).toBe("gagne");
    expect(apres!.wonAt).not.toBeNull();
  });

  it("un refus d'acceptation (role agent) ne touche pas au prospect", async () => {
    const [p] = await db.insert(prospectsTable).values({ organisationId: ids.orgA, title: "Cuisine", stage: "proposition" }).returning({ id: prospectsTable.id });
    const d = await unDevis({ status: "envoye", prospectId: p!.id });
    const r = await request(appli(ids.orgA, "agent", ids.agent)).patch(`/api/devis/${d.id}`).send({ status: "accepte" });
    expect(r.status).toBe(403);
    const [apres] = await db.select().from(prospectsTable).where(eq(prospectsTable.id, p!.id));
    expect(apres!.stage).toBe("proposition");
  });
});
