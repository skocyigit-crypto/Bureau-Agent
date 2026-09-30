/**
 * Facturer un devis par l'AUTRE chemin.
 *
 * `POST /devis/:id/convert-to-facture` applique depuis le 29/09 la regle
 * « seul un devis accepte se facture » et refuse une seconde conversion.
 * Mais `POST /factures-client` accepte lui aussi un `devisId` : il ne
 * verifiait que l'appartenance a l'organisation. On pouvait donc, par cette
 * seconde porte :
 *   - facturer un devis REFUSE, EXPIRE ou en BROUILLON, sans acceptation ;
 *   - facturer DEUX FOIS le meme devis accepte, avec deux numeros de la
 *     sequence fiscale (article 242 nonies A ann. II CGI : la suite doit
 *     rester continue et sans doublon).
 *
 * Deux portes pour une decision, c'est une porte de trop. La regle vit
 * desormais dans services/devis-facturable.ts, lue par les deux routes.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { db, devisTable, facturesClientTable, organisationsTable, usersTable } from "@workspace/db";
import devisRouter from "../routes/devis";
import facturesRouter from "../routes/factures-client";

const stamp = Date.now();
const JOUR = 24 * 60 * 60 * 1000;
const ids: Record<string, number> = {};

function appli(orgId = ids.orgA) {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: ids.admin, organisationId: orgId, userRole: "administrateur", userEmail: `dc-${stamp}@exemple.test` };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", devisRouter);
  a.use("/api", facturesRouter);
  return a;
}

async function unDevis(v: Record<string, unknown> = {}, orgId = ids.orgA) {
  const [d] = await db.insert(devisTable).values({
    organisationId: orgId, reference: `DV2-${stamp}-${Math.random().toString(36).slice(2, 8)}`,
    title: "Isolation", clientName: "SCI Duval", items: [],
    subtotal: "1000.00", taxAmount: "200.00", totalAmount: "1200.00",
    status: "accepte", validUntil: new Date(Date.now() + 30 * JOUR), ...v,
  } as any).returning();
  return d!;
}
const facturesDu = (devisId: number) => db.select().from(facturesClientTable).where(eq(facturesClientTable.devisId, devisId));
const relire = async (id: number) => (await db.select().from(devisTable).where(eq(devisTable.id, id)))[0]!;

/** Ce que l'ecran de facturation envoie, `devisId` compris. */
const corpsFacture = (devisId: number) => ({
  title: `Facture du devis ${devisId}`, clientName: "SCI Duval", devisId,
  items: [{ description: "Isolation", quantity: 1, unitPrice: 1000, taxRate: 20 }],
});

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({ name: `DeuxChemins ${stamp}`, slug: `deux-chemins-${stamp}`, maxUsers: 5, actif: true }).returning({ id: organisationsTable.id });
  ids.orgA = o!.id;
  const [u] = await db.insert(usersTable).values({ organisationId: ids.orgA, email: `dc-${stamp}@exemple.test`, passwordHash: "x", prenom: "Ada", nom: "Admin", role: "administrateur", actif: true }).returning({ id: usersTable.id });
  ids.admin = u!.id;
});

afterAll(async () => {
  try {
    await db.delete(facturesClientTable).where(eq(facturesClientTable.organisationId, ids.orgA));
    await db.delete(devisTable).where(eq(devisTable.organisationId, ids.orgA));
    await db.delete(organisationsTable).where(inArray(organisationsTable.id, [ids.orgA]));
  } catch { /* le journal d'audit peut retenir l'organisation */ }
});

describe("POST /factures-client refuse ce que la conversion refuse deja", () => {
  it.each([
    ["brouillon", "devis_non_accepte"],
    ["envoye", "devis_non_accepte"],
    ["refuse", "devis_refuse"],
  ])("un devis %s ne devient pas une facture par ce chemin", async (statut, code) => {
    const d = await unDevis({ status: statut });
    const r = await request(appli()).post("/api/factures-client").send(corpsFacture(d.id));
    expect(r.status, r.text.slice(0, 200)).toBe(409);
    expect(r.body.code).toBe(code);
    expect(await facturesDu(d.id)).toHaveLength(0);
  });

  it("un devis perime non plus", async () => {
    const d = await unDevis({ status: "envoye", validUntil: new Date(Date.now() - 400 * JOUR) });
    const r = await request(appli()).post("/api/factures-client").send(corpsFacture(d.id));
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("devis_expire");
    expect(await facturesDu(d.id)).toHaveLength(0);
  });

  it("un devis accepte se facture, et le devis en garde la trace", async () => {
    const d = await unDevis();
    const r = await request(appli()).post("/api/factures-client").send(corpsFacture(d.id));
    expect(r.status, r.text.slice(0, 200)).toBe(201);
    expect((await relire(d.id)).convertedToInvoice, "le devis ne sait pas qu'il est facture").toBe(r.body.id);
  });
});

describe("un devis n'a jamais deux factures", () => {
  it("le meme chemin refuse la seconde et nomme la premiere", async () => {
    const d = await unDevis();
    const a = await request(appli()).post("/api/factures-client").send(corpsFacture(d.id));
    expect(a.status).toBe(201);
    const b = await request(appli()).post("/api/factures-client").send(corpsFacture(d.id));
    expect(b.status, "une seconde facture a ete emise pour le meme devis").toBe(409);
    expect(b.body.code).toBe("devis_deja_facture");
    expect(b.body.facture?.id).toBe(a.body.id);
    expect(await facturesDu(d.id)).toHaveLength(1);
  });

  it("l'autre chemin (convert-to-facture) rend la facture existante au lieu d'en creer une", async () => {
    const d = await unDevis();
    const a = await request(appli()).post("/api/factures-client").send(corpsFacture(d.id));
    expect(a.status).toBe(201);
    const b = await request(appli()).post(`/api/devis/${d.id}/convert-to-facture`).send({});
    expect(b.status).toBe(200);
    expect(b.body.alreadyConverted).toBe(true);
    expect(b.body.facture?.id).toBe(a.body.id);
    expect(await facturesDu(d.id), "deux numeros de la sequence fiscale pour un seul devis").toHaveLength(1);
  });

  it("et dans l'autre sens : converti d'abord, la creation directe est refusee", async () => {
    const d = await unDevis();
    const a = await request(appli()).post(`/api/devis/${d.id}/convert-to-facture`).send({});
    expect(a.status).toBe(201);
    const b = await request(appli()).post("/api/factures-client").send(corpsFacture(d.id));
    expect(b.status).toBe(409);
    expect(b.body.code).toBe("devis_deja_facture");
    expect(await facturesDu(d.id)).toHaveLength(1);
  });

  it("une facture sans devis reste possible : la porte normale ne se ferme pas", async () => {
    const r = await request(appli()).post("/api/factures-client").send({
      title: "Facture libre", clientName: "Client direct",
      items: [{ description: "Depannage", quantity: 1, unitPrice: 300, taxRate: 20 }],
    });
    expect(r.status, r.text.slice(0, 200)).toBe(201);
  });
});
