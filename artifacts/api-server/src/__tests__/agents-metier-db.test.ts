/**
 * Six profils metier et moindre privilege (lot 3), sur une vraie base, avec les
 * vrais routeurs et une fausse session.
 *
 * Ce qui est prouve :
 *  1. `executeTool` est le point de passage unique : un outil hors du profil
 *     de l'appelant est refuse avec sa raison et N'EST PAS execute (aucune
 *     ligne ecrite), quel que soit l'appelant (profil, file d'approbation,
 *     orchestrateur, agent inconnu) ;
 *  2. l'assistant universel n'est plus un super-agent : il ne peut plus
 *     ecrire dans le CRM, le journal d'appels ni envoyer quoi que ce soit, ni
 *     par la boucle de conversation, ni par une confirmation en attente ;
 *  3. l'essai a blanc decrit ce que l'agent ferait sans rien ecrire, et un
 *     quota epuise se dit (429), il ne rend pas un essai vide ;
 *  4. la publication est reservee aux responsables, est journalisee (la
 *     reactivation aussi), et bornee a l'organisation ;
 *  5. revue du lot 3 — une decision par bloc : A actif par defaut (aucun
 *     client existant ne perd ses pouvoirs), B le profil choisi a l'ecrit et a
 *     la voix est valide pareil, C le role est relu a chaque tour et a chaque
 *     confirmation, D l'essai est reserve aux roles du profil, controle le
 *     quota a chaque appel et un essai vide ne compte pas, E une action
 *     proposee avant les profils est refusee avec un code, sans etre consommee
 *     en silence.
 *
 * Seule la sortie du modele est simulee (callOrgGemini) ; le quota est
 * pilotable pour le cas « epuise ».
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import {
  db, organisationsTable, usersTable, contactsTable, tasksTable, prospectsTable, callsTable,
  agentProposalsTable, agentRunsTable, agentRunStepsTable, agentProfileSettingsTable, auditLogsTable,
  assistantConversationsTable, assistantMessagesTable, aiUsageTable,
} from "@workspace/db";

const h = vi.hoisted(() => ({
  reponses: [] as unknown[],
  configs: [] as Array<{ config?: { tools?: Array<{ functionDeclarations: Array<{ name: string }> }> } }>,
  appelsModele: 0,
  quotaEpuise: false,
  controlesQuota: 0,
  /** Epuise le quota a partir du N-ieme controle (null = jamais). */
  quotaApres: null as number | null,
}));

vi.mock("../services/ai-providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/ai-providers")>();
  return {
    ...actual,
    callOrgGemini: async (_orgId: unknown, fn: (c: unknown) => Promise<unknown>) => {
      h.appelsModele++;
      const suivante = h.reponses.shift();
      if (suivante === undefined) throw new Error("[test] aucune reponse du modele en file");
      if (suivante instanceof Error) throw suivante;
      return fn({ models: { generateContent: async (p: (typeof h.configs)[number]) => { h.configs.push(p); return suivante; } } });
    },
  };
});

vi.mock("../services/ai-quota", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/ai-quota")>();
  return {
    ...actual,
    assertAiQuota: async () => {
      h.controlesQuota++;
      if (h.quotaEpuise || (h.quotaApres !== null && h.controlesQuota >= h.quotaApres)) throw new actual.AiQuotaExceededError("calls", 500, 500);
    },
  };
});

vi.mock("../services/ai-learning", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/ai-learning")>();
  return { ...actual, buildLearnedContextBlock: async () => "" };
});

import ajansRouter from "../routes/ajans";
import assistantRouter from "../routes/assistant";
import { executeTool, getAllTools } from "../services/assistant-tools";
import { runAssistantTurn, resolvePendingAction, type StreamEvent } from "../services/assistant-engine";
import { enqueueProposal } from "../services/proposal-queue";
import { executeProposal } from "../services/autonomous-secretary";
import { essaiValide } from "../services/essai-profil";
import { declarationsPourRole, profilVoiceLive } from "../services/admission-voice-live";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { routeInterditeAuxCles } from "../middleware/auth";
import {
  AGENT_FILE_APPROBATION, OUTILS_ASSISTANT_UNIVERSEL, PROFILS_METIER, outilsAutorises,
} from "../services/profils-agents";

const stamp = Date.now();
const ids: Record<string, number> = {};
let seq = 0;
const u = (p: string) => `${p}-${stamp}-${++seq}`;

function appli(role = "administrateur", userId = ids.admin, orgId = ids.orgA, extra: Record<string, unknown> = {}) {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organisationId: orgId, userRole: role, role, userEmail: `x-${stamp}@exemple.test`, ...extra };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", ajansRouter);
  a.use("/api", assistantRouter);
  return a;
}

const appel = (name: string, args: Record<string, unknown>) => ({ candidates: [{ content: { parts: [{ functionCall: { name, args } }] } }] });
const texte = (t: string) => ({ candidates: [{ content: { parts: [{ text: t }] } }] });

async function compte(table: typeof contactsTable | typeof tasksTable | typeof prospectsTable | typeof callsTable | typeof agentProposalsTable, orgId = ids.orgA) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(table).where(eq((table as typeof contactsTable).organisationId, orgId));
  return r!.n;
}
async function instantane(orgId = ids.orgA) {
  return {
    contacts: await compte(contactsTable, orgId), taches: await compte(tasksTable, orgId), prospects: await compte(prospectsTable, orgId),
    appels: await compte(callsTable, orgId), propositions: await compte(agentProposalsTable, orgId),
  };
}

async function conversation(profil: string | null = null, orgId = ids.orgA, userId = ids.agent) {
  const [c] = await db.insert(assistantConversationsTable).values({ organisationId: orgId, userId, title: u("conv"), profilAgent: profil }).returning({ id: assistantConversationsTable.id });
  return c!.id;
}

async function tour(convId: number, ctx = { orgId: ids.orgA, userId: ids.agent }) {
  const ev: StreamEvent[] = [];
  await runAssistantTurn(convId, "Fais-le", ctx, (e) => ev.push(e));
  return ev;
}

async function publierDirect(agentId: string, orgId = ids.orgA, enabled = true) {
  await db.insert(agentProfileSettingsTable).values({ organisationId: orgId, agentId, enabled })
    .onConflictDoUpdate({ target: [agentProfileSettingsTable.organisationId, agentProfileSettingsTable.agentId], set: { enabled } });
}

const ctxA = () => ({ orgId: ids.orgA, userId: ids.agent });
const nouveauContact = () => ({ firstName: "Paul", lastName: u("Martin"), phone: "0601020304" });

beforeAll(async () => {
  for (const k of ["orgA", "orgB"]) {
    const [o] = await db.insert(organisationsTable).values({ name: `Agents ${k} ${stamp}`, slug: `agm-${k.toLowerCase()}-${stamp}`, maxUsers: 9, actif: true }).returning({ id: organisationsTable.id });
    ids[k] = o!.id;
  }
  const mk = async (org: number, role: string, n: string) => (await db.insert(usersTable).values({ organisationId: org, email: `${n}-${stamp}@exemple.test`, passwordHash: "x", prenom: n, nom: "T", role, actif: true }).returning({ id: usersTable.id }))[0]!.id;
  ids.admin = await mk(ids.orgA, "administrateur", "agm-adm");
  ids.agent = await mk(ids.orgA, "agent", "agm-agt");
  ids.lecteur = await mk(ids.orgA, "lecture_seule", "agm-lec");
  ids.adminB = await mk(ids.orgB, "administrateur", "agm-admb");
  const [c] = await db.insert(callsTable).values({ organisationId: ids.orgA, phoneNumber: "0600000000", direction: "entrant", status: "manque", notes: "origine" }).returning({ id: callsTable.id });
  ids.call = c!.id;
});

beforeEach(() => { h.reponses.length = 0; h.configs.length = 0; h.quotaEpuise = false; h.quotaApres = null; h.controlesQuota = 0; });

// ─────────────────────────────────────────────────────────────────────────────
describe("1. executeTool, point de passage unique : hors profil = refuse ET non execute", () => {
  it("telephone ne cree pas de contact : refus motive, aucune ligne", async () => {
    const avant = await compte(contactsTable);
    const r = await executeTool("create_contact", nouveauContact(), ctxA(), { agent: "telephone", skipConfirmation: true });
    expect(r.ok).toBe(false);
    expect(r.refus).toBe(true);
    expect(r.error).toMatch(/hors du profil « Agent telephone »/);
    expect(await compte(contactsTable)).toBe(avant);
  });

  it("temoin : crm cree bien le contact (le refus n'est pas un refus de tout)", async () => {
    const avant = await compte(contactsTable);
    const r = await executeTool("create_contact", nouveauContact(), ctxA(), { agent: "crm", skipConfirmation: true });
    expect(r.ok, r.error).toBe(true);
    expect(await compte(contactsTable)).toBe(avant + 1);
  });

  it("crm n'inscrit pas un appel : l'appel garde ses notes", async () => {
    const r = await executeTool("log_call", { id: ids.call, notes: "ecrase", status: "repondu" }, ctxA(), { agent: "crm", skipConfirmation: true });
    expect(r.refus).toBe(true);
    const [c] = await db.select().from(callsTable).where(eq(callsTable.id, ids.call));
    expect(c!.notes).toBe("origine");
    expect(c!.status).toBe("manque");
  });

  it("planning ne cree pas de prospect", async () => {
    const avant = await compte(prospectsTable);
    const r = await executeTool("create_prospect", { title: u("Deal") }, ctxA(), { agent: "planning", skipConfirmation: true });
    expect(r.refus).toBe(true);
    expect(await compte(prospectsTable)).toBe(avant);
  });

  it("chantier n'envoie pas d'e-mail, finance ne modifie pas un contact", async () => {
    const e = await executeTool("send_email", { to: "a@exemple.test", subject: "x", body: "y" }, ctxA(), { agent: "chantier", skipConfirmation: true });
    expect(e.refus).toBe(true);
    const [c] = await db.insert(contactsTable).values({ organisationId: ids.orgA, firstName: "Ana", lastName: "Fixe", phone: "0102030405" }).returning();
    const m = await executeTool("update_contact", { id: c!.id, lastName: "Change" }, ctxA(), { agent: "finance", skipConfirmation: true });
    expect(m.refus).toBe(true);
    const [apres] = await db.select().from(contactsTable).where(eq(contactsTable.id, c!.id));
    expect(apres!.lastName).toBe("Fixe");
  });

  it("coordinateur repartit (tache) mais n'ecrit ni CRM ni envoi", async () => {
    const avant = await instantane();
    for (const [nom, args] of [["create_contact", nouveauContact()], ["send_email", { to: "a@exemple.test", subject: "x", body: "y" }], ["send_sms", { to: "0601020304", body: "x" }]] as const) {
      const r = await executeTool(nom, args, ctxA(), { agent: "coordinateur", skipConfirmation: true });
      expect(r.refus, nom).toBe(true);
    }
    expect(await instantane()).toEqual(avant);
  });

  it("un agent inconnu n'a aucun outil, meme de lecture", async () => {
    const r = await executeTool("list_tasks", {}, ctxA(), { agent: "fantome", skipConfirmation: true });
    expect(r.refus).toBe(true);
  });

  it("le refus precede la confirmation : pas de demande d'approbation pour un outil hors profil", async () => {
    const r = await executeTool("create_contact", nouveauContact(), ctxA(), { agent: "telephone" });
    expect(r.pending).toBeUndefined();
    expect(r.refus).toBe(true);
  });

  it("le refus precede la validation : des arguments invalides ne revelent rien de l'outil", async () => {
    const r = await executeTool("create_contact", { nimporte: 1 }, ctxA(), { agent: "telephone" });
    expect(r.refus).toBe(true);
    expect(r.error).not.toMatch(/Argument invalide/);
  });

  it("file d'approbation : une suppression d'appel n'y entre pas et ne s'y execute pas", async () => {
    const avant = await compte(agentProposalsTable);
    const q = await enqueueProposal({ orgId: ids.orgA, toolName: "delete_call", title: "x", summary: "x", args: { id: ids.call } });
    expect(q.ok).toBe(false);
    expect(await compte(agentProposalsTable)).toBe(avant);
    const r = await executeTool("delete_call", { id: ids.call }, ctxA(), { agent: AGENT_FILE_APPROBATION, skipConfirmation: true });
    expect(r.refus).toBe(true);
    expect(await db.select().from(callsTable).where(eq(callsTable.id, ids.call))).toHaveLength(1);
  });

  it("orchestrateur : l'agent support ne cree pas de prospect", async () => {
    const avant = await compte(prospectsTable);
    const r = await executeTool("create_prospect", { title: u("P") }, ctxA(), { agent: "agent-support", skipConfirmation: true });
    expect(r.refus).toBe(true);
    expect(await compte(prospectsTable)).toBe(avant);
  });

  it("pour CHAQUE profil, chaque outil hors liste est refuse (36 outils x 7 profils)", async () => {
    for (const agent of ["assistant", ...PROFILS_METIER.map((p) => p.id)]) {
      const permis = outilsAutorises(agent);
      for (const t of getAllTools()) {
        const r = await executeTool(t.name, {}, ctxA(), { agent, simulation: true });
        expect(Boolean(r.refus), `${agent} / ${t.name}`).toBe(!permis.has(t.name));
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("2. l'assistant universel n'est plus un super-agent", () => {
  it("le modele ne recoit que les outils du profil : ni envoi, ni CRM, ni finance", async () => {
    const conv = await conversation();
    h.reponses.push(texte("Bonjour"));
    await tour(conv);
    const noms = h.configs[0]!.config!.tools![0]!.functionDeclarations.map((d) => d.name);
    expect(new Set(noms)).toEqual(new Set(OUTILS_ASSISTANT_UNIVERSEL));
    for (const x of ["send_email", "send_sms", "create_contact", "log_call", "get_financial_summary"]) expect(noms).not.toContain(x);
  });

  it("create_contact invente par le modele : aucune confirmation proposee, aucun contact", async () => {
    const conv = await conversation();
    const avant = await compte(contactsTable);
    h.reponses.push(appel("create_contact", nouveauContact()), texte("Je ne peux pas."));
    const ev = await tour(conv);
    expect(ev.some((e) => e.type === "pending_action")).toBe(false);
    const etape = ev.find((e) => e.type === "step" && e.toolResult) as Extract<StreamEvent, { type: "step" }>;
    expect(JSON.stringify(etape.toolResult)).toMatch(/hors du profil/);
    expect(await compte(contactsTable)).toBe(avant);
  });

  it("send_email : refuse dans la boucle, rien en attente", async () => {
    const conv = await conversation();
    h.reponses.push(appel("send_email", { to: "client@exemple.test", subject: "Relance", body: "Payez" }), texte("Refuse."));
    const ev = await tour(conv);
    expect(ev.some((e) => e.type === "pending_action")).toBe(false);
    const [ligne] = await db.select().from(assistantMessagesTable).where(and(eq(assistantMessagesTable.conversationId, conv), eq(assistantMessagesTable.role, "tool_result")));
    expect(JSON.stringify(ligne!.toolResult)).toMatch(/hors du profil/);
  });

  it("log_call : l'appel n'est pas modifie", async () => {
    const conv = await conversation();
    h.reponses.push(appel("log_call", { id: ids.call, notes: "par l'assistant" }), texte("ok"));
    await tour(conv);
    const [c] = await db.select().from(callsTable).where(eq(callsTable.id, ids.call));
    expect(c!.notes).toBe("origine");
  });

  it("E : une action deja en attente avant les profils est refusee avec un code, marquee, non executee", async () => {
    const conv = await conversation();
    const [row] = await db.insert(assistantMessagesTable).values({
      conversationId: conv, organisationId: ids.orgA, role: "tool_call", toolName: "create_contact", toolArgs: nouveauContact(), content: "",
    }).returning({ id: assistantMessagesTable.id });
    const avant = await compte(contactsTable);
    const n = h.appelsModele;
    const ev: StreamEvent[] = [];
    await resolvePendingAction(conv, row!.id, "approve", ctxA(), (e) => ev.push(e));
    expect(await compte(contactsTable)).toBe(avant);
    expect(ev).toContainEqual({ type: "error", code: "action_anterieure_profils", error: expect.stringMatching(/avant les profils/) });
    // Pas de « succes » ni de reprise silencieuse du modele.
    expect(ev.some((e) => e.type === "step" || e.type === "done")).toBe(false);
    expect(h.appelsModele).toBe(n);
    // La ligne n'est pas consommee sans explication : elle porte la raison.
    const [marque] = await db.select().from(assistantMessagesTable).where(eq(assistantMessagesTable.id, row!.id));
    expect(marque!.toolResult).toMatchObject({ resolution: "refusee_profil", code: "action_anterieure_profils" });
    const [res] = await db.select().from(assistantMessagesTable).where(and(eq(assistantMessagesTable.conversationId, conv), eq(assistantMessagesTable.role, "tool_pending_resolved")));
    expect(res!.toolResult).toMatchObject({ code: "action_anterieure_profils", executee: false });
    // Un second clic ne rejoue rien.
    const ev2: StreamEvent[] = [];
    await resolvePendingAction(conv, row!.id, "approve", ctxA(), (e) => ev2.push(e));
    expect(await compte(contactsTable)).toBe(avant);
  });

  it("E : une proposition de la file deposee avant les profils (outil retire) est fermee avec un code, pas « echouee » en silence", async () => {
    const [p] = await db.insert(agentProposalsTable).values({
      organisationId: ids.orgA, runId: u("legacy"), toolName: "delete_call", title: "Supprimer", summary: "x", args: { id: ids.call },
    }).returning({ id: agentProposalsTable.id });
    const r = await executeProposal(p!.id, { orgId: ids.orgA, userId: ids.admin });
    expect(r).toMatchObject({ ok: false, status: "expiree", code: "action_anterieure_profils" });
    const [apres] = await db.select().from(agentProposalsTable).where(eq(agentProposalsTable.id, p!.id));
    expect(apres!.status).toBe("expiree");
    expect(apres!.result).toMatchObject({ code: "action_anterieure_profils" });
    expect(apres!.decidedBy).toBe(ids.admin);
    expect(await db.select().from(callsTable).where(eq(callsTable.id, ids.call))).toHaveLength(1);
  });

  it("temoin : sous le profil CRM publie, la meme action est proposee puis executee", async () => {
    await publierDirect("crm");
    const conv = await conversation("crm");
    const avant = await compte(contactsTable);
    h.reponses.push(appel("create_contact", nouveauContact()));
    const ev = await tour(conv);
    const p = ev.find((e) => e.type === "pending_action") as Extract<StreamEvent, { type: "pending_action" }>;
    expect(p).toBeTruthy();
    h.reponses.push(texte("Fait."));
    await resolvePendingAction(conv, p.messageId, "approve", ctxA(), () => {});
    expect(await compte(contactsTable)).toBe(avant + 1);
  });

  it("profil desactive : la conversation n'appelle plus le modele, erreur explicite", async () => {
    await publierDirect("chantier");
    const conv = await conversation("chantier");
    await publierDirect("chantier", ids.orgA, false);
    const n = h.appelsModele;
    const ev = await tour(conv);
    expect(ev.find((e) => e.type === "error")).toMatchObject({ error: expect.stringMatching(/desactive/) });
    expect(h.appelsModele).toBe(n);
  });

  it("profil desactive entre la proposition et la confirmation : rien n'est revendique ni execute", async () => {
    await publierDirect("crm");
    const conv = await conversation("crm");
    const [row] = await db.insert(assistantMessagesTable).values({
      conversationId: conv, organisationId: ids.orgA, role: "tool_call", toolName: "create_contact", toolArgs: nouveauContact(), content: "",
    }).returning({ id: assistantMessagesTable.id });
    await publierDirect("crm", ids.orgA, false);
    const ev: StreamEvent[] = [];
    await resolvePendingAction(conv, row!.id, "approve", ctxA(), (e) => ev.push(e));
    expect(ev[0]).toMatchObject({ type: "error" });
    const [apres] = await db.select().from(assistantMessagesTable).where(eq(assistantMessagesTable.id, row!.id));
    expect(apres!.toolResult).toBeNull();
    await publierDirect("crm");
  });

  it("POST /assistant/chat : le profil finance est refuse a un agent (403 profil_role)", async () => {
    await publierDirect("finance");
    const r = await request(appli("agent", ids.agent)).post("/api/assistant/chat").send({ message: "Etat des impayes", profil: "finance" });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("profil_role");
  });

  it("POST /assistant/chat : profil desactive dans l'organisation (403), inconnu (400)", async () => {
    await publierDirect("telephone", ids.orgB, false);
    const nb = await db.select().from(assistantConversationsTable).where(eq(assistantConversationsTable.organisationId, ids.orgB));
    const r = await request(appli("administrateur", ids.adminB, ids.orgB)).post("/api/assistant/chat").send({ message: "x", profil: "telephone" });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("profil_desactive");
    const r2 = await request(appli("agent", ids.agent)).post("/api/assistant/chat").send({ message: "x", profil: "dieu" });
    expect(r2.status).toBe(400);
    expect(await db.select().from(assistantConversationsTable).where(eq(assistantConversationsTable.organisationId, ids.orgB))).toHaveLength(nb.length);
  });

  it("POST /assistant/chat sous un profil publie : la conversation est fixee sur ce profil", async () => {
    await publierDirect("crm");
    h.reponses.push(texte("Bonjour"));
    const r = await request(appli("agent", ids.agent)).post("/api/assistant/chat").send({ message: u("cree"), profil: "crm" });
    expect(r.status).toBe(200);
    const id = Number(/"conversationId":(\d+)/.exec(r.text)![1]);
    const [c] = await db.select().from(assistantConversationsTable).where(eq(assistantConversationsTable.id, id));
    expect(c!.profilAgent).toBe("crm");
  });

  it("GET /assistant/tools annonce les outils du profil, pas les 36", async () => {
    const r = await request(appli("agent", ids.agent)).get("/api/assistant/tools");
    const noms = r.body.tools.map((t: { name: string }) => t.name);
    expect(noms).not.toContain("send_email");
    expect(noms.length).toBe(OUTILS_ASSISTANT_UNIVERSEL.length);
    const crm = await request(appli("agent", ids.agent)).get("/api/assistant/tools?profil=crm");
    expect(crm.body.tools.map((t: { name: string }) => t.name)).toContain("send_email");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("3. essai a blanc : ce que l'agent ferait, sans rien faire", () => {
  it("crm : creer un contact et envoyer un e-mail sont rapportes, rien n'est ecrit ni mis en file", async () => {
    const avant = await instantane();
    h.reponses.push(appel("create_contact", nouveauContact()), appel("send_email", { to: "paul@exemple.test", subject: "Bienvenue", body: "Bonjour" }), texte("J'aurais cree le contact et ecrit."));
    const r = await request(appli()).post("/api/ajans/profils/crm/essai").send({ entree: "Nouveau prospect Paul" });
    expect(r.status, r.text).toBe(200);
    expect(r.body.actions.map((a: { outil: string; statut: string }) => [a.outil, a.statut])).toEqual([["create_contact", "simulee"], ["send_email", "approbation"]]);
    expect(r.body.actions[0].resume).toMatch(/Paul/);
    expect(await instantane()).toEqual(avant);
  });

  it("un outil hors profil pendant l'essai est rapporte refuse, avec sa raison, et non execute", async () => {
    const avant = await instantane();
    h.reponses.push(appel("create_prospect", { title: u("Deal") }), texte("fin"));
    const r = await request(appli()).post("/api/ajans/profils/telephone/essai").send({ entree: "Un client veut un devis" });
    expect(r.body.actions[0]).toMatchObject({ outil: "create_prospect", statut: "refusee" });
    expect(r.body.actions[0].raison).toMatch(/hors du profil/);
    expect(await instantane()).toEqual(avant);
  });

  it("l'essai laisse une execution « essai » terminee, de l'organisation, avec ses etapes", async () => {
    h.reponses.push(appel("create_task", { title: "Rappeler" }), texte("fin"));
    const r = await request(appli()).post("/api/ajans/profils/planning/essai").send({ entree: "Rappel demain" });
    const [run] = await db.select().from(agentRunsTable).where(eq(agentRunsTable.id, r.body.runId));
    expect(run).toMatchObject({ organisationId: ids.orgA, agentId: "planning", trigger: "essai", status: "terminee" });
    const etapes = await db.select().from(agentRunStepsTable).where(eq(agentRunStepsTable.runId, run!.id));
    expect(etapes.find((e) => e.kind === "outil")!.detail).toMatchObject({ simulation: true });
  });

  it("une lecture n'est pas executee non plus pendant l'essai (resultat simule)", async () => {
    h.reponses.push(appel("list_tasks", {}), texte("fin"));
    await request(appli()).post("/api/ajans/profils/planning/essai").send({ entree: "Quelles taches ?" });
    const contenu = JSON.stringify(h.configs.at(-1));
    expect(contenu).toMatch(/"simulation":true/);
  });

  it("le dernier essai est memorise pour l'organisation, pas pour une autre", async () => {
    h.reponses.push(appel("create_task", { title: "Point" }), texte("fini"));
    const r = await request(appli()).post("/api/ajans/profils/chantier/essai").send({ entree: "Point chantier" });
    const [a] = await db.select().from(agentProfileSettingsTable).where(and(eq(agentProfileSettingsTable.organisationId, ids.orgA), eq(agentProfileSettingsTable.agentId, "chantier")));
    expect(a!.lastDryRunId).toBe(r.body.runId);
    const b = await db.select().from(agentProfileSettingsTable).where(and(eq(agentProfileSettingsTable.organisationId, ids.orgB), eq(agentProfileSettingsTable.agentId, "chantier")));
    expect(b).toHaveLength(0);
  });

  it("quota epuise : 429 explicite, aucun appel au modele, aucune execution", async () => {
    h.quotaEpuise = true;
    const n = h.appelsModele;
    const runs = await db.select().from(agentRunsTable).where(eq(agentRunsTable.organisationId, ids.orgA));
    const r = await request(appli()).post("/api/ajans/profils/crm/essai").send({ entree: "x" });
    expect(r.status).toBe(429);
    expect(r.body.code).toBe("quota_ia");
    expect(r.body.error).toMatch(/Quota IA epuise/);
    expect(h.appelsModele).toBe(n);
    expect(await db.select().from(agentRunsTable).where(eq(agentRunsTable.organisationId, ids.orgA))).toHaveLength(runs.length);
  });

  it("quota epuise dans la conversation : erreur emise, pas de silence", async () => {
    h.quotaEpuise = true;
    const ev = await tour(await conversation());
    expect(ev).toContainEqual({ type: "error", error: expect.stringMatching(/Quota IA/) });
  });

  it("panne du modele : 502 et l'execution d'essai est close « echouee »", async () => {
    h.reponses.push(new Error("modele indisponible"));
    const r = await request(appli()).post("/api/ajans/profils/finance/essai").send({ entree: "x" });
    expect(r.status).toBe(502);
    const [run] = await db.select().from(agentRunsTable).where(and(eq(agentRunsTable.organisationId, ids.orgA), eq(agentRunsTable.agentId, "finance"))).orderBy(sql`${agentRunsTable.id} desc`).limit(1);
    expect(run!.status).toBe("echouee");
  });

  it("lecture seule : pas d'essai (403)", async () => {
    const r = await request(appli("lecture_seule", ids.lecteur)).post("/api/ajans/profils/crm/essai").send({ entree: "x" });
    expect(r.status).toBe(403);
  });

  it("profil inconnu 404, exemple vide 400", async () => {
    expect((await request(appli()).post("/api/ajans/profils/dieu/essai").send({ entree: "x" })).status).toBe(404);
    expect((await request(appli()).post("/api/ajans/profils/crm/essai").send({ entree: "" })).status).toBe(400);
  });

  it("le modele de l'essai ne voit que les outils du profil", async () => {
    h.reponses.push(texte("ok"));
    await request(appli()).post("/api/ajans/profils/finance/essai").send({ entree: "x" });
    const noms = h.configs[0]!.config!.tools![0]!.functionDeclarations.map((d) => d.name);
    expect(new Set(noms)).toEqual(outilsAutorises("finance"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("4. publication : responsable, journalisee, par organisation", () => {
  async function essai(profil: string, role = "administrateur", userId = ids.admin, orgId = ids.orgA) {
    h.reponses.push(appel("create_task", { title: "Essai" }), texte("essai"));
    const r = await request(appli(role, userId, orgId)).post(`/api/ajans/profils/${profil}/essai`).send({ entree: "x" });
    expect(r.status).toBe(200);
    return r.body.runId as number;
  }
  const audits = async (action: string, orgId = ids.orgA) =>
    db.select().from(auditLogsTable).where(and(eq(auditLogsTable.organisationId, orgId), eq(auditLogsTable.action, action)));

  it("un agent ne publie pas (403) : rien n'est active ni journalise", async () => {
    await essai("coordinateur");
    const avant = (await audits("agent.profil_publie")).length;
    const r = await request(appli("agent", ids.agent)).post("/api/ajans/profils/coordinateur/publier").send({});
    expect(r.status).toBe(403);
    const [s] = await db.select().from(agentProfileSettingsTable).where(and(eq(agentProfileSettingsTable.organisationId, ids.orgA), eq(agentProfileSettingsTable.agentId, "coordinateur")));
    expect(s!.publishedAt).toBeNull();
    expect((await audits("agent.profil_publie")).length).toBe(avant);
  });

  it("A : publier n'exige plus d'essai (actif par defaut) ; la publication est journalisee sans essai cite", async () => {
    const r = await request(appli("administrateur", ids.adminB, ids.orgB)).post("/api/ajans/profils/chantier/publier").send({});
    expect(r.status, r.text).toBe(200);
    const a = (await audits("agent.profil_publie", ids.orgB)).filter((x) => x.resourceId === "chantier");
    expect(a.at(-1)!.details).toMatchObject({ essai: null, reactivation: false });
  });

  it("apres un essai, l'administrateur publie : actif, auteur, date, audit", async () => {
    const run = await essai("coordinateur");
    const r = await request(appli()).post("/api/ajans/profils/coordinateur/publier").send({});
    expect(r.status, r.text).toBe(200);
    const [s] = await db.select().from(agentProfileSettingsTable).where(and(eq(agentProfileSettingsTable.organisationId, ids.orgA), eq(agentProfileSettingsTable.agentId, "coordinateur")));
    expect(s).toMatchObject({ enabled: true, publishedBy: ids.admin, lastDryRunId: run });
    expect(s!.publishedAt).toBeTruthy();
    const a = (await audits("agent.profil_publie")).filter((x) => x.resourceId === "coordinateur");
    expect(a.length).toBeGreaterThan(0);
  });

  it("l'essai d'une autre organisation ne vaut pas pour la sienne", async () => {
    await essai("telephone");
    expect(await essaiValide(ids.orgB, "telephone")).toBeNull();
  });

  it("un identifiant d'essai d'une autre organisation, glisse dans l'etat, est refuse", async () => {
    const runA = await essai("finance");
    await db.insert(agentProfileSettingsTable).values({ organisationId: ids.orgB, agentId: "finance", lastDryRunId: runA })
      .onConflictDoUpdate({ target: [agentProfileSettingsTable.organisationId, agentProfileSettingsTable.agentId], set: { lastDryRunId: runA } });
    expect(await essaiValide(ids.orgB, "finance")).toBeNull();
  });

  it("un essai echoue n'est pas un essai valide", async () => {
    h.reponses.push(new Error("panne"));
    await request(appli("administrateur", ids.adminB, ids.orgB)).post("/api/ajans/profils/planning/essai").send({ entree: "x" });
    const [run] = await db.select().from(agentRunsTable).where(and(eq(agentRunsTable.organisationId, ids.orgB), eq(agentRunsTable.agentId, "planning")));
    await db.insert(agentProfileSettingsTable).values({ organisationId: ids.orgB, agentId: "planning", lastDryRunId: run!.id })
      .onConflictDoUpdate({ target: [agentProfileSettingsTable.organisationId, agentProfileSettingsTable.agentId], set: { lastDryRunId: run!.id } });
    expect(await essaiValide(ids.orgB, "planning")).toBeNull();
  });

  it("desactiver : refuse a un agent, accepte et journalise pour un administrateur", async () => {
    expect((await request(appli("agent", ids.agent)).post("/api/ajans/profils/coordinateur/desactiver").send({})).status).toBe(403);
    const r = await request(appli()).post("/api/ajans/profils/coordinateur/desactiver").send({});
    expect(r.status).toBe(200);
    const [s] = await db.select().from(agentProfileSettingsTable).where(and(eq(agentProfileSettingsTable.organisationId, ids.orgA), eq(agentProfileSettingsTable.agentId, "coordinateur")));
    expect(s!.enabled).toBe(false);
    expect((await audits("agent.profil_desactive")).some((x) => x.resourceId === "coordinateur")).toBe(true);
  });

  it("desactiver dans B ne touche pas A", async () => {
    await publierDirect("crm");
    await request(appli("administrateur", ids.adminB, ids.orgB)).post("/api/ajans/profils/crm/desactiver").send({});
    const [s] = await db.select().from(agentProfileSettingsTable).where(and(eq(agentProfileSettingsTable.organisationId, ids.orgA), eq(agentProfileSettingsTable.agentId, "crm")));
    expect(s!.enabled).toBe(true);
  });

  it("GET /ajans/profils : six profils, outils et paliers, transfert humain, etat de l'organisation seulement", async () => {
    await publierDirect("crm");
    const a = await request(appli("agent", ids.agent)).get("/api/ajans/profils");
    expect(a.body.profils.map((p: { id: string }) => p.id)).toEqual(["telephone", "crm", "planning", "chantier", "finance", "coordinateur"]);
    const crm = a.body.profils.find((p: { id: string }) => p.id === "crm");
    expect(crm.active).toBe(true);
    expect(crm.transfertHumain.conditions.length).toBeGreaterThan(0);
    expect(crm.outils).toContainEqual({ nom: "send_email", palier: "externe" });
    await publierDirect("crm", ids.orgB, false);
    const b = await request(appli("administrateur", ids.adminB, ids.orgB)).get("/api/ajans/profils");
    expect(b.body.profils.find((p: { id: string }) => p.id === "crm").active).toBe(false);
  });

  it("profil inconnu : 404 a la publication", async () => {
    expect((await request(appli()).post("/api/ajans/profils/dieu/publier").send({})).status).toBe(404);
  });

  it("une cle API ne publie ni ne desactive un profil (elle peut lire et essayer)", async () => {
    expect(routeInterditeAuxCles("POST", "/api/ajans/profils/crm/publier")).toBe(true);
    expect(routeInterditeAuxCles("POST", "/api/Ajans//profils/crm/desactiver")).toBe(true);
    expect(routeInterditeAuxCles("POST", "/api/ajans/profils/crm/essai")).toBe(false);
    expect(routeInterditeAuxCles("GET", "/api/ajans/profils")).toBe(false);
    const r = await request(appli("administrateur", ids.admin, ids.orgA, { viaCleApi: 1 })).post("/api/ajans/profils/crm/publier").send({});
    expect(r.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("5. revue du lot 3 : une decision par bloc", () => {
  async function orgNeuve() {
    const [o] = await db.insert(organisationsTable).values({ name: u("Neuve"), slug: u("agm-neuve"), maxUsers: 9, actif: true }).returning({ id: organisationsTable.id });
    const [usr] = await db.insert(usersTable).values({ organisationId: o!.id, email: `${u("neuve")}@exemple.test`, passwordHash: "x", prenom: "N", nom: "T", role: "agent", actif: true }).returning({ id: usersTable.id });
    return { orgId: o!.id, userId: usr!.id };
  }
  async function utilisateur(role: string, orgId = ids.orgA) {
    const [x] = await db.insert(usersTable).values({ organisationId: orgId, email: `${u("usr")}@exemple.test`, passwordHash: "x", prenom: "U", nom: "T", role, actif: true }).returning({ id: usersTable.id });
    return x!.id;
  }

  // A — aucun client existant ne perd ses pouvoirs le jour du deploiement.
  it("A : organisation sans aucune ligne de reglage — le profil CRM est actif et cree un contact apres confirmation", async () => {
    const { orgId, userId } = await orgNeuve();
    expect(await db.select().from(agentProfileSettingsTable).where(eq(agentProfileSettingsTable.organisationId, orgId))).toHaveLength(0);
    const avant = await compte(contactsTable, orgId);
    h.reponses.push(appel("create_contact", nouveauContact()));
    const r = await request(appli("agent", userId, orgId)).post("/api/assistant/chat").send({ message: u("Ajoute Paul"), profil: "crm" });
    expect(r.status, r.text).toBe(200);
    expect(r.text).toMatch(/event: pending_action/);
    const convId = Number(/"conversationId":(\d+)/.exec(r.text)![1]);
    const msgId = Number(/"messageId":(\d+)/.exec(r.text)![1]);
    h.reponses.push(texte("Contact cree."));
    const c = await request(appli("agent", userId, orgId)).post("/api/assistant/confirm").send({ conversationId: convId, messageId: msgId, decision: "approve" });
    expect(c.status).toBe(200);
    expect(await compte(contactsTable, orgId)).toBe(avant + 1);
  });

  it("A : GET /ajans/profils sans ligne — les six profils sont actifs ; un essai ne desactive pas le profil", async () => {
    const { orgId, userId } = await orgNeuve();
    const g = await request(appli("agent", userId, orgId)).get("/api/ajans/profils");
    expect(g.body.profils.every((p: { active: boolean }) => p.active)).toBe(true);
    h.reponses.push(appel("create_task", { title: "x" }), texte("fin"));
    expect((await request(appli("agent", userId, orgId)).post("/api/ajans/profils/crm/essai").send({ entree: "x" })).status).toBe(200);
    const g2 = await request(appli("agent", userId, orgId)).get("/api/ajans/profils");
    expect(g2.body.profils.find((p: { id: string }) => p.id === "crm").active).toBe(true);
  });

  it("A : desactiver sans ligne cree l'etat desactive ; reactiver est journalise comme reactivation", async () => {
    const { orgId } = await orgNeuve();
    const a = appli("administrateur", await utilisateur("administrateur", orgId), orgId);
    expect((await request(a).post("/api/ajans/profils/planning/desactiver").send({})).status).toBe(200);
    const g = await request(a).get("/api/ajans/profils");
    expect(g.body.profils.find((p: { id: string }) => p.id === "planning").active).toBe(false);
    expect((await request(a).post("/api/ajans/profils/planning/publier").send({})).status).toBe(200);
    const rea = await db.select().from(auditLogsTable).where(and(eq(auditLogsTable.organisationId, orgId), eq(auditLogsTable.action, "agent.profil_reactive")));
    expect(rea).toHaveLength(1);
    expect(rea[0]!.details).toMatchObject({ reactivation: true });
  });

  // B — meme validation a l'ecrit et a la voix.
  it("B : GET /ajans/profils dit au role ce qu'il peut ouvrir et essayer", async () => {
    const g = await request(appli("agent", ids.agent)).get("/api/ajans/profils");
    const par = Object.fromEntries(g.body.profils.map((p: { id: string; roleAutorise: boolean; peutEssayer: boolean }) => [p.id, [p.roleAutorise, p.peutEssayer]]));
    expect(par.finance).toEqual([false, false]);
    expect(par.crm).toEqual([true, true]);
    const l = await request(appli("lecture_seule", ids.lecteur)).get("/api/ajans/profils");
    expect(l.body.profils.find((p: { id: string }) => p.id === "crm").peutEssayer).toBe(false);
  });

  it("B : voix — profil valide comme le chat (role, desactive, inconnu), assistant par defaut", async () => {
    expect(await profilVoiceLive(ids.orgA, "agent", null)).toEqual({ ok: true, agent: "assistant" });
    expect(await profilVoiceLive(ids.orgA, "agent", "crm")).toEqual({ ok: true, agent: "crm" });
    expect(await profilVoiceLive(ids.orgA, "agent", "finance")).toMatchObject({ ok: false, code: "profil_role" });
    expect(await profilVoiceLive(ids.orgA, "agent", "dieu")).toMatchObject({ ok: false, code: "profil_inconnu" });
    await publierDirect("telephone", ids.orgB, false);
    expect(await profilVoiceLive(ids.orgB, "administrateur", "telephone")).toMatchObject({ ok: false, code: "profil_desactive" });
    expect(declarationsPourRole("agent", "crm").map((d) => d.name)).toContain("send_email");
    expect(declarationsPourRole("agent").map((d) => d.name)).not.toContain("send_email");
  });

  it("B : voix — la route lit ?profil=, le valide AVANT d'ouvrir la WebSocket et passe l'agent partout", () => {
    const src = readFileSync(resolve(__dirname, "../routes/voice-live.ts"), "utf8");
    const i = src.indexOf("await profilVoiceLive(");
    expect(i).toBeGreaterThan(-1);
    expect(i).toBeLessThan(src.indexOf("wss.handleUpgrade("));
    expect(src).toContain('searchParams.get("profil")');
    expect(src).not.toMatch(/agent: PROFIL_ASSISTANT/);
  });

  // C — le role est relu a chaque tour et a chaque confirmation.
  it("C : administrateur retrograde en agent — refuse au tour suivant (profil_role), le modele n'est pas appele", async () => {
    const adm = await utilisateur("administrateur");
    const conv = await conversation("finance", ids.orgA, adm);
    h.reponses.push(texte("Voici les impayes."));
    const ok = await tour(conv, { orgId: ids.orgA, userId: adm });
    expect(ok.some((e) => e.type === "error")).toBe(false);
    await db.update(usersTable).set({ role: "agent" }).where(eq(usersTable.id, adm));
    const n = h.appelsModele;
    const ev = await tour(conv, { orgId: ids.orgA, userId: adm });
    expect(ev).toContainEqual({ type: "error", code: "profil_role", error: expect.stringMatching(/reserve aux responsables/) });
    expect(h.appelsModele).toBe(n);
  });

  it("C : retrograde entre la proposition et la confirmation — rien n'est revendique ni execute", async () => {
    const adm = await utilisateur("administrateur");
    const conv = await conversation("finance", ids.orgA, adm);
    const [row] = await db.insert(assistantMessagesTable).values({
      conversationId: conv, organisationId: ids.orgA, role: "tool_call", toolName: "send_email", toolArgs: { to: "client@exemple.test", subject: "Relance", body: "Payez" }, content: "",
    }).returning({ id: assistantMessagesTable.id });
    await db.update(usersTable).set({ role: "agent" }).where(eq(usersTable.id, adm));
    const ev: StreamEvent[] = [];
    await resolvePendingAction(conv, row!.id, "approve", { orgId: ids.orgA, userId: adm }, (e) => ev.push(e));
    expect(ev[0]).toMatchObject({ type: "error", code: "profil_role" });
    expect(ev.some((e) => e.type === "step")).toBe(false);
    const [apres] = await db.select().from(assistantMessagesTable).where(eq(assistantMessagesTable.id, row!.id));
    expect(apres!.toolResult).toBeNull();
  });

  // D — essai : role, quota a chaque appel, essai vide non valide.
  it("D : un agent ne lance pas l'essai finance (403 profil_role), aucun appel modele, aucun quota consomme", async () => {
    const n = h.appelsModele;
    const r = await request(appli("agent", ids.agent)).post("/api/ajans/profils/finance/essai").send({ entree: "Impayes ?" });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("profil_role");
    expect(h.appelsModele).toBe(n);
    expect(h.controlesQuota).toBe(0);
  });

  it("D : quota controle avant CHAQUE appel du modele, usage inscrit avec l'utilisateur", async () => {
    h.reponses.push(appel("create_task", { title: "a" }), appel("create_task", { title: "b" }), texte("fin"));
    const r = await request(appli()).post("/api/ajans/profils/planning/essai").send({ entree: "x" });
    expect(r.status, r.text).toBe(200);
    // 1 controle d'entree + 1 par appel (3 appels).
    expect(h.controlesQuota).toBe(4);
    const usages = await db.select().from(aiUsageTable).where(eq(aiUsageTable.runId, r.body.runId));
    expect(usages).toHaveLength(3);
    expect(usages.every((x) => x.userId === ids.admin)).toBe(true);
  });

  it("D : quota epuise au deuxieme tour — 429, l'appel suivant n'est pas fait", async () => {
    h.quotaApres = 3; // entree ok, tour 1 ok, tour 2 refuse
    h.reponses.push(appel("create_task", { title: "a" }), texte("jamais"));
    const n = h.appelsModele;
    const r = await request(appli()).post("/api/ajans/profils/planning/essai").send({ entree: "x" });
    expect(r.status).toBe(429);
    expect(h.appelsModele).toBe(n + 1);
  });

  it("D : essai sans aucune action, ou toutes refusees — inscrit non valide, pas cite comme dernier essai", async () => {
    const { orgId, userId } = await orgNeuve();
    h.reponses.push(texte("Rien a faire."));
    const vide = await request(appli("agent", userId, orgId)).post("/api/ajans/profils/crm/essai").send({ entree: "x" });
    expect(vide.status, vide.text).toBe(200);
    expect(vide.body.valide).toBe(false);
    h.reponses.push(appel("log_call", { id: 1 }), texte("refuse"));
    const refuse = await request(appli("agent", userId, orgId)).post("/api/ajans/profils/crm/essai").send({ entree: "x" });
    expect(refuse.body.valide).toBe(false);
    const [run] = await db.select().from(agentRunsTable).where(eq(agentRunsTable.id, refuse.body.runId));
    expect(run!.output).toMatchObject({ valide: false, refusees: 1 });
    expect(await essaiValide(orgId, "crm")).toBeNull();
    expect(await db.select().from(agentProfileSettingsTable).where(eq(agentProfileSettingsTable.organisationId, orgId))).toHaveLength(0);
  });

  it("D : trois tours d'appels d'outils — fin propre « incomplet », pas d'appel hors budget", async () => {
    h.reponses.push(appel("create_task", { title: "a" }), appel("create_task", { title: "b" }), appel("create_task", { title: "c" }), texte("jamais lu"));
    const n = h.appelsModele;
    const { orgId, userId } = await orgNeuve();
    const r = await request(appli("agent", userId, orgId)).post("/api/ajans/profils/planning/essai").send({ entree: "x" });
    expect(r.body).toMatchObject({ incomplet: true, valide: true, reponse: "" });
    expect(h.appelsModele).toBe(n + 3);
  });
});
