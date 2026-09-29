/**
 * Sur la vraie base : une extraction ecrit sa trace AVANT de rendre le
 * fichier, la trace porte l'organisation, et la copie de ses propres donnees
 * rend les appreciations portees sur la personne — les siennes seulement.
 *
 * Le pendant structurel (toutes les routes, tous les appels) est
 * exports-traces.test.ts ; ici on verifie que la trace existe vraiment en
 * base apres la requete, et ce que la personne recoit.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import {
  db, organisationsTable, usersTable, contactsTable, messagesTable,
  performanceReportsTable, aiAgentReportsTable, auditLogsTable,
} from "@workspace/db";
import contactsRouter from "../routes/contacts";
import messagesRouter from "../routes/messages";
import dataProtectionRouter from "../routes/data-protection";

const stamp = Date.now();
const ids = { orgA: 0, orgB: 0, orgH: 0, marie: 0, paul: 0, lecteur: 0, bea: 0, lea1: 0 };

function app(orgId: number, userId: number, role: string, email: string) {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organisationId: orgId, userRole: role, userEmail: email };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", contactsRouter);
  a.use("/api", messagesRouter);
  a.use("/api", dataProtectionRouter);
  return a;
}
const marie = () => app(ids.orgA, ids.marie, "administrateur", `marie-${stamp}@exemple.test`);

async function traces(orgId: number, ressource: string) {
  return db.select().from(auditLogsTable).where(and(
    eq(auditLogsTable.organisationId, orgId), eq(auditLogsTable.action, "export"), eq(auditLogsTable.resource, ressource),
  ));
}

async function utilisateur(orgId: number, prenom: string, nom: string, role: string) {
  const [u] = await db.insert(usersTable).values({
    organisationId: orgId, email: `${prenom}-${nom}-${stamp}-${Math.random().toString(36).slice(2, 7)}@exemple.test`.toLowerCase(),
    passwordHash: "x", prenom, nom, role, actif: true,
  }).returning({ id: usersTable.id });
  return u!.id;
}

const rapportEquipe = {
  diagnose: {
    bireysel_teshis: [
      { nom: "Marie Martin", durum: "dikkat", teshis: "Retards repetes sur les rappels." },
      { nom: "Paul Durand", durum: "kritik", teshis: "Heures supplementaires elevees." },
    ],
  },
};

beforeAll(async () => {
  for (const k of ["orgA", "orgB", "orgH"] as const) {
    const [o] = await db.insert(organisationsTable).values({ name: `Traces ${k} ${stamp}`, slug: `traces-${k.toLowerCase()}-${stamp}`, maxUsers: 10, actif: true }).returning({ id: organisationsTable.id });
    ids[k] = o!.id;
  }
  ids.marie = await utilisateur(ids.orgA, "Marie", "Martin", "administrateur");
  ids.paul = await utilisateur(ids.orgA, "Paul", "Durand", "agent");
  ids.lecteur = await utilisateur(ids.orgA, "Luc", "Lecteur", "lecture_seule");
  ids.bea = await utilisateur(ids.orgB, "Bea", "Blanc", "administrateur");
  ids.lea1 = await utilisateur(ids.orgH, "Lea", "Roux", "administrateur");
  await utilisateur(ids.orgH, "Lea", "Roux", "agent");

  await db.insert(contactsTable).values([
    { organisationId: ids.orgA, firstName: "Jean", lastName: "Client", phone: "0600000001" },
    { organisationId: ids.orgA, firstName: "Anne", lastName: "Cliente", phone: "0600000002" },
  ]);
  await db.insert(messagesTable).values({ organisationId: ids.orgA, phoneNumber: "0600000003", content: "Rappeler svp" });
  const periode = { periode: "semaine", dateDebut: new Date(Date.now() - 7 * 86400_000), dateFin: new Date() };
  await db.insert(performanceReportsTable).values([
    { ...periode, organisationId: ids.orgA, userId: ids.marie, userName: "Marie Martin", scoreGlobal: 71, analyseIA: "Bonne tenue des rendez-vous." },
    { ...periode, organisationId: ids.orgA, userId: ids.paul, userName: "Paul Durand", scoreGlobal: 42, analyseIA: "Surcharge constatee." },
  ]);
  await db.insert(aiAgentReportsTable).values([
    { organisationId: ids.orgA, agentId: "workforce", agentName: "Agent RH", reportDate: "2026-09-28", summary: "Critiques : Paul Durand", details: rapportEquipe },
    { organisationId: ids.orgB, agentId: "workforce", agentName: "Agent RH", reportDate: "2026-09-28", summary: "Suivi : Marie Martin (homonyme d'une autre organisation)", details: {} },
  ]);
}, 60_000);

afterAll(async () => {
  // Les traces d'audit sont append-only : elles restent, rattachees a des
  // organisations de test au nom horodate.
  try {
    for (const o of [ids.orgA, ids.orgB, ids.orgH]) {
      await db.delete(aiAgentReportsTable).where(eq(aiAgentReportsTable.organisationId, o));
      await db.delete(performanceReportsTable).where(eq(performanceReportsTable.organisationId, o));
      await db.delete(messagesTable).where(eq(messagesTable.organisationId, o));
      await db.delete(contactsTable).where(eq(contactsTable.organisationId, o));
    }
  } catch { /* base jetable */ }
});

describe("un export CSV ecrit sa trace, avec l'organisation", () => {
  it("contacts : 200, et une trace « export / contacts » de SON organisation", async () => {
    const r = await request(marie()).get("/api/contacts/export/csv");
    expect(r.status).toBe(200);
    const t = await traces(ids.orgA, "contacts");
    expect(t).toHaveLength(1);
    expect(t[0]!.userId).toBe(ids.marie);
    expect(t[0]!.details).toMatchObject({ format: "csv", lignes: 2, chemin: "/api/contacts/export/csv" });
  });

  it("aucune trace n'est ecrite au nom d'une autre organisation", async () => {
    expect(await traces(ids.orgB, "contacts")).toEqual([]);
  });

  it("un export refuse (lecture seule) n'ecrit pas de trace d'extraction", async () => {
    const avant = (await traces(ids.orgA, "contacts")).length;
    const r = await request(app(ids.orgA, ids.lecteur, "lecture_seule", "l@x.test")).get("/api/contacts/export/csv");
    expect(r.status).toBe(403);
    expect((await traces(ids.orgA, "contacts")).length).toBe(avant);
  });

  it("messages (export en flux) : la trace est la avant la fin du fichier", async () => {
    const r = await request(marie()).get("/api/messages/export/csv");
    expect(r.status).toBe(200);
    expect(r.text).toContain("Rappeler svp");
    expect(await traces(ids.orgA, "messages")).toHaveLength(1);
  });
});

describe("export RGPD de l'organisation (portabilite)", () => {
  it("trace « portabilite » avec les volumes exportes", async () => {
    const r = await request(marie()).post("/api/data-protection/export").send({});
    expect(r.status).toBe(200);
    const t = await traces(ids.orgA, "portabilite");
    expect(t).toHaveLength(1);
    expect((t[0]!.details as { statistiques: { totalContacts: number } }).statistiques.totalContacts).toBe(2);
  });
});

describe("la copie de ses propres donnees", () => {
  let corps: any;
  beforeAll(async () => {
    const r = await request(marie()).get("/api/data-protection/my-data");
    expect(r.status).toBe(200);
    corps = r.body;
  });

  it("est tracee", async () => {
    expect(await traces(ids.orgA, "donnees_personnelles")).toHaveLength(1);
  });

  it("rend SON rapport de performance", () => {
    const rp = corps.data.evaluations.rapportsPerformance;
    expect(rp).toHaveLength(1);
    expect(rp[0].scoreGlobal).toBe(71);
  });

  it("ne rend pas celui du collegue", () => {
    expect(JSON.stringify(corps.data.evaluations)).not.toContain("Surcharge constatee");
  });

  it("rend sa fiche du rapport d'equipe, et pas celle du collegue", () => {
    const re = corps.data.evaluations.rapportsEquipe;
    expect(Array.isArray(re)).toBe(true);
    expect(JSON.stringify(re)).toContain("Retards repetes");
    expect(JSON.stringify(re)).not.toContain("Heures supplementaires");
  });

  it("un rapport d'une autre organisation qui cite le meme nom n'est pas rendu", () => {
    expect(JSON.stringify(corps.data.evaluations)).not.toContain("homonyme d'une autre organisation");
  });

  it("avec un homonyme dans l'organisation, rien n'est extrait et c'est dit", async () => {
    const r = await request(app(ids.orgH, ids.lea1, "administrateur", "lea@x.test")).get("/api/data-protection/my-data");
    expect(r.status).toBe(200);
    expect(r.body.data.evaluations.rapportsEquipe.nonExtrait).toMatch(/meme nom/);
  });
});
