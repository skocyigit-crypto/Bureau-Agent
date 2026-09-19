/**
 * Un contact sans nom affichait les devis et factures de tous les autres.
 *
 * La fiche d'un contact relie ses documents par ressemblance : devis et
 * factures ne portent pas d'identifiant de contact, seulement un nom et un
 * e-mail recopies. Le nom etait transforme sans condition en `%nom%` — donc en
 * `%%` pour un contact sans prenom ni nom, motif que TOUTE chaine satisfait.
 *
 * Cas reels qui y menent : une entreprise saisie avec sa seule raison sociale,
 * un import CSV incomplet, un contact cree depuis un appel entrant. La fiche
 * affichait alors les montants de tous les clients de l'organisation, avec
 * l'aplomb d'une liste filtree.
 *
 * Les controles ci-dessous passent par une vraie base pour la partie SQL :
 * c'est Postgres qui decide ce que `%%` ramene, pas la lecture du code.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, contactsTable, devisTable, facturesClientTable, organisationsTable, usersTable } from "@workspace/db";
import contactsRouter from "../routes/contacts";
import { motifDeRapprochement, nomDeRapprochement } from "../lib/rapprochement-contact";

const stamp = Date.now();
let orgId = 0, userId = 0, contactSansNom = 0, contactNomme = 0;

function appli() {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organisationId: orgId, userRole: "administrateur" };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", contactsRouter);
  return a;
}

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Rappro ${stamp}`, slug: `rappro-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [u] = await db.insert(usersTable).values({
    organisationId: orgId, email: `rappro-${stamp}@example.test`,
    passwordHash: "x", prenom: "R", nom: "A", role: "administrateur", actif: true,
  }).returning({ id: usersTable.id });
  userId = u!.id;

  const [sansNom] = await db.insert(contactsTable).values({
    organisationId: orgId, firstName: "", lastName: "", company: `Batiment ${stamp}`, phone: "0100000001",
  } as any).returning({ id: contactsTable.id });
  contactSansNom = sansNom!.id;

  const [nomme] = await db.insert(contactsTable).values({
    organisationId: orgId, firstName: "Jeanne", lastName: "Martin", phone: "0100000002",
  } as any).returning({ id: contactsTable.id });
  contactNomme = nomme!.id;

  // Les documents d'un TIERS: ils ne doivent apparaitre sur aucune des deux
  // fiches.
  await db.insert(devisTable).values({
    organisationId: orgId, reference: `DEV-${stamp}`, title: "Toiture",
    clientName: "Dupont SARL", clientEmail: `dupont-${stamp}@example.test`,
    items: [], subtotal: "1000.00", taxAmount: "200.00", totalAmount: "1200.00", status: "envoye",
  } as any);
  await db.insert(facturesClientTable).values({
    organisationId: orgId, reference: `FAC-${stamp}`, title: "Toiture",
    clientName: "Dupont SARL", clientEmail: `dupont-${stamp}@example.test`,
    items: [], subtotal: "1000.00", taxAmount: "200.00", totalAmount: "1200.00",
    paidAmount: "0", currency: "EUR", status: "envoyee",
  } as any);
}, 60_000);

afterAll(async () => {
  try { await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId)); } catch { /* journaux */ }
});

describe("ce qui compte pour un nom", () => {
  it("un contact sans nom n'en fournit aucun", () => {
    expect(nomDeRapprochement("", ""), "`%%` est satisfait par toute chaine").toBeNull();
  });

  it("des champs absents non plus", () => {
    expect(nomDeRapprochement(null, undefined)).toBeNull();
  });

  it("`null` ne devient pas le mot « null »", () => {
    // `${null}` donne « null »: le nom devenait « null Martin ».
    expect(nomDeRapprochement(null, "Martin")).toBe("Martin");
  });

  it("une seule lettre ne suffit pas", () => {
    expect(motifDeRapprochement("A", ""), "`%A%` ramene un client sur deux").toBeNull();
  });

  it("un nom complet donne bien un motif", () => {
    expect(motifDeRapprochement("Jeanne", "Martin")).toBe("%Jeanne Martin%");
  });

  it("les espaces superflus ne font pas un nom", () => {
    expect(motifDeRapprochement("   ", "  ")).toBeNull();
  });

  it("un nom de famille seul reste exploitable", () => {
    expect(motifDeRapprochement("", "Martin")).toBe("%Martin%");
  });
});

describe("la fiche d'un contact sans nom", () => {
  it("n'affiche aucun devis d'un autre client", async () => {
    const r = await request(appli()).get(`/api/contacts/${contactSansNom}/devis`);
    expect(r.status).toBe(200);
    const refs = (r.body.devis ?? r.body.devisList ?? []).map((d: any) => d.reference);
    expect(refs, "la fiche montrait les devis de tous les clients de l'organisation")
      .not.toContain(`DEV-${stamp}`);
  });

  it("ni aucune facture", async () => {
    const r = await request(appli()).get(`/api/contacts/${contactSansNom}/devis`);
    const refs = (r.body.factures ?? []).map((f: any) => f.reference);
    expect(refs).not.toContain(`FAC-${stamp}`);
  });

  it("et rend une liste vide, pas une erreur", async () => {
    const r = await request(appli()).get(`/api/contacts/${contactSansNom}/devis`);
    expect(r.status).toBe(200);
  });
});

describe("la fiche d'un contact nomme, qui n'est pas le client", () => {
  it("n'affiche pas les documents d'un homonyme absent", async () => {
    const r = await request(appli()).get(`/api/contacts/${contactNomme}/devis`);
    const refs = (r.body.devis ?? []).map((d: any) => d.reference);
    expect(refs).not.toContain(`DEV-${stamp}`);
  });

  it("le rapprochement par nom fonctionne toujours", async () => {
    // Garde-fou: un correctif qui ne rapprocherait plus RIEN passerait tous
    // les controles ci-dessus sans rien resoudre.
    await db.insert(devisTable).values({
      organisationId: orgId, reference: `DEV-JM-${stamp}`, title: "Salle de bain",
      clientName: "Jeanne Martin", clientEmail: `jm-${stamp}@example.test`,
      items: [], subtotal: "500.00", taxAmount: "100.00", totalAmount: "600.00", status: "envoye",
    } as any);
    const r = await request(appli()).get(`/api/contacts/${contactNomme}/devis`);
    const refs = (r.body.devis ?? []).map((d: any) => d.reference);
    expect(refs, "le rapprochement par nom ne doit pas avoir ete casse").toContain(`DEV-JM-${stamp}`);
  });
});
