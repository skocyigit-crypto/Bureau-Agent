/**
 * Une decision par APPEL d'outil, pas par NOM d'outil — et une seule.
 *
 * Deux defauts de `resolvePendingAction` que la suite de bout en bout ne
 * voyait pas (elle ouvre une conversation neuve par cas) :
 *
 *   1. La garde « deja traitee » cherchait un `tool_pending_resolved` du meme
 *      NOM dans la conversation. Des qu'un premier `create_task` etait
 *      confirme, tout second `create_task` de la meme conversation etait
 *      refuse pour toujours.
 *   2. Verifier puis executer n'etait pas atomique : deux clics simultanes
 *      sur « Approuver » passaient tous les deux la verification et
 *      executaient deux fois — deux e-mails, deux taches, deux factures.
 *
 * La decision est desormais revendiquee sur la ligne `tool_call` elle-meme par
 * un UPDATE conditionnel (`tool_result IS NULL`) : Postgres serialise, un seul
 * gagne. Seul le modele est simule ; DB, validation et garde sont reels.
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
  assistantConversationsTable,
  assistantMessagesTable,
} from "@workspace/db";

const hoisted = vi.hoisted(() => ({ responses: [] as unknown[] }));

vi.mock("../services/ai-providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/ai-providers")>();
  return {
    ...actual,
    callOrgGemini: async (_orgId: unknown, fn: unknown) => {
      const next = hoisted.responses.shift();
      if (next === undefined) throw new Error("[test] aucune reponse Gemini en file");
      // Une fonction en file recoit le rappel reel : elle voit la requete.
      if (typeof next === "function") return (next as (f: unknown) => unknown)(fn);
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
    name: `Decision appel ${suffix} ${stamp}`,
    slug: `decision-appel-${suffix}-${stamp}`,
    maxUsers: 10,
    actif: true,
  }).returning({ id: organisationsTable.id });
  const [user] = await db.insert(usersTable).values({
    email: `decision-appel-${suffix}-${stamp}@example.test`,
    passwordHash: "x",
    nom: "Test",
    prenom: "Decision",
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

/** Un tour ou le modele appelle `create_task` : retourne l'id de l'appel en attente. */
async function pendingCreateTask(convId: number, ctx: { orgId: number; userId: number }, title: string): Promise<number> {
  hoisted.responses.length = 0;
  hoisted.responses.push(functionCallResponse("create_task", { title }));
  const events: StreamEvent[] = [];
  await runAssistantTurn(convId, `Cree la tache ${title}`, ctx, (e) => events.push(e));
  const pending = events.find((e): e is Extract<StreamEvent, { type: "pending_action" }> => e.type === "pending_action");
  if (!pending) throw new Error(`[test] pas de pending_action: ${JSON.stringify(events)}`);
  return pending.messageId;
}

/** Resout un appel et rend les evenements emis (erreurs comprises). */
async function resolve(
  convId: number,
  messageId: number,
  decision: "approve" | "reject",
  ctx: { orgId: number; userId: number },
): Promise<StreamEvent[]> {
  hoisted.responses.push(textResponse("C'est fait."));
  const events: StreamEvent[] = [];
  await resolvePendingAction(convId, messageId, decision, ctx, (e) => events.push(e));
  return events;
}

function erreur(events: StreamEvent[]): string | undefined {
  const e = events.find((x): x is Extract<StreamEvent, { type: "error" }> => x.type === "error");
  return e?.error;
}

async function tachesIntitulees(orgId: number, title: string): Promise<number> {
  const rows = await db.select({ id: tasksTable.id }).from(tasksTable)
    .where(and(eq(tasksTable.organisationId, orgId), eq(tasksTable.title, title)));
  return rows.length;
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
      await db.delete(tasksTable).where(eq(tasksTable.organisationId, orgId));
      await db.delete(usersTable).where(eq(usersTable.organisationId, orgId));
      await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
    } catch { /* best-effort: ids uniques par run */ }
  }
});

describe("une decision par appel — la meme conversation reste utilisable", () => {
  it("un second create_task de la meme conversation s'execute apres le premier", async () => {
    const ctx = { orgId: orgA, userId: userA };
    const conv = await newConversation(orgA, userA);
    const t1 = `premiere-${stamp}`;
    const t2 = `seconde-${stamp}`;

    const first = await pendingCreateTask(conv, ctx, t1);
    expect(erreur(await resolve(conv, first, "approve", ctx))).toBeUndefined();

    const second = await pendingCreateTask(conv, ctx, t2);
    expect(erreur(await resolve(conv, second, "approve", ctx))).toBeUndefined();

    expect(await tachesIntitulees(orgA, t1)).toBe(1);
    expect(await tachesIntitulees(orgA, t2)).toBe(1);
  });

  it("un refus sur le premier appel ne bloque pas l'approbation du suivant", async () => {
    const ctx = { orgId: orgA, userId: userA };
    const conv = await newConversation(orgA, userA);
    const refusee = `refusee-${stamp}`;
    const acceptee = `acceptee-${stamp}`;

    const first = await pendingCreateTask(conv, ctx, refusee);
    await resolve(conv, first, "reject", ctx);
    const second = await pendingCreateTask(conv, ctx, acceptee);
    expect(erreur(await resolve(conv, second, "approve", ctx))).toBeUndefined();

    expect(await tachesIntitulees(orgA, refusee)).toBe(0);
    expect(await tachesIntitulees(orgA, acceptee)).toBe(1);
  });

  it("la decision est inscrite sur l'appel : qui, quoi", async () => {
    const ctx = { orgId: orgA, userId: userA };
    const conv = await newConversation(orgA, userA);
    const call = await pendingCreateTask(conv, ctx, `tracee-${stamp}`);
    await resolve(conv, call, "approve", ctx);

    const [row] = await db.select().from(assistantMessagesTable).where(eq(assistantMessagesTable.id, call));
    const marque = row!.toolResult as { resolution?: string; resolvedBy?: number; resolvedAt?: string };
    expect(marque.resolution).toBe("approve");
    expect(marque.resolvedBy).toBe(userA);
    expect(Number.isNaN(Date.parse(marque.resolvedAt ?? ""))).toBe(false);
  });

  it("l'historique rejoue au modele n'est pas pollue par la marque de decision", async () => {
    const ctx = { orgId: orgA, userId: userA };
    const conv = await newConversation(orgA, userA);
    const call = await pendingCreateTask(conv, ctx, `historique-${stamp}`);
    await resolve(conv, call, "approve", ctx);

    // Le tour suivant relit l'historique : l'appel doit y rester un functionCall
    // avec ses arguments d'origine, pas la marque de decision.
    let vu: unknown;
    hoisted.responses.length = 0;
    hoisted.responses.push((fn: (c: unknown) => Promise<unknown>) => fn({
      models: { generateContent: async (req: { contents: unknown }) => { vu = req.contents; return textResponse("ok"); } },
    }));
    await runAssistantTurn(conv, "et ensuite ?", ctx, () => {});

    const calls = (vu as Array<{ role: string; parts: Array<{ functionCall?: { name: string; args: Record<string, unknown> } }> }>)
      .flatMap(c => c.parts).filter(p => p.functionCall);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]!.functionCall!.args).toEqual({ title: `historique-${stamp}` });
  });
});

describe("une seule decision — ce qui ne doit PAS se produire", () => {
  it("re-confirmer le meme appel est refuse et n'execute pas une seconde fois", async () => {
    const ctx = { orgId: orgA, userId: userA };
    const conv = await newConversation(orgA, userA);
    const title = `rejeu-${stamp}`;
    const call = await pendingCreateTask(conv, ctx, title);

    expect(erreur(await resolve(conv, call, "approve", ctx))).toBeUndefined();
    expect(erreur(await resolve(conv, call, "approve", ctx))).toMatch(/deja ete traitee/);
    expect(await tachesIntitulees(orgA, title)).toBe(1);
  });

  it("deux approbations simultanees du meme appel n'executent qu'une fois", async () => {
    const ctx = { orgId: orgA, userId: userA };
    const conv = await newConversation(orgA, userA);
    const title = `double-clic-${stamp}`;
    const call = await pendingCreateTask(conv, ctx, title);

    hoisted.responses.push(textResponse("C'est fait."), textResponse("C'est fait."));
    const [e1, e2] = await Promise.all([
      (async () => { const ev: StreamEvent[] = []; await resolvePendingAction(conv, call, "approve", ctx, (e) => ev.push(e)); return ev; })(),
      (async () => { const ev: StreamEvent[] = []; await resolvePendingAction(conv, call, "approve", ctx, (e) => ev.push(e)); return ev; })(),
    ]);

    expect(await tachesIntitulees(orgA, title)).toBe(1);
    const refus = [erreur(e1), erreur(e2)].filter(Boolean);
    expect(refus).toHaveLength(1);
    expect(refus[0]).toMatch(/deja ete traitee/);
  });

  it("approuver apres un refus est refuse : le refus tient", async () => {
    const ctx = { orgId: orgA, userId: userA };
    const conv = await newConversation(orgA, userA);
    const title = `refus-tient-${stamp}`;
    const call = await pendingCreateTask(conv, ctx, title);

    await resolve(conv, call, "reject", ctx);
    expect(erreur(await resolve(conv, call, "approve", ctx))).toMatch(/deja ete traitee/);
    expect(await tachesIntitulees(orgA, title)).toBe(0);
  });

  it("une lecture ne se « confirme » pas : /confirm refuse un outil sans confirmation", async () => {
    const ctx = { orgId: orgA, userId: userA };
    const conv = await newConversation(orgA, userA);
    const [row] = await db.insert(assistantMessagesTable).values({
      conversationId: conv, organisationId: orgA, role: "tool_call",
      toolName: "list_tasks", toolArgs: {}, content: "",
    }).returning({ id: assistantMessagesTable.id });

    expect(erreur(await resolve(conv, row.id, "approve", ctx))).toMatch(/ne demande pas de confirmation/);
    const [apres] = await db.select().from(assistantMessagesTable).where(eq(assistantMessagesTable.id, row.id));
    expect(apres!.toolResult).toBeNull();
  });

  it("un appel resolu AVANT ce correctif (sans marque) n'est pas re-executable", async () => {
    const ctx = { orgId: orgA, userId: userA };
    const conv = await newConversation(orgA, userA);
    const title = `ancien-${stamp}`;
    // Donnees d'avant : l'appel sans marque, suivi de sa resolution.
    const [call] = await db.insert(assistantMessagesTable).values({
      conversationId: conv, organisationId: orgA, role: "tool_call",
      toolName: "create_task", toolArgs: { title }, content: "",
    }).returning({ id: assistantMessagesTable.id });
    await db.insert(assistantMessagesTable).values({
      conversationId: conv, organisationId: orgA, role: "tool_pending_resolved",
      toolName: "create_task", toolArgs: { title }, toolResult: { success: true }, content: "",
    });

    expect(erreur(await resolve(conv, call.id, "approve", ctx))).toMatch(/deja ete traitee/);
    expect(await tachesIntitulees(orgA, title)).toBe(0);
  });

  it("une autre organisation ne peut ni resoudre ni marquer l'appel", async () => {
    const ctxA = { orgId: orgA, userId: userA };
    const ctxB = { orgId: orgB, userId: userB };
    const conv = await newConversation(orgA, userA);
    const title = `etrangere-${stamp}`;
    const call = await pendingCreateTask(conv, ctxA, title);

    expect(erreur(await resolve(conv, call, "approve", ctxB))).toMatch(/introuvable/);
    const [row] = await db.select().from(assistantMessagesTable).where(eq(assistantMessagesTable.id, call));
    expect(row!.toolResult).toBeNull();
    expect(await tachesIntitulees(orgA, title)).toBe(0);
    expect(await tachesIntitulees(orgB, title)).toBe(0);
  });
});
