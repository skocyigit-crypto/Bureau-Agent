/**
 * Un enregistrement ne pointe que vers des lignes de SA organisation.
 *
 * Mesure du 28/09 : tache (relatedContactId, relatedCallId), appel
 * (contactId), rendez-vous (relatedContactId, relatedTaskId), devis
 * (contactId, prospectId) et facture (contactId) ecrivaient l'identifiant
 * recu sans verifier son organisation. Une tache pointant l'appel d'une autre
 * organisation bloquait l'analyse IA de cet appel chez elle ; la cle etrangere
 * repondait 500 (inexistant) ou 2xx (existant ailleurs) — un sondage des
 * identifiants de la plateforme.
 *
 * Le dernier bloc derive la liste des champs a verifier des SCHEMAS de
 * validation, pas du texte des routes : une ecriture par \`...parsed.data\`
 * ne nomme pas le champ, un detecteur lexical ne la verrait pas (lecon
 * rapportee par la session BatiFlow le 28/09).
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { callsTable, contactsTable, db, insertCalendarEventSchema, organisationsTable, prospectsTable, tasksTable } from "@workspace/db";
import { CreateTaskBody, UpdateCallBody, UpdateTaskBody } from "@workspace/api-zod";
import { referenceOuNull, referencesRefusees } from "../services/appartenance";
import tasksRouter from "../routes/tasks";
import callsRouter from "../routes/calls";
import devisRouter from "../routes/devis";
import facturesRouter from "../routes/factures-client";

const SRC = join(import.meta.dirname, "..");
const stamp = Date.now();
let A = 0, B = 0;
let contactA = 0, contactB = 0, appelA = 0, appelB = 0, prospectB = 0, tacheB = 0;

function app(orgId: number, ...routers: express.Router[]) {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: undefined, organisationId: orgId, userRole: "administrateur" };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  for (const r of routers) a.use("/api", r);
  return a;
}

beforeAll(async () => {
  for (const suffixe of ["a", "b"]) {
    const [o] = await db.insert(organisationsTable).values({
      name: `Appartenance ${suffixe} ${stamp}`, slug: `appartenance-${suffixe}-${stamp}`, maxUsers: 5, actif: true,
    }).returning({ id: organisationsTable.id });
    if (suffixe === "a") A = o!.id; else B = o!.id;
  }
  const contact = async (org: number) => (await db.insert(contactsTable).values({ organisationId: org, firstName: "C", lastName: `${org}`, phone: "+33611223344" }).returning({ id: contactsTable.id }))[0]!.id;
  const appel = async (org: number) => (await db.insert(callsTable).values({ organisationId: org, phoneNumber: "+33600000000", direction: "entrant", status: "termine" }).returning({ id: callsTable.id }))[0]!.id;
  contactA = await contact(A); contactB = await contact(B);
  appelA = await appel(A); appelB = await appel(B);
  prospectB = (await db.insert(prospectsTable).values({ organisationId: B, title: "Prospect B" }).returning({ id: prospectsTable.id }))[0]!.id;
  tacheB = (await db.insert(tasksTable).values({ organisationId: B, title: "Tache B" }).returning({ id: tasksTable.id }))[0]!.id;
}, 60_000);

afterAll(async () => {
  try {
    for (const o of [A, B]) {
      await db.delete(tasksTable).where(eq(tasksTable.organisationId, o));
      await db.delete(callsTable).where(eq(callsTable.organisationId, o));
    }
  } catch { /* base de CI jetable */ }
});

describe("referencesRefusees", () => {
  it("un lien absent est accepte ; un lien vers SA ligne aussi", async () => {
    expect(await referencesRefusees(A, [
      { champ: "a", genre: "contact", valeur: null }, { champ: "b", genre: "contact", valeur: undefined },
      { champ: "c", genre: "contact", valeur: "" }, { champ: "d", genre: "contact", valeur: contactA },
      { champ: "e", genre: "appel", valeur: String(appelA) },
    ])).toEqual([]);
  });

  it("la ligne d'une autre organisation est refusee, comme une ligne inexistante ou un identifiant illisible", async () => {
    expect(await referencesRefusees(A, [
      { champ: "autre", genre: "contact", valeur: contactB },
      { champ: "inexistant", genre: "contact", valeur: 2_000_000_000 },
      { champ: "texte", genre: "appel", valeur: "abc" },
      { champ: "negatif", genre: "tache", valeur: -3 },
      { champ: "decimal", genre: "prospect", valeur: 1.5 },
    ])).toEqual(["autre", "inexistant", "texte", "negatif", "decimal"]);
  });

  it("chemins IA : l'identifiant d'ailleurs devient « pas de lien », pas une erreur", async () => {
    expect(await referenceOuNull(A, "contact", contactA)).toBe(contactA);
    expect(await referenceOuNull(A, "contact", contactB)).toBeNull();
    expect(await referenceOuNull(A, "contact", null)).toBeNull();
  });
});

describe("routes : une reference d'ailleurs est refusee, sans rien dire des autres", () => {
  it("tache pointant l'appel d'une autre organisation : 400, rien d'ecrit", async () => {
    const r = await request(app(A, tasksRouter)).post("/api/tasks").send({ title: "Rappeler", status: "en_attente", priority: "moyenne", relatedCallId: appelB });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/relatedCallId/);
    expect(await db.select().from(tasksTable).where(eq(tasksTable.relatedCallId, appelB))).toEqual([]);
  });

  it("meme reponse pour un identifiant qui n'existe nulle part (pas de sondage possible)", async () => {
    const ailleurs = await request(app(A, tasksRouter)).post("/api/tasks").send({ title: "X", status: "en_attente", priority: "moyenne", relatedContactId: contactB });
    const nulle = await request(app(A, tasksRouter)).post("/api/tasks").send({ title: "X", status: "en_attente", priority: "moyenne", relatedContactId: 2_000_000_000 });
    expect(ailleurs.status).toBe(400);
    expect(nulle.status).toBe(400);
    // C'est bien le refus de la reference (et pas une erreur de validation
    // qui rendrait les deux reponses egales pour une autre raison).
    expect(ailleurs.body.error).toMatch(/relatedContactId/);
    expect(nulle.body).toEqual(ailleurs.body);
  });

  it("sa propre reference passe", async () => {
    const r = await request(app(A, tasksRouter)).post("/api/tasks").send({ title: "Rappeler", status: "en_attente", priority: "moyenne", relatedCallId: appelA, relatedContactId: contactA });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  });

  it("modifier une tache pour la lier au contact d'une autre organisation : 400", async () => {
    const [t] = await db.insert(tasksTable).values({ organisationId: A, title: "T" } as any).returning({ id: tasksTable.id });
    const r = await request(app(A, tasksRouter)).patch(`/api/tasks/${t!.id}`).send({ relatedContactId: contactB });
    expect(r.status).toBe(400);
    const [apres] = await db.select().from(tasksTable).where(eq(tasksTable.id, t!.id));
    expect(apres!.relatedContactId).toBeNull();
  });

  it("modifier un appel pour le lier au contact d'une autre organisation : 400", async () => {
    const r = await request(app(A, callsRouter)).patch(`/api/calls/${appelA}`).send({ contactId: contactB });
    expect(r.status).toBe(400);
  });

  it("devis rattache au prospect d'une autre organisation : 400", async () => {
    const r = await request(app(A, devisRouter)).post("/api/devis").send({ title: "Cuisine", clientName: "M. X", prospectId: prospectB, items: [] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/prospectId/);
  });

  it("facture rattachee au contact d'une autre organisation : 400", async () => {
    const r = await request(app(A, facturesRouter)).post("/api/factures-client").send({ title: "Travaux", clientName: "M. X", contactId: contactB, items: [] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/contactId/);
  });

  it("une tache d'ailleurs ne bloque plus l'analyse de l'appel (« deja traite » filtre l'organisation)", () => {
    const cp = readFileSync(join(SRC, "services", "call-processor.ts"), "utf8");
    const ligne = cp.slice(cp.indexOf("const existingTasks"), cp.indexOf(".limit(1)", cp.indexOf("const existingTasks")));
    expect(ligne).toMatch(/eq\(tasksTable\.organisationId, orgId\)/);
    void tacheB;
  });
});

describe("les champs verifies sont tires des SCHEMAS, pas du texte des routes", () => {
  // Tout champ « ...Id » (hors id/organisationId) d'un corps accepte doit etre
  // passe a referencesRefusees par la route — y compris quand elle ecrit par
  // spread (\`...parsed.data\`) sans jamais nommer le champ.
  // Identifiants EXTERNES (Google), pas des lignes d une organisation.
  const PAS_UNE_REFERENCE = new Set(["organisationId", "id", "googleEventId", "createdBy", "updatedBy"]);
  const clesFk = (schema: { shape: Record<string, unknown> }) =>
    Object.keys(schema.shape).filter((k) => /Id$/.test(k) && !PAS_UNE_REFERENCE.has(k));
  const verifiees = (fichier: string) => {
    const src = readFileSync(join(SRC, "routes", fichier), "utf8");
    return new Set([...src.matchAll(/champ: "([A-Za-z]+Id)"/g)].map((m) => m[1]!));
  };

  it.each([
    ["tasks.ts", CreateTaskBody], ["tasks.ts", UpdateTaskBody], ["calls.ts", UpdateCallBody],
    ["calendar.ts", insertCalendarEventSchema],
  ] as const)("%s verifie chaque cle etrangere de son schema", (fichier, schema) => {
    const cles = clesFk(schema as any);
    expect(cles.length).toBeGreaterThan(0);
    const v = verifiees(fichier);
    expect(cles.filter((k) => !v.has(k))).toEqual([]);
  });
});
