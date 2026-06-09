/**
 * Outils résolveurs nom -> id de l'assistant (find_contact, find_task,
 * find_event, find_recent_call), vérifiés DE BOUT EN BOUT contre la base.
 *
 * Le modèle s'appuie sur ces outils pour transformer un nom prononcé (« reporte
 * la réunion cuisine », « le numéro d'Ali Yilmaz ») en id avant toute écriture.
 * Leur classement et leur correspondance insensible aux accents n'avaient aucun
 * test : une régression (accents non normalisés, mauvais ordre, fuite inter-org)
 * casserait silencieusement ces commandes. Cette suite verrouille :
 *
 *   - la correspondance insensible aux accents ("reunion" trouve "réunion") ;
 *   - l'ordre de classement (exact > préfixe > sous-chaîne) ;
 *   - le défaut « à venir uniquement » de find_event et son drapeau includePast ;
 *   - le filtre `status` de find_task ;
 *   - l'isolation par organisation : un résolveur ne retourne JAMAIS une ligne
 *     d'une autre organisation.
 *
 * Test À BASE DE DONNÉES : seed deux orgs isolés (ids uniques par run via
 * `stamp`), nettoyage best-effort en fin de suite.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  organisationsTable,
  usersTable,
  contactsTable,
  tasksTable,
  calendarEventsTable,
  callsTable,
} from "@workspace/db";
import { executeTool, type ToolContext } from "../services/assistant-tools";

const DAY_MS = 24 * 60 * 60 * 1000;
const stamp = Date.now();

// Deux organisations distinctes pour prouver l'isolation : tout ce qui est seedé
// dans B ne doit JAMAIS remonter dans une recherche faite avec le contexte de A.
let orgA: number;
let orgB: number;
let userA: number;
let userB: number;
let ctxA: ToolContext;

const ids = {
  contactAliExact: 0,
  contactAliciaPrefix: 0,
  contactKhalilSub: 0,
  contactAccent: 0,
  contactOtherOrg: 0,
  taskExact: 0,
  taskPrefix: 0,
  taskSub: 0,
  taskDone: 0,
  taskAccent: 0,
  eventFuture: 0,
  eventPast: 0,
  eventOtherOrg: 0,
  callOrgA: 0,
  callOtherOrg: 0,
};

async function seedOrg(label: string) {
  const [org] = await db
    .insert(organisationsTable)
    .values({
      name: `Find Tools ${label} ${stamp}`,
      slug: `find-tools-${label}-${stamp}`.toLowerCase(),
      maxUsers: 10,
      actif: true,
    })
    .returning({ id: organisationsTable.id });
  const [user] = await db
    .insert(usersTable)
    .values({
      email: `find-tools-${label}-${stamp}@example.test`,
      passwordHash: "x",
      nom: "Test",
      prenom: "Agent",
      role: "agent",
      organisationId: org.id,
      actif: true,
    })
    .returning({ id: usersTable.id });
  return { orgId: org.id, userId: user.id };
}

async function runTool(name: string, args: Record<string, unknown>) {
  const res = await executeTool(name, args, ctxA, { skipConfirmation: true });
  if (!res.ok) throw new Error(`Tool ${name} failed: ${res.error}`);
  return res.result as Record<string, unknown>;
}

beforeAll(async () => {
  const a = await seedOrg("A");
  const b = await seedOrg("B");
  orgA = a.orgId;
  userA = a.userId;
  orgB = b.orgId;
  userB = b.userId;
  ctxA = { orgId: orgA, userId: userA };

  const now = Date.now();
  const phone = `+3361${String(stamp).slice(-7)}`;

  // ---- Contacts (org A) : classement exact > préfixe > sous-chaîne ----
  // query "ali" : firstName === "ali" (exact, 95) > "alicia" (préfixe, 70) >
  // "khalil" (sous-chaîne, 40).
  const contacts = await db
    .insert(contactsTable)
    .values([
      { organisationId: orgA, firstName: "Ali", lastName: "Yilmaz", phone: `${phone}1`, category: "client" },
      { organisationId: orgA, firstName: "Alicia", lastName: "Bernard", phone: `${phone}2`, category: "client" },
      { organisationId: orgA, firstName: "Khalil", lastName: "Mansour", phone: `${phone}3`, category: "client" },
      // Accent : lastName "Léveque" doit être trouvé par "leveque".
      { organisationId: orgA, firstName: "André", lastName: "Léveque", phone: `${phone}4`, category: "client" },
      // Org B : même prénom "Ali" mais NE DOIT PAS fuiter dans une recherche org A.
      { organisationId: orgB, firstName: "Ali", lastName: "Autre", phone: `${phone}9`, category: "client" },
    ])
    .returning({ id: contactsTable.id });
  ids.contactAliExact = contacts[0].id;
  ids.contactAliciaPrefix = contacts[1].id;
  ids.contactKhalilSub = contacts[2].id;
  ids.contactAccent = contacts[3].id;
  ids.contactOtherOrg = contacts[4].id;

  // ---- Tâches (org A) : classement + filtre status + accent ----
  // query "relance" : title === "relance" (exact, 100) > "relance facture"
  // (préfixe, 70) > "appeler pour relance" (sous-chaîne, 50).
  const tasks = await db
    .insert(tasksTable)
    .values([
      { organisationId: orgA, title: "Relance", status: "en_attente" },
      { organisationId: orgA, title: "Relance facture", status: "en_attente" },
      { organisationId: orgA, title: "Appeler pour relance", status: "en_attente" },
      // Même mot mais terminée -> doit être exclue par le filtre status=en_attente.
      { organisationId: orgA, title: "Relance ancienne", status: "termine" },
      // Accent : "réunion" doit être trouvée par "reunion".
      { organisationId: orgA, title: "Préparer la réunion", status: "en_attente" },
    ])
    .returning({ id: tasksTable.id });
  ids.taskExact = tasks[0].id;
  ids.taskPrefix = tasks[1].id;
  ids.taskSub = tasks[2].id;
  ids.taskDone = tasks[3].id;
  ids.taskAccent = tasks[4].id;

  // ---- Événements (org A) : à venir uniquement par défaut + accent + isolation ----
  const future = new Date(now + 7 * DAY_MS);
  const futureEnd = new Date(now + 7 * DAY_MS + 60 * 60 * 1000);
  const past = new Date(now - 7 * DAY_MS);
  const pastEnd = new Date(now - 7 * DAY_MS + 60 * 60 * 1000);
  const events = await db
    .insert(calendarEventsTable)
    .values([
      { organisationId: orgA, title: "Réunion chantier cuisine", type: "reunion", startDate: future, endDate: futureEnd },
      { organisationId: orgA, title: "Réunion chantier cuisine", type: "reunion", startDate: past, endDate: pastEnd },
      // Org B : même titre mais ne doit pas fuiter.
      { organisationId: orgB, title: "Réunion chantier cuisine", type: "reunion", startDate: future, endDate: futureEnd },
    ])
    .returning({ id: calendarEventsTable.id });
  ids.eventFuture = events[0].id;
  ids.eventPast = events[1].id;
  ids.eventOtherOrg = events[2].id;

  // ---- Appels (org A + org B) : accent + isolation ----
  const calls = await db
    .insert(callsTable)
    .values([
      { organisationId: orgA, contactName: "Hélène Plombier", phoneNumber: `${phone}5`, direction: "entrant", status: "repondu" },
      { organisationId: orgB, contactName: "Hélène Plombier", phoneNumber: `${phone}8`, direction: "entrant", status: "repondu" },
    ])
    .returning({ id: callsTable.id });
  ids.callOrgA = calls[0].id;
  ids.callOtherOrg = calls[1].id;
});

afterAll(async () => {
  for (const orgId of [orgA, orgB]) {
    if (!orgId) continue;
    try {
      await db.delete(calendarEventsTable).where(eq(calendarEventsTable.organisationId, orgId));
      await db.delete(callsTable).where(eq(callsTable.organisationId, orgId));
      await db.delete(tasksTable).where(eq(tasksTable.organisationId, orgId));
      await db.delete(contactsTable).where(eq(contactsTable.organisationId, orgId));
      await db.delete(usersTable).where(eq(usersTable.organisationId, orgId));
      await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
    } catch {
      // best-effort : ids uniques par run (stamp).
    }
  }
});

describe("find_contact", () => {
  it("classe exact > préfixe > sous-chaîne", async () => {
    const out = await runTool("find_contact", { query: "ali", limit: 10 });
    const list = out.contacts as Array<{ id: number; firstName: string; pertinence: number }>;
    const idx = (id: number) => list.findIndex((c) => c.id === id);
    expect(idx(ids.contactAliExact)).toBeGreaterThanOrEqual(0);
    expect(idx(ids.contactAliExact)).toBeLessThan(idx(ids.contactAliciaPrefix));
    expect(idx(ids.contactAliciaPrefix)).toBeLessThan(idx(ids.contactKhalilSub));
    const byId = new Map(list.map((c) => [c.id, c.pertinence]));
    expect(byId.get(ids.contactAliExact)!).toBeGreaterThan(byId.get(ids.contactAliciaPrefix)!);
    expect(byId.get(ids.contactAliciaPrefix)!).toBeGreaterThan(byId.get(ids.contactKhalilSub)!);
  });

  it("trouve une correspondance insensible aux accents (leveque -> Léveque)", async () => {
    const out = await runTool("find_contact", { query: "leveque" });
    const list = out.contacts as Array<{ id: number }>;
    expect(list.some((c) => c.id === ids.contactAccent)).toBe(true);
  });

  it("n'expose jamais un contact d'une autre organisation", async () => {
    const out = await runTool("find_contact", { query: "ali", limit: 20 });
    const list = out.contacts as Array<{ id: number }>;
    expect(list.some((c) => c.id === ids.contactOtherOrg)).toBe(false);
  });
});

describe("find_task", () => {
  it("classe exact > préfixe > sous-chaîne", async () => {
    const out = await runTool("find_task", { query: "relance", limit: 10 });
    const list = out.tasks as Array<{ id: number; pertinence: number }>;
    const idx = (id: number) => list.findIndex((t) => t.id === id);
    expect(idx(ids.taskExact)).toBeGreaterThanOrEqual(0);
    expect(idx(ids.taskExact)).toBeLessThan(idx(ids.taskPrefix));
    expect(idx(ids.taskPrefix)).toBeLessThan(idx(ids.taskSub));
  });

  it("respecte le filtre status (n'inclut pas les tâches d'un autre statut)", async () => {
    const out = await runTool("find_task", { query: "relance", status: "en_attente", limit: 10 });
    const list = out.tasks as Array<{ id: number; status: string }>;
    expect(list.some((t) => t.id === ids.taskDone)).toBe(false);
    expect(list.every((t) => t.status === "en_attente")).toBe(true);
    // Sans filtre, la tâche terminée remonte bien (preuve que c'est le filtre,
    // pas une absence de données, qui l'exclut ci-dessus).
    const all = await runTool("find_task", { query: "relance", limit: 10 });
    const allList = all.tasks as Array<{ id: number }>;
    expect(allList.some((t) => t.id === ids.taskDone)).toBe(true);
  });

  it("trouve une correspondance insensible aux accents (reunion -> réunion)", async () => {
    const out = await runTool("find_task", { query: "reunion" });
    const list = out.tasks as Array<{ id: number }>;
    expect(list.some((t) => t.id === ids.taskAccent)).toBe(true);
  });
});

describe("find_event", () => {
  it("ne retourne que les événements à venir par défaut", async () => {
    const out = await runTool("find_event", { query: "reunion chantier", limit: 10 });
    const list = out.events as Array<{ id: number }>;
    expect(list.some((e) => e.id === ids.eventFuture)).toBe(true);
    expect(list.some((e) => e.id === ids.eventPast)).toBe(false);
  });

  it("inclut le passé avec includePast=true", async () => {
    const out = await runTool("find_event", { query: "reunion chantier", includePast: true, limit: 10 });
    const list = out.events as Array<{ id: number }>;
    expect(list.some((e) => e.id === ids.eventFuture)).toBe(true);
    expect(list.some((e) => e.id === ids.eventPast)).toBe(true);
  });

  it("n'expose jamais un événement d'une autre organisation", async () => {
    const out = await runTool("find_event", { query: "reunion chantier", includePast: true, limit: 20 });
    const list = out.events as Array<{ id: number }>;
    expect(list.some((e) => e.id === ids.eventOtherOrg)).toBe(false);
  });
});

describe("find_recent_call", () => {
  it("trouve un appel par nom de contact insensible aux accents (helene -> Hélène)", async () => {
    const out = await runTool("find_recent_call", { query: "helene" });
    const list = out.calls as Array<{ id: number }>;
    expect(list.some((c) => c.id === ids.callOrgA)).toBe(true);
  });

  it("n'expose jamais un appel d'une autre organisation", async () => {
    const out = await runTool("find_recent_call", { query: "helene", limit: 20 });
    const list = out.calls as Array<{ id: number }>;
    expect(list.some((c) => c.id === ids.callOtherOrg)).toBe(false);
  });
});
