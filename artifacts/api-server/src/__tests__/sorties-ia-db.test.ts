/**
 * Sur la vraie base : le compte rendu d'appel AJOUTE son resume aux notes
 * (il les ecrasait), ses rendez-vous arrivent en attente et marques IA, et
 * une tache creee par un agent a toujours une priorite que l'ecran connait.
 * Seul le modele est simule.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { db, organisationsTable, usersTable, callsTable, calendarEventsTable, tasksTable } from "@workspace/db";

const modele = vi.hoisted(() => ({ reponse: "" }));
vi.mock("../services/ai-client", async (orig) => ({
  ...(await orig<typeof import("../services/ai-client")>()),
  aiForOrg: async () => ({ models: { generateContent: async () => ({ text: modele.reponse }) } }),
}));
vi.mock("../services/ai-quota", async (orig) => ({ ...(await orig<typeof import("../services/ai-quota")>()), assertAiQuota: async () => {} }));

const { default: commandantRouter } = await import("../routes/ai-commandant");
const { creerTacheIa, AGENTS } = await import("../services/tache-ia");

const stamp = Date.now();
let orgId = 0, userId = 0, appelId = 0;

function app() {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organisationId: orgId, userRole: "administrateur", userEmail: "c@x.test" };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", commandantRouter);
  return a;
}

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({ name: `Sorties IA ${stamp}`, slug: `sorties-ia-${stamp}`, maxUsers: 5, actif: true }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [u] = await db.insert(usersTable).values({ organisationId: orgId, email: `sorties-${stamp}@exemple.test`, passwordHash: "x", prenom: "S", nom: "IA", role: "administrateur", actif: true }).returning({ id: usersTable.id });
  userId = u!.id;
  const [c] = await db.insert(callsTable).values({ organisationId: orgId, phoneNumber: "0601", direction: "entrant", status: "termine", notes: "Note de la personne : client presse, rappeler avant jeudi." }).returning({ id: callsTable.id });
  appelId = c!.id;
}, 60_000);

afterAll(async () => {
  try {
    await db.delete(calendarEventsTable).where(eq(calendarEventsTable.organisationId, orgId));
    await db.delete(tasksTable).where(eq(tasksTable.organisationId, orgId));
    await db.delete(callsTable).where(eq(callsTable.organisationId, orgId));
  } catch { /* base jetable */ }
});

describe("compte rendu d'appel", () => {
  let corps: any;
  beforeAll(async () => {
    const dans3 = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
    modele.reponse = JSON.stringify({
      summary: "Le client veut un devis pour une cuisine.",
      sentiment: "enthousiaste",
      topics: ["devis", 42, "cuisine"],
      tasksToCreate: [{ title: "Envoyer le devis", priority: "urgentissime" }, { title: "" }],
      appointmentsToCreate: [{ title: "Visite", date: dans3, time: "14:30" }, { title: "Fantome", date: "jeudi" }],
    });
    const r = await request(app()).post("/api/commandant/call-compile").send({ callId: appelId, notes: "rappel", callerName: "Paul" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    corps = r.body;
  });

  it("les notes de la personne sont gardees, le resume s'y ajoute", async () => {
    const [c] = await db.select().from(callsTable).where(eq(callsTable.id, appelId));
    expect(c!.notes).toContain("client presse, rappeler avant jeudi");
    expect(c!.notes).toContain("[Resume IA] Le client veut un devis");
  });
  it("un sentiment inconnu devient « neutre », les sujets non textuels sont ecartes", async () => {
    const [c] = await db.select().from(callsTable).where(eq(callsTable.id, appelId));
    expect(c!.sentiment).toBe("neutre");
    expect(c!.tags).toEqual(["devis", "cuisine"]);
  });
  it("la tache sans titre est ecartee, l'autre creee avec une priorite connue", async () => {
    expect(corps.createdTasks).toHaveLength(1);
    const [t] = await db.select().from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), eq(tasksTable.title, "Envoyer le devis")));
    expect(t!.priority).toBe("moyenne");
  });
  it("le rendez-vous a date illisible n'est pas cree ; l'autre l'est, en attente, marque IA", async () => {
    const evts = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.organisationId, orgId));
    expect(evts).toHaveLength(1);
    expect(evts[0]!.status).toBe("en_attente");
    expect(evts[0]!.description).toMatch(/Propose par l'IA/);
    expect(evts[0]!.title).toBe("[Appel] Visite");
  });
});

describe("creerTacheIa borne ce que les modeles lui passent", () => {
  it("priorite inconnue -> « moyenne », synonyme -> la bonne", async () => {
    const a = await creerTacheIa({ organisationId: orgId, agent: AGENTS.commandant, nature: "administratif", title: "Priorite A", priority: "urgente" });
    const b = await creerTacheIa({ organisationId: orgId, agent: AGENTS.commandant, nature: "administratif", title: "Priorite B", priority: "p0!!" });
    const lire = async (id: number) => (await db.select({ p: tasksTable.priority }).from(tasksTable).where(eq(tasksTable.id, id)))[0]!.p;
    expect(await lire(a.id)).toBe("haute");
    expect(await lire(b.id)).toBe("moyenne");
  });
  it("titre vide -> libelle par defaut ; titre demesure -> tronque", async () => {
    const vide = await creerTacheIa({ organisationId: orgId, agent: AGENTS.commandant, nature: "administratif", title: "   " });
    const long = await creerTacheIa({ organisationId: orgId, agent: AGENTS.commandant, nature: "administratif", title: "y".repeat(900) });
    const titre = async (id: number) => (await db.select({ t: tasksTable.title }).from(tasksTable).where(eq(tasksTable.id, id)))[0]!.t;
    expect(await titre(vide.id)).toBe("Tache proposee par l'IA");
    expect((await titre(long.id)).length).toBe(300);
  });
});
