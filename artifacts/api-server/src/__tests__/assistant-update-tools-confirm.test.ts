/**
 * Outils d'ECRITURE "mise a jour" (update_task, advance_prospect,
 * reschedule_calendar_event) verifies DE BOUT EN BOUT a travers la vraie
 * boucle de l'assistant et le flux de confirmation `/confirm`.
 *
 * Ce que ce test verrouille (et qu'un test unitaire ne peut pas) :
 *   1. Quand le modele appelle un de ces outils, la boucle (`runAssistantTurn`)
 *      N'EXECUTE PAS l'ecriture : elle persiste un `tool_call` et emet un
 *      evenement `pending_action` dont le `summary` est EXACTEMENT le texte de
 *      `summarize()` de l'outil (c'est ce que la carte de confirmation affiche).
 *   2. `resolvePendingAction(..., "approve")` (= ce que fait la route
 *      `/assistant/confirm`) execute reellement l'outil avec `skipConfirmation`
 *      et la LIGNE EN BASE change (statut / etape / dates), puis persiste un
 *      `tool_pending_resolved` avec `success: true`.
 *   3. `resolvePendingAction(..., "reject")` NE TOUCHE PAS la ligne et persiste
 *      un `tool_pending_resolved` `cancelled: true`.
 *   4. Garde multi-tenant : un id appartenant a une AUTRE organisation renvoie
 *      "introuvable" et n'ecrit rien.
 *
 * Seul le modele Gemini est simule (file de reponses canned) : on teste NOTRE
 * orchestration + nos outils, pas l'IA. Le reste (DB, validation, gate de
 * confirmation) est reel. Org isolee par run (`stamp`), nettoyage best-effort.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db,
  organisationsTable,
  usersTable,
  tasksTable,
  prospectsTable,
  calendarEventsTable,
  assistantConversationsTable,
  assistantMessagesTable,
} from "@workspace/db";

// ---------------------------------------------------------------------------
// Simulation du modele Gemini : file de reponses "canned" consommee par chaque
// appel a `callOrgGemini`. On NE touche QUE la sortie du modele.
// ---------------------------------------------------------------------------
const hoisted = vi.hoisted(() => ({ responses: [] as unknown[] }));

vi.mock("../services/ai-providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/ai-providers")>();
  return {
    ...actual,
    callOrgGemini: async (_orgId: unknown, _fn: unknown) => {
      const next = hoisted.responses.shift();
      if (next === undefined) {
        throw new Error("[test] aucune reponse Gemini en file");
      }
      return next;
    },
  };
});

vi.mock("../services/ai-quota", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/ai-quota")>();
  return { ...actual, assertAiQuota: async () => {} };
});

vi.mock("../services/ai-learning", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/ai-learning")>();
  return { ...actual, buildLearnedContextBlock: async () => "" };
});

import { runAssistantTurn, resolvePendingAction, type StreamEvent } from "../services/assistant-engine";
import { getTool } from "../services/assistant-tools";

function functionCallResponse(name: string, args: Record<string, unknown>): unknown {
  return { candidates: [{ content: { parts: [{ functionCall: { name, args } }] } }] };
}
function textResponse(text: string): unknown {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

const stamp = Date.now();
let orgA = 0;
let orgB = 0;
let userA = 0;
let userB = 0;

async function makeOrg(suffix: string): Promise<{ orgId: number; userId: number }> {
  const [org] = await db.insert(organisationsTable).values({
    name: `Confirm E2E ${suffix} ${stamp}`,
    slug: `confirm-e2e-${suffix}-${stamp}`,
    maxUsers: 10,
    actif: true,
  }).returning({ id: organisationsTable.id });
  const [user] = await db.insert(usersTable).values({
    email: `confirm-e2e-${suffix}-${stamp}@example.test`,
    passwordHash: "x",
    nom: "Test",
    prenom: "Agent",
    role: "agent",
    organisationId: org.id,
    actif: true,
  }).returning({ id: usersTable.id });
  return { orgId: org.id, userId: user.id };
}

async function newConversation(orgId: number, userId: number): Promise<number> {
  const [conv] = await db.insert(assistantConversationsTable).values({
    organisationId: orgId, userId, title: `conv ${Date.now()}-${Math.random()}`,
  }).returning({ id: assistantConversationsTable.id });
  return conv.id;
}

/**
 * Joue un tour de chat ou le modele appelle `toolName(args)` (outil a
 * confirmation). Retourne l'evenement `pending_action` emis par la boucle.
 */
async function triggerPending(
  convId: number,
  ctx: { orgId: number; userId: number },
  toolName: string,
  args: Record<string, unknown>,
): Promise<Extract<StreamEvent, { type: "pending_action" }>> {
  hoisted.responses.length = 0;
  hoisted.responses.push(functionCallResponse(toolName, args));
  const events: StreamEvent[] = [];
  await runAssistantTurn(convId, `Action sur ${toolName}`, ctx, (e) => events.push(e));
  const pending = events.find((e): e is Extract<StreamEvent, { type: "pending_action" }> => e.type === "pending_action");
  if (!pending) throw new Error(`[test] pas de pending_action pour ${toolName}: ${JSON.stringify(events)}`);
  return pending;
}

/** Resout une action en attente (= ce que fait POST /assistant/confirm). */
async function resolve(
  convId: number,
  messageId: number,
  decision: "approve" | "reject",
  ctx: { orgId: number; userId: number },
): Promise<void> {
  // La reprise post-confirmation declenche un appel modele pour resumer.
  hoisted.responses.push(textResponse("C'est fait."));
  await resolvePendingAction(convId, messageId, decision, ctx, () => {});
}

/** Derniere ligne `tool_pending_resolved` d'une conversation. */
async function lastResolved(convId: number, orgId: number) {
  const rows = await db.select().from(assistantMessagesTable).where(and(
    eq(assistantMessagesTable.conversationId, convId),
    eq(assistantMessagesTable.organisationId, orgId),
    eq(assistantMessagesTable.role, "tool_pending_resolved"),
  ));
  return rows[0];
}

beforeAll(async () => {
  const a = await makeOrg("a");
  const b = await makeOrg("b");
  orgA = a.orgId; userA = a.userId;
  orgB = b.orgId; userB = b.userId;
});

afterAll(async () => {
  for (const orgId of [orgA, orgB]) {
    if (!orgId) continue;
    try {
      await db.delete(assistantMessagesTable).where(eq(assistantMessagesTable.organisationId, orgId));
      await db.delete(assistantConversationsTable).where(eq(assistantConversationsTable.organisationId, orgId));
      await db.delete(calendarEventsTable).where(eq(calendarEventsTable.organisationId, orgId));
      await db.delete(prospectsTable).where(eq(prospectsTable.organisationId, orgId));
      await db.delete(tasksTable).where(eq(tasksTable.organisationId, orgId));
      await db.delete(usersTable).where(eq(usersTable.organisationId, orgId));
      await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
    } catch { /* best-effort: ids uniques par run */ }
  }
});

// ===========================================================================
// update_task
// ===========================================================================
describe("update_task — flux de confirmation de bout en bout", () => {
  it("emet pending_action avec le summary de summarize(), puis approve persiste le changement", async () => {
    const [task] = await db.insert(tasksTable).values({
      organisationId: orgA, title: "Rappeler le client", status: "en_attente", priority: "moyenne", createdBy: userA,
    }).returning({ id: tasksTable.id });

    const conv = await newConversation(orgA, userA);
    const args = { id: task.id, status: "termine", priority: "haute" };
    const pending = await triggerPending(conv, { orgId: orgA, userId: userA }, "update_task", args);

    const expected = getTool("update_task")!.summarize!(args as never);
    expect(pending.summary).toBe(expected);
    expect(pending.summary).toContain(`Mettre a jour la tache #${task.id}`);
    expect(pending.summary).toContain("statut → termine");

    // Avant confirmation : rien n'a change.
    const [before] = await db.select().from(tasksTable).where(eq(tasksTable.id, task.id));
    expect(before.status).toBe("en_attente");

    await resolve(conv, pending.messageId, "approve", { orgId: orgA, userId: userA });

    const [after] = await db.select().from(tasksTable).where(eq(tasksTable.id, task.id));
    expect(after.status).toBe("termine");
    expect(after.priority).toBe("haute");
    expect(after.updatedBy).toBe(userA);

    const resolved = await lastResolved(conv, orgA);
    expect((resolved!.toolResult as { success?: boolean }).success).toBe(true);
  });

  it("reject ne touche pas la tache", async () => {
    const [task] = await db.insert(tasksTable).values({
      organisationId: orgA, title: "Ne pas annuler", status: "en_cours", priority: "moyenne", createdBy: userA,
    }).returning({ id: tasksTable.id });

    const conv = await newConversation(orgA, userA);
    const pending = await triggerPending(conv, { orgId: orgA, userId: userA }, "update_task", { id: task.id, status: "annule" });
    await resolve(conv, pending.messageId, "reject", { orgId: orgA, userId: userA });

    const [after] = await db.select().from(tasksTable).where(eq(tasksTable.id, task.id));
    expect(after.status).toBe("en_cours");

    const resolved = await lastResolved(conv, orgA);
    expect((resolved!.toolResult as { cancelled?: boolean }).cancelled).toBe(true);
  });

  it("garde multi-tenant : un id d'une autre org renvoie introuvable et n'ecrit rien", async () => {
    const [task] = await db.insert(tasksTable).values({
      organisationId: orgB, title: "Tache de l'org B", status: "en_attente", priority: "moyenne", createdBy: userB,
    }).returning({ id: tasksTable.id });

    const conv = await newConversation(orgA, userA);
    const pending = await triggerPending(conv, { orgId: orgA, userId: userA }, "update_task", { id: task.id, status: "termine" });
    await resolve(conv, pending.messageId, "approve", { orgId: orgA, userId: userA });

    const [after] = await db.select().from(tasksTable).where(eq(tasksTable.id, task.id));
    expect(after.status).toBe("en_attente");

    const resolved = await lastResolved(conv, orgA);
    expect((resolved!.toolResult as { error?: string }).error).toMatch(/introuvable/i);
  });
});

// ===========================================================================
// advance_prospect
// ===========================================================================
describe("advance_prospect — flux de confirmation de bout en bout", () => {
  it("approve fait progresser l'etape et marque wonAt sur 'gagne'", async () => {
    const [prospect] = await db.insert(prospectsTable).values({
      organisationId: orgA, title: "Deal ACME", stage: "negociation",
    }).returning({ id: prospectsTable.id });

    const conv = await newConversation(orgA, userA);
    const args = { id: prospect.id, stage: "gagne" };
    const pending = await triggerPending(conv, { orgId: orgA, userId: userA }, "advance_prospect", args);

    expect(pending.summary).toBe(getTool("advance_prospect")!.summarize!(args as never));
    expect(pending.summary).toContain(`prospect #${prospect.id}`);

    await resolve(conv, pending.messageId, "approve", { orgId: orgA, userId: userA });

    const [after] = await db.select().from(prospectsTable).where(eq(prospectsTable.id, prospect.id));
    expect(after.stage).toBe("gagne");
    expect(after.wonAt).not.toBeNull();
  });

  it("reject ne touche pas le prospect", async () => {
    const [prospect] = await db.insert(prospectsTable).values({
      organisationId: orgA, title: "Deal a garder", stage: "qualification",
    }).returning({ id: prospectsTable.id });

    const conv = await newConversation(orgA, userA);
    const pending = await triggerPending(conv, { orgId: orgA, userId: userA }, "advance_prospect", { id: prospect.id, stage: "perdu", lostReason: "Budget" });
    await resolve(conv, pending.messageId, "reject", { orgId: orgA, userId: userA });

    const [after] = await db.select().from(prospectsTable).where(eq(prospectsTable.id, prospect.id));
    expect(after.stage).toBe("qualification");
    expect(after.lostAt).toBeNull();
  });

  it("garde multi-tenant : un id d'une autre org renvoie introuvable et n'ecrit rien", async () => {
    const [prospect] = await db.insert(prospectsTable).values({
      organisationId: orgB, title: "Prospect de l'org B", stage: "nouveau",
    }).returning({ id: prospectsTable.id });

    const conv = await newConversation(orgA, userA);
    const pending = await triggerPending(conv, { orgId: orgA, userId: userA }, "advance_prospect", { id: prospect.id, stage: "gagne" });
    await resolve(conv, pending.messageId, "approve", { orgId: orgA, userId: userA });

    const [after] = await db.select().from(prospectsTable).where(eq(prospectsTable.id, prospect.id));
    expect(after.stage).toBe("nouveau");
    expect(after.wonAt).toBeNull();

    const resolved = await lastResolved(conv, orgA);
    expect((resolved!.toolResult as { error?: string }).error).toMatch(/introuvable/i);
  });
});

// ===========================================================================
// reschedule_calendar_event
// ===========================================================================
describe("reschedule_calendar_event — flux de confirmation de bout en bout", () => {
  const HOUR = 3600_000;

  it("approve deplace l'evenement et conserve la duree quand endDate est absent", async () => {
    const start = new Date("2026-07-01T09:00:00.000Z");
    const end = new Date(start.getTime() + HOUR);
    const [ev] = await db.insert(calendarEventsTable).values({
      organisationId: orgA, title: "RDV client", type: "rendez_vous", startDate: start, endDate: end, createdBy: userA,
    }).returning({ id: calendarEventsTable.id });

    const conv = await newConversation(orgA, userA);
    const newStartIso = "2026-07-02T14:00:00.000Z";
    const args = { id: ev.id, startDate: newStartIso };
    const pending = await triggerPending(conv, { orgId: orgA, userId: userA }, "reschedule_calendar_event", args);

    expect(pending.summary).toBe(getTool("reschedule_calendar_event")!.summarize!(args as never));
    expect(pending.summary).toContain(`evenement #${ev.id}`);

    await resolve(conv, pending.messageId, "approve", { orgId: orgA, userId: userA });

    const [after] = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.id, ev.id));
    expect(new Date(after.startDate).toISOString()).toBe(new Date(newStartIso).toISOString());
    // Duree initiale (1h) preservee.
    expect(new Date(after.endDate).getTime() - new Date(after.startDate).getTime()).toBe(HOUR);
    expect(after.updatedBy).toBe(userA);
  });

  it("reject ne touche pas l'evenement", async () => {
    const start = new Date("2026-08-01T09:00:00.000Z");
    const end = new Date(start.getTime() + HOUR);
    const [ev] = await db.insert(calendarEventsTable).values({
      organisationId: orgA, title: "RDV a garder", type: "rendez_vous", startDate: start, endDate: end, createdBy: userA,
    }).returning({ id: calendarEventsTable.id });

    const conv = await newConversation(orgA, userA);
    const pending = await triggerPending(conv, { orgId: orgA, userId: userA }, "reschedule_calendar_event", { id: ev.id, startDate: "2026-08-05T10:00:00.000Z" });
    await resolve(conv, pending.messageId, "reject", { orgId: orgA, userId: userA });

    const [after] = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.id, ev.id));
    expect(new Date(after.startDate).toISOString()).toBe(start.toISOString());
  });

  it("garde multi-tenant : un id d'une autre org renvoie introuvable et n'ecrit rien", async () => {
    const start = new Date("2026-09-01T09:00:00.000Z");
    const end = new Date(start.getTime() + HOUR);
    const [ev] = await db.insert(calendarEventsTable).values({
      organisationId: orgB, title: "RDV de l'org B", type: "rendez_vous", startDate: start, endDate: end, createdBy: userB,
    }).returning({ id: calendarEventsTable.id });

    const conv = await newConversation(orgA, userA);
    const pending = await triggerPending(conv, { orgId: orgA, userId: userA }, "reschedule_calendar_event", { id: ev.id, startDate: "2026-09-10T10:00:00.000Z" });
    await resolve(conv, pending.messageId, "approve", { orgId: orgA, userId: userA });

    const [after] = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.id, ev.id));
    expect(new Date(after.startDate).toISOString()).toBe(start.toISOString());

    const resolved = await lastResolved(conv, orgA);
    expect((resolved!.toolResult as { error?: string }).error).toMatch(/introuvable/i);
  });
});
