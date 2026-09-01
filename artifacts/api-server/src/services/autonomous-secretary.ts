/**
 * Agent de bureau autonome — cœur de la "secrétaire numérique".
 *
 * L'agent tourne en arrière-plan, analyse l'activité de l'organisation
 * (tâches en retard, appels manqués, messages non lus, rendez-vous à venir,
 * contacts inactifs) et PROPOSE des actions concrètes. Il n'exécute jamais
 * rien tout seul : chaque proposition est enregistrée avec le statut
 * `en_attente` dans la file d'approbation (agent_proposals). Le patron valide
 * ou rejette depuis un seul écran ; à l'approbation, l'action est exécutée via
 * les outils de l'assistant existants (executeTool, skipConfirmation).
 *
 * C'est le socle des phases suivantes (réceptionniste vocal, mémoire client,
 * agent auto-apprenant) : toutes réutilisent ce moteur proposition → approbation
 * → exécution.
 */
import { db } from "@workspace/db";
import { generateText } from "./ai-failover";
import {
  agentProposalsTable,
  tasksTable,
  callsTable,
  calendarEventsTable,
  messagesTable,
  contactsTable,
  type AgentProposal,
} from "@workspace/db/schema";
import { and, eq, gte, lte, desc, sql, inArray } from "drizzle-orm";
import { logger } from "../lib/logger";
import { getTool, validateArgs, executeTool, type ToolContext } from "./assistant-tools";
import { isSaasTool, executeSaasTool } from "./saas-tools";
import { enqueueProposals } from "./proposal-queue";
import { assertAiQuota, invalidateQuotaCache } from "./ai-quota";
import { extractGeminiTokens, recordAiUsage, geminiActualModel, GEMINI_FLASH_MODEL, sanitizePromptInput } from "./ai-utils";

/** Outils que l'agent autonome a le droit de proposer. */
const ALLOWED_TOOLS = ["create_task", "send_email", "send_sms", "create_calendar_event", "create_contact", "propose_appointment_slots"] as const;
type AllowedTool = (typeof ALLOWED_TOOLS)[number];

const MAX_PROPOSALS_PER_RUN = 6;

interface ProposedAction {
  toolName: string;
  title: string;
  summary: string;
  reason: string;
  category: string;
  priority: string;
  confidence: number;
  sourceType: string;
  sourceRef: string;
  args: Record<string, unknown>;
}

// ── Appel IA (Gemini) ───────────────────────────────────────────────────────

async function aiGenerate(orgId: number, prompt: string): Promise<string> {
  // Bascule multi-fournisseurs: cet appel visait Gemini en dur et tombait
  // des que ce compte n avait plus de credit (cf. services/ai-failover.ts).
  const { text } = await generateText({ orgId, prompt, model: GEMINI_FLASH_MODEL, route: "/agent-queue/run" });
  return text || "{}";
}

function safeJson<T>(raw: string, fallback: T): T {
  try {
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    return JSON.parse(match ? match[1] : raw);
  } catch {
    return fallback;
  }
}

// ── Collecte du contexte ─────────────────────────────────────────────────────

export interface SecretaryContext {
  overdueTasks: Array<{ id: number; title: string; dueDate: string | null; priority: string | null }>;
  missedCalls: Array<{ id: number; phoneNumber: string | null; contactName: string | null; createdAt: string }>;
  unreadMessages: Array<{ id: number; type: string | null; contactName: string | null; content: string }>;
  upcomingEvents: Array<{ id: number; title: string; startDate: string; location: string | null }>;
  inactiveContacts: Array<{ id: number; firstName: string | null; lastName: string | null; company: string | null }>;
}

export async function gatherContext(orgId: number): Promise<SecretaryContext> {
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const [overdue, missed, unread, upcoming, inactive] = await Promise.all([
    db.select({ id: tasksTable.id, title: tasksTable.title, dueDate: tasksTable.dueDate, priority: tasksTable.priority })
      .from(tasksTable)
      .where(and(
        eq(tasksTable.organisationId, orgId),
        lte(tasksTable.dueDate, now),
        sql`${tasksTable.status} NOT IN ('termine', 'annule')`,
      ))
      .orderBy(desc(tasksTable.dueDate)).limit(15),
    db.select({ id: callsTable.id, phoneNumber: callsTable.phoneNumber, contactName: callsTable.contactName, createdAt: callsTable.createdAt })
      .from(callsTable)
      .where(and(
        eq(callsTable.organisationId, orgId),
        eq(callsTable.status, "manque"),
        gte(callsTable.createdAt, todayStart),
      ))
      .orderBy(desc(callsTable.createdAt)).limit(15),
    db.select({ id: messagesTable.id, type: messagesTable.type, contactName: messagesTable.contactName, content: messagesTable.content })
      .from(messagesTable)
      .where(and(
        eq(messagesTable.organisationId, orgId),
        eq(messagesTable.isRead, false),
        lte(messagesTable.createdAt, oneHourAgo),
      ))
      .orderBy(desc(messagesTable.createdAt)).limit(15),
    db.select({ id: calendarEventsTable.id, title: calendarEventsTable.title, startDate: calendarEventsTable.startDate, location: calendarEventsTable.location })
      .from(calendarEventsTable)
      .where(and(
        eq(calendarEventsTable.organisationId, orgId),
        gte(calendarEventsTable.startDate, now),
        lte(calendarEventsTable.startDate, in48h),
      ))
      .orderBy(calendarEventsTable.startDate).limit(15),
    db.select({ id: contactsTable.id, firstName: contactsTable.firstName, lastName: contactsTable.lastName, company: contactsTable.company })
      .from(contactsTable)
      .where(and(
        eq(contactsTable.organisationId, orgId),
        lte(contactsTable.updatedAt, thirtyDaysAgo),
      ))
      .orderBy(contactsTable.updatedAt).limit(10),
  ]);

  return {
    overdueTasks: overdue.map(t => ({ id: t.id, title: t.title, dueDate: t.dueDate ? new Date(t.dueDate).toISOString() : null, priority: t.priority })),
    missedCalls: missed.map(c => ({ id: c.id, phoneNumber: c.phoneNumber, contactName: c.contactName, createdAt: new Date(c.createdAt).toISOString() })),
    // sanitizePromptInput: le contenu d'un message entrant (WhatsApp/SMS) est
    // du texte CLIENT non fiable — sans filtrage, un message forge ("Ignore
    // les instructions precedentes...") pourrait faire proposer a l'IA une
    // action (send_email, send_sms) manipulee. Le passage humain obligatoire
    // avant execution (agent_proposals) reste la protection principale, mais
    // ce filtrage evite une proposition trompeuse en amont.
    unreadMessages: unread.map(m => ({ id: m.id, type: m.type, contactName: m.contactName, content: sanitizePromptInput(m.content, 200) })),
    upcomingEvents: upcoming.map(e => ({ id: e.id, title: e.title, startDate: new Date(e.startDate).toISOString(), location: e.location })),
    inactiveContacts: inactive.map(c => ({ id: c.id, firstName: c.firstName, lastName: c.lastName, company: c.company })),
  };
}

function hasContext(ctx: SecretaryContext): boolean {
  return ctx.overdueTasks.length > 0 || ctx.missedCalls.length > 0 || ctx.unreadMessages.length > 0
    || ctx.upcomingEvents.length > 0 || ctx.inactiveContacts.length > 0;
}

// ── Construction du prompt + parsing ─────────────────────────────────────────

function buildPrompt(ctx: SecretaryContext): string {
  const toolDocs = ALLOWED_TOOLS.map(name => {
    const t = getTool(name);
    return t ? `- ${t.name}: ${t.description}\n  params: ${JSON.stringify(t.parameters.properties)}${t.parameters.required ? `\n  obligatoires: ${t.parameters.required.join(", ")}` : ""}` : "";
  }).filter(Boolean).join("\n");

  return `Tu es la secrétaire numérique autonome d'une PME française. Tu analyses l'activité du jour et tu PROPOSES des actions concrètes que le patron validera. Tu ne dois proposer que des actions réellement utiles, sans inventer de données.

CONTEXTE ACTUEL (JSON):
${JSON.stringify(ctx)}

OUTILS DISPONIBLES (tu ne peux proposer QUE ceux-ci):
${toolDocs}

CONSIGNES:
- Propose au maximum ${MAX_PROPOSALS_PER_RUN} actions, classées par utilité.
- Chaque action doit correspondre à un élément réel du contexte.
- Pour send_email / send_sms, rédige un brouillon professionnel, courtois, en français. Ne mets un destinataire (to) que si tu le connais via le contexte ; sinon NE PROPOSE PAS cette action.
- Pour les tâches en retard, propose une tâche de relance ou de suivi (create_task) plutôt qu'un email si le destinataire est inconnu.
- "confidence" = ta confiance 0-100. "sourceRef" = identifiant stable de l'élément déclencheur (ex: "task-12", "call-45", "msg-7", "contact-3") pour éviter les doublons.
- "category" parmi: tache, email, sms, rappel, relance, contact.
- "priority" parmi: basse, moyenne, haute.

Réponds UNIQUEMENT avec un objet JSON strict de cette forme:
{"actions":[{"toolName":"...","title":"...","summary":"...","reason":"...","category":"...","priority":"...","confidence":0,"sourceType":"...","sourceRef":"...","args":{}}]}`;
}

function normalizeActions(raw: unknown): ProposedAction[] {
  const obj = raw as { actions?: unknown };
  const arr = Array.isArray(obj?.actions) ? obj.actions : [];
  const out: ProposedAction[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    const toolName = String(a.toolName ?? "");
    if (!ALLOWED_TOOLS.includes(toolName as AllowedTool)) continue;
    const tool = getTool(toolName);
    if (!tool) continue;
    const args = (a.args && typeof a.args === "object") ? a.args as Record<string, unknown> : {};
    const parsed = validateArgs(tool.fields, args);
    if (!parsed.ok) {
      logger.warn({ toolName, error: parsed.error }, "[Secretary] Proposition ignorée (args invalides)");
      continue;
    }
    const confidence = Math.max(0, Math.min(100, Number(a.confidence) || 0));
    out.push({
      toolName,
      title: String(a.title ?? tool.name).slice(0, 200),
      summary: String(a.summary ?? (tool.summarize ? tool.summarize(parsed.data) : tool.description)).slice(0, 1000),
      reason: String(a.reason ?? "").slice(0, 1000),
      category: String(a.category ?? "autre").slice(0, 50),
      priority: ["basse", "moyenne", "haute"].includes(String(a.priority)) ? String(a.priority) : "moyenne",
      confidence,
      sourceType: String(a.sourceType ?? "").slice(0, 80),
      sourceRef: String(a.sourceRef ?? "").slice(0, 120),
      args: parsed.data,
    });
    if (out.length >= MAX_PROPOSALS_PER_RUN) break;
  }
  return out;
}

// ── Génération des propositions ──────────────────────────────────────────────

export interface ProposeResult {
  runId: string;
  generated: number;
  inserted: number;
  skippedDuplicates: number;
}

export async function proposeActionsForOrg(orgId: number, runId?: string): Promise<ProposeResult> {
  const finalRunId = runId ?? `manuel-${Date.now()}`;
  const ctx = await gatherContext(orgId);
  if (!hasContext(ctx)) {
    return { runId: finalRunId, generated: 0, inserted: 0, skippedDuplicates: 0 };
  }

  let actions: ProposedAction[];
  try {
    const raw = await aiGenerate(orgId, buildPrompt(ctx));
    actions = normalizeActions(safeJson<{ actions: unknown[] }>(raw, { actions: [] }));
  } catch (err) {
    logger.error({ err, orgId }, "[Secretary] Échec génération IA");
    throw err;
  }

  if (actions.length === 0) {
    return { runId: finalRunId, generated: 0, inserted: 0, skippedDuplicates: 0 };
  }

  // Mise en file via le point d'entrée unique: déduplication sur sourceRef et
  // validation des arguments y sont centralisées (cf. services/proposal-queue).
  const { inserted, duplicates, failed } = await enqueueProposals(
    actions.map(a => ({
      orgId,
      runId: finalRunId,
      toolName: a.toolName,
      title: a.title,
      summary: a.summary,
      reason: a.reason,
      args: a.args,
      category: a.category,
      priority: a.priority,
      confidence: a.confidence,
      sourceType: a.sourceType,
      sourceRef: a.sourceRef,
    })),
  );

  logger.info({ orgId, runId: finalRunId, generated: actions.length, inserted, duplicates, failed }, "[Secretary] Propositions générées");
  return { runId: finalRunId, generated: actions.length, inserted, skippedDuplicates: duplicates };
}

// ── Exécution d'une proposition approuvée ────────────────────────────────────

export interface ExecuteProposalResult {
  ok: boolean;
  status: AgentProposal["status"];
  result?: unknown;
  error?: string;
}

// Espace de verrous consultatifs Postgres pour l'execution des propositions.
// Distinct des namespaces de cron (lib/cron-lock.ts) pour ne jamais collisionner.
const PROPOSAL_LOCK_NAMESPACE = 4310;

export async function executeProposal(proposalId: number, ctx: ToolContext): Promise<ExecuteProposalResult> {
  // Verrou consultatif BLOQUANT, porte sur (namespace, proposalId).
  //
  // Sans lui, deux approbations concurrentes de la MEME proposition (double
  // clic sur "Approuver", rejeu reseau, deux instances Cloud Run) chargeaient
  // toutes deux le statut `en_attente` et appelaient toutes deux executeTool:
  // l'action s'executait en double — un e-mail parti deux fois, une tache creee
  // en double. `rejectProposal` se protegeait deja via un `WHERE status =
  // 'en_attente'` atomique; l'execution, elle, ne verifiait meme pas le statut
  // en attente avant d'agir.
  //
  // On serialise donc les approbations d'une meme proposition. La seconde
  // attend, puis relit le statut a l'interieur du verrou: la premiere l'ayant
  // passe a `executee`, elle renvoie le resultat memoise sans re-executer.
  // Un verrou (plutot qu'un statut "en cours" persistant) evite tout etat
  // bloque si le processus tombe en cours d'execution.
  const lockRes = await db.execute(
    sql`SELECT pg_advisory_lock(${PROPOSAL_LOCK_NAMESPACE}, ${proposalId})`,
  );
  void lockRes;
  try {
    const [proposal] = await db.select().from(agentProposalsTable)
      .where(and(eq(agentProposalsTable.id, proposalId), eq(agentProposalsTable.organisationId, ctx.orgId)))
      .limit(1);

    if (!proposal) return { ok: false, status: "echouee", error: "Proposition introuvable" };
    if (proposal.status === "executee") return { ok: true, status: "executee", result: proposal.result };
    if (proposal.status === "rejetee") return { ok: false, status: "rejetee", error: "Proposition déjà rejetée" };

    // Les propositions SaaS (cross-organisation) passent par un executeur
    // distinct qui applique sa propre garde super-admin. Le chemin org-scoped
    // `executeTool` ne connait pas ces outils et ne peut donc pas les executer.
    const exec = isSaasTool(proposal.toolName)
      ? await executeSaasTool(proposal.toolName, proposal.args, ctx)
      : await executeTool(proposal.toolName, proposal.args, ctx, { skipConfirmation: true });
    const newStatus: AgentProposal["status"] = exec.ok ? "executee" : "echouee";

    await db.update(agentProposalsTable).set({
      status: newStatus,
      result: (exec.result ?? (exec.error ? { error: exec.error } : {})) as Record<string, unknown>,
      decidedBy: ctx.userId,
      decidedAt: new Date(),
      executedAt: new Date(),
    }).where(eq(agentProposalsTable.id, proposalId));

    return { ok: exec.ok, status: newStatus, result: exec.result, error: exec.error };
  } finally {
    try {
      await db.execute(sql`SELECT pg_advisory_unlock(${PROPOSAL_LOCK_NAMESPACE}, ${proposalId})`);
    } catch (err) {
      logger.error({ err, proposalId }, "[proposal] Echec de liberation du verrou d'execution");
    }
  }
}

export async function rejectProposal(
  proposalId: number,
  ctx: ToolContext,
  note?: string | null,
): Promise<boolean> {
  const trimmed = typeof note === "string" ? note.trim().slice(0, 500) : "";
  const res = await db.update(agentProposalsTable).set({
    status: "rejetee",
    decidedBy: ctx.userId,
    decidedAt: new Date(),
    decisionNote: trimmed || null,
  }).where(and(
    eq(agentProposalsTable.id, proposalId),
    eq(agentProposalsTable.organisationId, ctx.orgId),
    eq(agentProposalsTable.status, "en_attente"),
  )).returning({ id: agentProposalsTable.id });
  return res.length > 0;
}
